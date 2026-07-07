import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type { QuizArtifactResult, QuizQuestion } from '../shared/types'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getApiKey,
  sendProviderNonStreaming,
} from './providers'
import type { ProviderMessage } from './providers'
import { ClaudeAdapter } from './cli-adapters/claude'
import { findArtifactForConversation, readArtifactVersionFile, writeArtifactVersionForConversation } from './artifacts'
import { generateDebriefForWs, type DebriefSectionData } from './debrief-handlers'

const QUIZ_SYSTEM_PROMPT = `You are a quiz generator for a technical learning tool. You receive a structured debrief of a completed AI chat session and must produce multiple-choice questions that test the user's understanding.

Return ONLY a JSON array with 5-8 objects. Each object MUST have:
- "question": string — clear and specific
- "options": exactly 4 strings — all plausible (no obviously wrong answers)
- "correctIndex": integer 0-3 (zero-based index into options)
- "explanation": 2-4 sentences teaching WHY the answer is correct
- "category": one of "command", "concept", "sequence", "approach"

Cover all four categories. Make distractors plausible — use related-but-wrong commands, partial truths, or common misconceptions.`

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

export async function generateQuizForWs(conversationId: string, projectId: string | null, model?: string): Promise<QuizArtifactResult> {
  let debriefArtifact = findArtifactForConversation(conversationId, 'debrief')
  let debriefContent = debriefArtifact?.currentVersion
    ? readArtifactVersionFile(debriefArtifact.currentVersion.id, 'debrief.json')
    : null

  // Quiz builds its questions from a debrief. If the conversation doesn't have one yet,
  // generate it transparently rather than requiring the user to run /debrief first.
  if (!debriefArtifact || !debriefContent) {
    await generateDebriefForWs(conversationId, projectId, model)
    debriefArtifact = findArtifactForConversation(conversationId, 'debrief')
    debriefContent = debriefArtifact?.currentVersion
      ? readArtifactVersionFile(debriefArtifact.currentVersion.id, 'debrief.json')
      : null
    if (!debriefArtifact || !debriefContent) throw new Error('Failed to generate debrief for quiz.')
  }

  const section = JSON.parse(debriefContent) as DebriefSectionData

  const debriefText = [
    `Summary: ${section.summary}`,
    `Commands & Tools: ${section.commandsAndTools.join(', ')}`,
    `How to Reproduce: ${section.reproductionGuide}`,
    `Mental Model: ${section.mentalModel}`,
  ].join('\n\n')

  const userContent = debriefText.length > 8000 ? debriefText.slice(0, 8000) + '\n[truncated]' : debriefText

  const extractionProvider = getProviderForAgent(model ?? DEFAULT_PROVIDER_MODEL)

  const { provider, model: resolvedModel } = extractionProvider
  const apiKey = getApiKey(provider)

  let rawText: string
  if (apiKey) {
    const messages: ProviderMessage[] = [
      { role: 'system', content: QUIZ_SYSTEM_PROMPT },
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
        systemPrompt: QUIZ_SYSTEM_PROMPT,
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
  try {
    const parsed = JSON.parse(cleaned) as unknown
    rawQuestions = Array.isArray(parsed) ? parsed : []
  } catch {
    rawQuestions = []
  }

  const questions: QuizQuestion[] = rawQuestions
    .filter(isValidQuestion)
    .map((q) => ({ ...q, id: randomUUID() }))

  if (questions.length < 2) throw new Error('No quiz questions could be generated.')

  const db = getDatabase()
  const conversationRow = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined
  const conversationTitle = conversationRow?.title ?? 'Conversation'

  const { artifactId, versionId } = writeArtifactVersionForConversation({
    conversationId,
    projectId,
    kind: 'quiz',
    title: `Quiz: ${conversationTitle}`,
    files: [
      { relativePath: 'quiz.json', mediaType: 'application/json', role: 'primary', content: JSON.stringify(questions, null, 2) },
      { relativePath: 'quiz.md', mediaType: 'text/markdown', role: 'supporting', content: formatQuizMarkdown(conversationTitle, questions) },
    ],
  })

  return { questions, artifactId, versionId }
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

export function registerQuizHandlers(): void {
  safeHandle('conversation:generate-quiz', async (_event, conversationId: string, projectId: string | null, model?: string): Promise<QuizArtifactResult> => {
    return generateQuizForWs(conversationId, projectId, model)
  })
}
