import { randomUUID } from 'crypto'
import type {
  UserInputAnswer,
  UserInputQuestion,
  UserInputRequest,
  UserInputSource,
} from '../shared/chat-turn-types'
import type { ChatTurnEmitter } from './chat-turn-emitter'
import { safeHandle } from './safe-handle'
import {
  registerUserInputResolver,
  registerPendingUserInputProvider,
} from './ws-handlers'

interface PendingUserInput {
  request: UserInputRequest
  emitter: ChatTurnEmitter
  resolve: (answers: UserInputAnswer[]) => void
  reject: (error: Error) => void
}

const pendingUserInputs = new Map<string, PendingUserInput>()

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Normalizes the public built-in tool's deliberately provider-friendly JSON shape. */
export function userInputQuestionsFromArgs(args: Record<string, unknown>): UserInputQuestion[] {
  const rawQuestions = Array.isArray(args.questions)
    ? args.questions
    : typeof args.prompt === 'string' ? [{ id: 'question', prompt: args.prompt }] : []
  return rawQuestions.flatMap((raw, index) => {
    const value = asRecord(raw)
    if (!value) return []
    const prompt = typeof value.prompt === 'string'
      ? value.prompt.trim()
      : typeof value.question === 'string' ? value.question.trim() : ''
    if (!prompt) return []
    const options = Array.isArray(value.options)
      ? value.options.flatMap((rawOption, optionIndex) => {
          const option = typeof rawOption === 'string'
            ? { id: rawOption, label: rawOption }
            : asRecord(rawOption)
          if (!option || typeof option.label !== 'string') return []
          return [{
            id: typeof option.id === 'string' ? option.id : `option-${optionIndex + 1}`,
            label: option.label,
            ...(typeof option.description === 'string' ? { description: option.description } : {}),
          }]
        })
      : undefined
    return [{
      id: typeof value.id === 'string' ? value.id : `question-${index + 1}`,
      ...(typeof value.header === 'string' ? { header: value.header } : {}),
      prompt,
      ...(options?.length ? { options } : {}),
      selection: value.selection === 'multiple' ? 'multiple' : 'single',
      allowFreeText: value.allowFreeText !== false,
    }]
  })
}

export class UserInputCancelledError extends Error {
  constructor(message = 'User input request was cancelled') {
    super(message)
    this.name = 'UserInputCancelledError'
  }
}

function normalizeAnswers(request: UserInputRequest, answers: UserInputAnswer[]): UserInputAnswer[] | null {
  if (!Array.isArray(answers) || answers.length !== request.questions.length) return null
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]))
  const normalized: UserInputAnswer[] = []
  for (const question of request.questions) {
    const answer = byQuestion.get(question.id)
    if (!answer || !Array.isArray(answer.selectedOptionIds)) return null
    const allowedIds = new Set((question.options ?? []).map((option) => option.id))
    if (answer.selectedOptionIds.some((id) => !allowedIds.has(id))) return null
    if (question.selection === 'single' && answer.selectedOptionIds.length > 1) return null
    const text = typeof answer.text === 'string' ? answer.text.trim() : ''
    if (text && !question.allowFreeText) return null
    if (answer.selectedOptionIds.length === 0 && !text) return null
    normalized.push({
      questionId: question.id,
      selectedOptionIds: [...new Set(answer.selectedOptionIds)],
      ...(text ? { text } : {}),
    })
  }
  return normalized
}

export function requestUserInput(
  emitter: ChatTurnEmitter,
  source: UserInputSource,
  questions: UserInputQuestion[],
  onResolved?: (request: UserInputRequest, answers: UserInputAnswer[]) => void,
): Promise<UserInputAnswer[]> {
  if (questions.length === 0) return Promise.reject(new Error('At least one question is required'))
  const request: UserInputRequest = {
    requestId: randomUUID(),
    conversationId: emitter.conversationId,
    turnId: emitter.turnId,
    source,
    questions,
  }
  return new Promise<UserInputAnswer[]>((resolve, reject) => {
    pendingUserInputs.set(request.requestId, {
      request,
      emitter,
      resolve: (answers) => {
        onResolved?.(request, answers)
        resolve(answers)
      },
      reject,
    })
    emitter.userInputRequested(request)
  })
}

export function resolveUserInput(requestId: string, answers: UserInputAnswer[]): boolean {
  const pending = pendingUserInputs.get(requestId)
  if (!pending) return false
  const normalized = normalizeAnswers(pending.request, answers)
  if (!normalized) return false
  pendingUserInputs.delete(requestId)
  pending.emitter.userInputResolved(requestId, normalized)
  pending.resolve(normalized)
  return true
}

export function cancelPendingUserInputsForConversation(conversationId: string, reason = 'Turn cancelled'): void {
  for (const [requestId, pending] of pendingUserInputs) {
    if (pending.request.conversationId !== conversationId) continue
    pendingUserInputs.delete(requestId)
    pending.emitter.userInputCancelled(requestId, reason)
    pending.reject(new UserInputCancelledError(reason))
  }
}

export function cancelAllPendingUserInputs(reason = 'Application shutting down'): void {
  for (const [requestId, pending] of pendingUserInputs) {
    pendingUserInputs.delete(requestId)
    pending.emitter.userInputCancelled(requestId, reason)
    pending.reject(new UserInputCancelledError(reason))
  }
}

export function getPendingUserInputs(conversationId?: string): UserInputRequest[] {
  return [...pendingUserInputs.values()]
    .map((pending) => pending.request)
    .filter((request) => !conversationId || request.conversationId === conversationId)
    .map((request) => structuredClone(request))
}

export function registerUserInputHandlers(): void {
  registerUserInputResolver(resolveUserInput)
  registerPendingUserInputProvider(getPendingUserInputs)
  safeHandle('chat:respond-user-input', (_event, requestId: string, answers: UserInputAnswer[]) =>
    resolveUserInput(requestId, answers))
  safeHandle('chat:get-pending-user-inputs', (_event, conversationId?: string) =>
    getPendingUserInputs(conversationId))
}

export function resetPendingUserInputsForTest(): void {
  pendingUserInputs.clear()
}
