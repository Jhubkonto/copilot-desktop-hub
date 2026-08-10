import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserInputAnswer, UserInputRequest } from '../../shared/chat-turn-types'

vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))
vi.mock('../ws-handlers', () => ({
  registerUserInputResolver: vi.fn(),
  registerPendingUserInputProvider: vi.fn(),
}))

import {
  cancelPendingUserInputsForConversation,
  getPendingUserInputs,
  requestUserInput,
  resetPendingUserInputsForTest,
  resolveUserInput,
  UserInputCancelledError,
  userInputQuestionsFromArgs,
} from '../user-input'
import type { ChatTurnEmitter } from '../chat-turn-emitter'

function emitter(conversationId = 'conversation-1') {
  const requested: UserInputRequest[] = []
  const resolved: Array<{ requestId: string; answers: UserInputAnswer[] }> = []
  const cancelled: string[] = []
  return {
    value: {
      conversationId,
      turnId: 'turn-1',
      userInputRequested: (request: UserInputRequest) => { requested.push(request) },
      userInputResolved: (requestId: string, answers: UserInputAnswer[]) => { resolved.push({ requestId, answers }) },
      userInputCancelled: (requestId: string) => { cancelled.push(requestId) },
    } as unknown as ChatTurnEmitter,
    requested,
    resolved,
    cancelled,
  }
}

describe('structured user input manager', () => {
  beforeEach(() => resetPendingUserInputsForTest())

  it('registers before publishing and resolves exactly once with validated answers', async () => {
    const fake = emitter()
    const promise = requestUserInput(fake.value, 'byok', [{
      id: 'format', prompt: 'Which format?', selection: 'single', allowFreeText: false,
      options: [{ id: 'md', label: 'Markdown' }],
    }])
    const request = fake.requested[0]
    expect(getPendingUserInputs()).toEqual([request])
    expect(resolveUserInput(request.requestId, [{ questionId: 'format', selectedOptionIds: ['bad'] }])).toBe(false)
    expect(resolveUserInput(request.requestId, [{ questionId: 'format', selectedOptionIds: ['md'] }])).toBe(true)
    await expect(promise).resolves.toEqual([{ questionId: 'format', selectedOptionIds: ['md'] }])
    expect(resolveUserInput(request.requestId, [{ questionId: 'format', selectedOptionIds: ['md'] }])).toBe(false)
    expect(fake.resolved).toHaveLength(1)
  })

  it('cancels only requests owned by the replaced conversation', async () => {
    const first = emitter('first')
    const second = emitter('second')
    const firstPromise = requestUserInput(first.value, 'codex', [{ id: 'q', prompt: 'Q?', selection: 'single', allowFreeText: true }])
    void requestUserInput(second.value, 'codex', [{ id: 'q', prompt: 'Q?', selection: 'single', allowFreeText: true }])
    cancelPendingUserInputsForConversation('first', 'Replaced')
    await expect(firstPromise).rejects.toBeInstanceOf(UserInputCancelledError)
    expect(getPendingUserInputs().map((request) => request.conversationId)).toEqual(['second'])
  })

  it('normalizes provider-friendly tool arguments', () => {
    expect(userInputQuestionsFromArgs({ questions: [{ id: 'scope', prompt: 'Scope?', options: ['Small', 'Large'] }] }))
      .toEqual([expect.objectContaining({ id: 'scope', prompt: 'Scope?', allowFreeText: true, selection: 'single' })])
  })
})
