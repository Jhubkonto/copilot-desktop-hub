import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type { QuizAttempt, QuizGenerationResult, QuizQuestion } from '../shared/types'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getApiKey,
  sendProviderNonStreaming,
} from './providers'
import type { ProviderMessage } from './providers'
import { ClaudeAdapter } from './cli-adapters/claude'

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

export async function generateQuizForWs(conversationId: string, model?: string): Promise<QuizGenerationResult> {
  const db = getDatabase()

  const debriefRow = db.prepare(
    'SELECT * FROM conversation_debriefs WHERE conversation_id = ?'
  ).get(conversationId) as {
    summary: string
    commands_tools: string
    reproduction_guide: string
    mental_model: string
  } | undefined

  if (!debriefRow) throw new Error('No debrief found — generate a debrief first.')

  const commandsTools = (() => {
    try { return JSON.parse(debriefRow.commands_tools) as string[] } catch { return [] }
  })()

  const debriefText = [
    `Summary: ${debriefRow.summary}`,
    `Commands & Tools: ${commandsTools.join(', ')}`,
    `How to Reproduce: ${debriefRow.reproduction_guide}`,
    `Mental Model: ${debriefRow.mental_model}`,
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
    return { questions: [] }
  }

  const questions: QuizQuestion[] = rawQuestions
    .filter(isValidQuestion)
    .map((q) => ({ ...q, id: randomUUID() }))

  if (questions.length < 2) return { questions: [] }

  return { questions }
}

export function saveQuizAttemptForWs(conversationId: string, score: number, total: number): QuizAttempt {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO conversation_quiz_attempts (id, conversation_id, score, total, attempted_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, conversationId, score, total, now)
  return { id, conversation_id: conversationId, score, total, attempted_at: now }
}

export function listQuizAttemptsForWs(conversationId: string): QuizAttempt[] {
  const db = getDatabase()
  return db.prepare(
    'SELECT * FROM conversation_quiz_attempts WHERE conversation_id = ? ORDER BY attempted_at DESC'
  ).all(conversationId) as QuizAttempt[]
}

export function registerQuizHandlers(): void {
  safeHandle('conversation:generate-quiz', async (_event, conversationId: string, model?: string): Promise<QuizGenerationResult> => {
    return generateQuizForWs(conversationId, model)
  })

  safeHandle('conversation:save-quiz-attempt', (_event, conversationId: string, score: number, total: number): QuizAttempt => {
    return saveQuizAttemptForWs(conversationId, score, total)
  })

  safeHandle('conversation:list-quiz-attempts', (_event, conversationId: string): QuizAttempt[] => {
    return listQuizAttemptsForWs(conversationId)
  })
}
