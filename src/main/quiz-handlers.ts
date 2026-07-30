import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type { QuizArtifactResult, QuizQuestion, QuizSpec, QuizAttempt, QuizAttemptInput } from '../shared/types'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getApiKey,
  sendProviderNonStreaming,
} from './providers'
import type { ProviderMessage } from './providers'
import { ClaudeAdapter } from './cli-adapters/claude'
import { broadcastToMobile, isMobileInForeground } from './ws-server'
import { sendQuizCompleteNotification } from './fcm-sender'
import {
  createPendingArtifactForConversation,
  findArtifactForConversation,
  insertPendingArtifactRefMessage,
  markArtifactGenerationFailed,
  readArtifactVersionFile,
  writeArtifactVersionForConversation,
} from './artifacts'
import { buildConversationTranscript, type DebriefSectionData } from './debrief-handlers'
import { broadcastConversationMessages } from './chat-handlers'
import { startActivity, endActivity } from './activity-tracker'

const SOURCE_CHAR_LIMIT = 12_000

export function buildQuizSystemPrompt(spec: QuizSpec): string {
  const count = typeof spec.questionCount === 'number'
    ? `exactly ${Math.min(12, Math.max(3, Math.round(spec.questionCount)))}`
    : '5-8'
  const difficulty = spec.difficulty ?? 'medium'
  const difficultyGuidance: Record<string, string> = {
    easy: 'Keep questions approachable — test recall of the main facts and terms. Distractors may be clearly distinguishable.',
    medium: 'Test genuine understanding, not just recall. Make distractors plausible — related-but-wrong commands, partial truths, or common misconceptions.',
    hard: 'Test deep understanding and edge cases. Distractors should be subtle and require careful reasoning to rule out.',
  }
  const focus = spec.topic
    ? `\n\nFOCUS: Concentrate the questions specifically on: "${spec.topic}". If the source material barely covers this, generate the best questions you can from what is relevant and ignore unrelated parts.`
    : ''
  const missed = spec.focusQuestions && spec.focusQuestions.length > 0
    ? `\n\nThe learner previously got these questions wrong — re-test the same underlying concepts from fresh angles (do not copy them verbatim):\n${spec.focusQuestions.map((q) => `- ${q}`).join('\n')}`
    : ''

  return `You are a quiz generator for a technical learning tool. You receive source material from a work session (a chat transcript, a structured debrief, or notes across a project) and must produce multiple-choice questions that test the user's understanding.

Return ONLY a JSON array with ${count} objects. Each object MUST have:
- "question": string — clear and specific
- "options": exactly 4 strings — all plausible (no obviously wrong answers)
- "correctIndex": integer 0-3 (zero-based index into options)
- "explanation": 2-4 sentences teaching WHY the answer is correct
- "category": one of "command", "concept", "sequence", "approach"

Difficulty: ${difficulty}. ${difficultyGuidance[difficulty]}
Cover a spread of the four categories where the material supports it.${focus}${missed}`
}

function isValidQuestion(q: unknown): q is Omit<QuizQuestion, 'id'> {
  if (!q || typeof q !== 'object') return false
  const obj = q as Record<string, unknown>
  return (
    typeof obj.question === 'string' &&
    Array.isArray(obj.options) &&
    obj.options.length === 4 &&
    typeof obj.correctIndex === 'number' &&
    obj.correctIndex >= 0 && obj.correctIndex <= 3 &&
    typeof obj.explanation === 'string' &&
    ['command', 'concept', 'sequence', 'approach'].includes(obj.category as string)
  )
}

/**
 * Assembles the source material a quiz should be generated from, honouring spec.source:
 * - 'conversation' (default): the raw chat transcript.
 * - 'debrief': the conversation's existing debrief, if one has been generated. No longer
 *   generated silently — falls back to the transcript so /quiz always works standalone.
 * - 'project': debriefs + transcripts across every conversation in the project.
 * Returns a human-readable label of what was actually used plus the text (char-capped).
 */
export function buildQuizSourceContent(
  db: ReturnType<typeof getDatabase>,
  conversationId: string,
  projectId: string | null,
  spec: QuizSpec,
): { sourceLabel: string; content: string } {
  const source = spec.source ?? 'conversation'

  const debriefTextFor = (convId: string): string | null => {
    const artifact = findArtifactForConversation(convId, 'debrief')
    const content = artifact?.currentVersion ? readArtifactVersionFile(artifact.currentVersion.id, 'debrief.json') : null
    if (!content) return null
    try {
      const section = JSON.parse(content) as DebriefSectionData
      return [
        `Summary: ${section.summary}`,
        `Commands & Tools: ${section.commandsAndTools.join(', ')}`,
        `How to Reproduce: ${section.reproductionGuide}`,
        `Mental Model: ${section.mentalModel}`,
      ].join('\n\n')
    } catch {
      return null
    }
  }

  const cap = (text: string): string => text.length > SOURCE_CHAR_LIMIT ? text.slice(0, SOURCE_CHAR_LIMIT) + '\n[truncated]' : text

  if (source === 'project' && projectId) {
    const convRows = db.prepare(
      'SELECT id, title FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 25'
    ).all(projectId) as { id: string; title: string }[]
    const parts: string[] = []
    for (const conv of convRows) {
      const debrief = debriefTextFor(conv.id)
      const body = debrief ?? buildConversationTranscript(db, conv.id)
      if (body) parts.push(`### ${conv.title || 'Conversation'}\n${body}`)
      if (parts.join('\n\n').length > SOURCE_CHAR_LIMIT) break
    }
    if (parts.length === 0) throw new Error('This project has no conversation content to quiz on yet.')
    return { sourceLabel: 'project', content: cap(parts.join('\n\n')) }
  }

  if (source === 'debrief') {
    const debrief = debriefTextFor(conversationId)
    if (debrief) return { sourceLabel: 'debrief', content: cap(debrief) }
    // No debrief yet — fall back to the transcript rather than silently generating one.
    const transcript = buildConversationTranscript(db, conversationId)
    if (!transcript) throw new Error('This conversation has no messages to quiz on yet.')
    return { sourceLabel: 'conversation (no debrief found)', content: cap(transcript) }
  }

  const transcript = buildConversationTranscript(db, conversationId)
  if (!transcript) throw new Error('This conversation has no messages to quiz on yet.')
  return { sourceLabel: 'conversation', content: cap(transcript) }
}

export async function generateQuizForWs(conversationId: string, projectId: string | null, model?: string, spec: QuizSpec = {}, targetArtifactId?: string): Promise<QuizArtifactResult> {
  const db = getDatabase()
  const activityId = `quiz-generation:${conversationId}`
  const conversationTitleRow = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined
  startActivity({ id: activityId, kind: 'quiz-generation', label: 'Generating quiz…', detail: conversationTitleRow?.title, projectId: projectId ?? undefined, conversationId })
  try {
    return await generateQuizForWsInner(conversationId, projectId, model, spec, targetArtifactId)
  } finally {
    endActivity(activityId)
  }
}

async function generateQuizForWsInner(conversationId: string, projectId: string | null, model: string | undefined, spec: QuizSpec, targetArtifactId?: string): Promise<QuizArtifactResult> {
  const db = getDatabase()
  const { sourceLabel, content: sourceContent } = buildQuizSourceContent(db, conversationId, projectId, spec)

  const userContent = `Source (${sourceLabel}):\n\n${sourceContent}`
  const systemPrompt = buildQuizSystemPrompt(spec)

  const extractionProvider = getProviderForAgent(model ?? DEFAULT_PROVIDER_MODEL)

  const { provider, model: resolvedModel } = extractionProvider
  const apiKey = getApiKey(provider)

  let rawText: string
  if (apiKey) {
    const messages: ProviderMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]
    const result = await sendProviderNonStreaming(provider, apiKey, resolvedModel, messages, {
      maxTokens: 3000,
      temperature: 0.7,
    })
    rawText = result.content ?? ''
  } else if (ClaudeAdapter.isAvailable()) {
    rawText = await ClaudeAdapter.send(
      null as never,
      {
        systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        cwd: '',
        model: 'default',
        conversationId: randomUUID(),
      },
      () => {},
    )
  } else {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }

  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  let rawQuestions: unknown[]
  let parseIssue: string | null = null
  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (Array.isArray(parsed)) {
      rawQuestions = parsed
    } else {
      rawQuestions = []
      parseIssue = 'the model response was not a JSON array'
    }
  } catch (err) {
    rawQuestions = []
    parseIssue = `the model response was not valid JSON (${err instanceof Error ? err.message : 'parse error'})`
  }

  const questions: QuizQuestion[] = rawQuestions
    .filter(isValidQuestion)
    .map((q) => ({ ...q, id: randomUUID() }))

  if (questions.length < 2) {
    if (parseIssue) throw new Error(`Could not generate quiz questions: ${parseIssue}. Try a different model.`)
    throw new Error(`Model returned ${rawQuestions.length} question(s) but only ${questions.length} were well-formed. Try a different model.`)
  }

  const conversationRow = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined
  const conversationTitle = conversationRow?.title ?? 'Conversation'
  const titleSuffix = spec.topic ? `${conversationTitle} — ${spec.topic}` : conversationTitle

  const { artifactId, versionId } = writeArtifactVersionForConversation({
    conversationId,
    projectId,
    kind: 'quiz',
    title: `Quiz: ${titleSuffix}`,
    artifactId: targetArtifactId,
    files: [
      { relativePath: 'quiz.json', mediaType: 'application/json', role: 'primary', content: JSON.stringify(questions, null, 2) },
      { relativePath: 'quiz.md', mediaType: 'text/markdown', role: 'supporting', content: formatQuizMarkdown(titleSuffix, questions) },
      // Persist the spec so "Regenerate" reuses the same source/topic/difficulty intent.
      { relativePath: 'quiz-spec.json', mediaType: 'application/json', role: 'supporting', content: JSON.stringify(spec, null, 2) },
    ],
  })

  const result: QuizArtifactResult = { questions, artifactId, versionId, spec }
  // The completed generation pins the existing pending `__artifact-ref` message row to this
  // version (writeArtifactVersionForConversation), but never re-syncs that row's updated
  // content to other devices on its own — without this, Android's synced pending card (or a
  // second desktop window) never learns the quiz finished and shows a stale spinner, or the
  // requesting screen having been closed meant nobody was left to notice completion at all.
  broadcastConversationMessages(conversationId)
  broadcastToMobile({ event: 'quiz:ready', data: { ...result, conversationId } })
  if (!isMobileInForeground()) {
    void sendQuizCompleteNotification(db, { conversationId, title: `Quiz: ${titleSuffix}` })
  }

  return result
}

/** Reads the persisted QuizSpec for a stored quiz version, or {} if none/legacy. */
function readQuizSpec(versionId: string): QuizSpec {
  const content = readArtifactVersionFile(versionId, 'quiz-spec.json')
  if (!content) return {}
  try {
    return JSON.parse(content) as QuizSpec
  } catch {
    return {}
  }
}

function formatQuizMarkdown(title: string, questions: QuizQuestion[]): string {
  const lines = [`# Quiz: ${title}`, '']
  questions.forEach((q, i) => {
    lines.push(`## ${i + 1}. ${q.question}`)
    q.options.forEach((opt, oi) => {
      const marker = oi === q.correctIndex ? '**' : ''
      lines.push(`- ${marker}${String.fromCharCode(65 + oi)}. ${opt}${marker}`)
    })
    lines.push('', `_${q.explanation}_`, '')
  })
  return lines.join('\n')
}

/**
 * Creates the quiz artifact with status 'generating' immediately, then runs the actual
 * LLM generation in the background — mirrors startDebriefGeneration so /quiz gets the same
 * durable, non-blocking progress card. Accepts an optional QuizSpec (source/topic/difficulty/
 * count) that the generation reuses and persists for "Regenerate".
 *
 * `insertPendingMessage` is for trigger sources with no renderer of their own to attach a chat
 * card afterward (Android's WS trigger) — it inserts the pending `__artifact-ref` message here
 * instead, and broadcasts it so every connected device/window picks it up. Without this, a quiz
 * triggered from Android and left generating after the chat screen was closed had nothing to pin
 * its result onto: the completed quiz existed only as an orphan artifact, never as a chat card,
 * and looked like the quiz had "disappeared". Desktop's IPC trigger leaves this false and keeps
 * inserting its own card client-side, since that path also covers in-card "Regenerate" (reusing
 * an existing artifact, which must NOT get a second card).
 */
export function startQuizGeneration(conversationId: string, projectId: string | null, model?: string, spec: QuizSpec = {}, targetArtifactId?: string, insertPendingMessage = false): { artifactId: string } {
  const db = getDatabase()
  const conversationRow = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined
  const titleSuffix = spec.topic ? `${conversationRow?.title ?? 'Conversation'} — ${spec.topic}` : (conversationRow?.title ?? 'Conversation')
  const title = `Quiz: ${titleSuffix}`
  const isNewArtifact = !targetArtifactId && !findArtifactForConversation(conversationId, 'quiz')
  const artifactId = createPendingArtifactForConversation({
    conversationId,
    projectId,
    kind: 'quiz',
    title,
    artifactId: targetArtifactId,
    reuseExisting: Boolean(targetArtifactId),
  })
  if (insertPendingMessage && isNewArtifact) {
    insertPendingArtifactRefMessage(conversationId, artifactId, 'quiz')
    broadcastConversationMessages(conversationId)
  }
  void generateQuizForWs(conversationId, projectId, model, spec, artifactId).catch((err) => {
    markArtifactGenerationFailed(artifactId, projectId, err instanceof Error ? err.message : String(err))
  })
  return { artifactId }
}

export function getQuizForWs(conversationId: string): QuizArtifactResult | null {
  const artifact = findArtifactForConversation(conversationId, 'quiz')
  const version = artifact?.currentVersion
  if (!artifact || !version) return null
  const content = readArtifactVersionFile(version.id, 'quiz.json')
  if (!content) return null
  let questions: QuizQuestion[]
  try {
    questions = JSON.parse(content) as QuizQuestion[]
  } catch {
    return null
  }
  return { questions, artifactId: artifact.id, versionId: version.id, spec: readQuizSpec(version.id) }
}

/**
 * Loads quiz content by artifact id directly, bypassing the conversation_id/artifact_chat_refs
 * lookup findArtifactForConversation relies on. That lookup can miss for older or otherwise
 * unlinked rows (the chat card that references this artifact already knows its id — resolving
 * it directly here sidesteps whatever caused the conversation link to be missing entirely,
 * rather than requiring it be repaired). Tapping an existing quiz card must never fall through
 * to "no quiz found, generate a new one" just because that link is stale.
 */
export function getQuizByArtifactIdForWs(artifactId: string): QuizArtifactResult | null {
  const db = getDatabase()
  const artifactRow = db.prepare(`SELECT * FROM artifacts WHERE id = ? AND kind = 'quiz'`).get(artifactId) as
    | { current_version_id: string | null }
    | undefined
  const versionId = artifactRow?.current_version_id
  if (!versionId) return null
  const content = readArtifactVersionFile(versionId, 'quiz.json')
  if (!content) return null
  let questions: QuizQuestion[]
  try {
    questions = JSON.parse(content) as QuizQuestion[]
  } catch {
    return null
  }
  return { questions, artifactId, versionId, spec: readQuizSpec(versionId) }
}

interface QuizAttemptRow {
  id: string
  artifact_id: string
  version_id: string
  conversation_id: string | null
  project_id: string | null
  score: number
  total: number
  category_breakdown: string | null
  missed_questions: string | null
  attempted_at: number
}

function rowToQuizAttempt(row: QuizAttemptRow): QuizAttempt {
  let categoryBreakdown: QuizAttempt['categoryBreakdown'] = {}
  let missedQuestions: string[] = []
  try { if (row.category_breakdown) categoryBreakdown = JSON.parse(row.category_breakdown) } catch { /* keep {} */ }
  try { if (row.missed_questions) missedQuestions = JSON.parse(row.missed_questions) } catch { /* keep [] */ }
  return {
    id: row.id,
    artifactId: row.artifact_id,
    versionId: row.version_id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    score: row.score,
    total: row.total,
    categoryBreakdown,
    missedQuestions,
    attemptedAt: row.attempted_at,
  }
}

/** Persists a completed quiz run so scores accumulate across restarts. */
export function recordQuizAttempt(input: QuizAttemptInput): QuizAttempt {
  const db = getDatabase()
  const id = randomUUID()
  const attemptedAt = Date.now()
  db.prepare(
    `INSERT INTO quiz_attempts (id, artifact_id, version_id, conversation_id, project_id, score, total, category_breakdown, missed_questions, attempted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.artifactId,
    input.versionId,
    input.conversationId ?? null,
    input.projectId ?? null,
    input.score,
    input.total,
    JSON.stringify(input.categoryBreakdown ?? {}),
    JSON.stringify(input.missedQuestions ?? []),
    attemptedAt,
  )
  return {
    id,
    artifactId: input.artifactId,
    versionId: input.versionId,
    conversationId: input.conversationId ?? null,
    projectId: input.projectId ?? null,
    score: input.score,
    total: input.total,
    categoryBreakdown: input.categoryBreakdown ?? {},
    missedQuestions: input.missedQuestions ?? [],
    attemptedAt,
  }
}

/** Returns all attempts for a quiz artifact, newest first. */
export function getQuizAttempts(artifactId: string): QuizAttempt[] {
  const db = getDatabase()
  const rows = db.prepare(
    'SELECT * FROM quiz_attempts WHERE artifact_id = ? ORDER BY attempted_at DESC'
  ).all(artifactId) as QuizAttemptRow[]
  return rows.map(rowToQuizAttempt)
}

export function registerQuizHandlers(): void {
  safeHandle('conversation:generate-quiz', async (_event, conversationId: string, projectId: string | null, model?: string, spec?: QuizSpec): Promise<QuizArtifactResult> => {
    return generateQuizForWs(conversationId, projectId, model, spec ?? {})
  })

  safeHandle('conversation:start-quiz-generation', (_event, conversationId: string, projectId: string | null, model?: string, spec?: QuizSpec, targetArtifactId?: string) => {
    return startQuizGeneration(conversationId, projectId, model, spec ?? {}, targetArtifactId)
  })

  safeHandle('conversation:get-quiz', (_event, conversationId: string): QuizArtifactResult | null => {
    return getQuizForWs(conversationId)
  })

  safeHandle('quiz:record-attempt', (_event, input: QuizAttemptInput): QuizAttempt => {
    return recordQuizAttempt(input)
  })

  safeHandle('quiz:get-attempts', (_event, artifactId: string): QuizAttempt[] => {
    return getQuizAttempts(artifactId)
  })
}
