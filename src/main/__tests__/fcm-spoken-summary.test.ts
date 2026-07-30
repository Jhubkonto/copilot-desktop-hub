import { beforeEach, describe, expect, it, vi } from 'vitest'

const spokenMocks = vi.hoisted(() => ({
  findLatestAssistantMessage: vi.fn(),
  generateAiSpokenOutput: vi.fn(),
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}))
vi.mock('google-auth-library', () => ({ GoogleAuth: class {} }))
vi.mock('../spoken-output', () => spokenMocks)

import { generateSpokenSummary } from '../fcm-sender'

describe('FCM spoken-summary integration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes the latest completed assistant turn through the common persisted service', async () => {
    spokenMocks.findLatestAssistantMessage.mockReturnValue({
      messageId: 'message-2',
      content: 'Latest assistant answer',
      projectId: null,
    })
    spokenMocks.generateAiSpokenOutput.mockResolvedValue({
      messageId: 'message-2',
      spokenText: 'Latest answer recap.',
      outputKind: 'notification-recap',
      generationKind: 'provider',
      model: 'openai:gpt-test',
      createdAt: 1,
      updatedAt: 1,
    })

    const result = await generateSpokenSummary({} as never, 'conversation-1', 'project-1')

    expect(result).toBe('Latest answer recap.')
    expect(spokenMocks.findLatestAssistantMessage).toHaveBeenCalledWith({}, 'conversation-1')
    expect(spokenMocks.generateAiSpokenOutput).toHaveBeenCalledWith(
      {},
      {
        messageId: 'message-2',
        content: 'Latest assistant answer',
        projectId: 'project-1',
      },
      'notification-recap',
    )
  })

  it('does not request a model when the conversation has no assistant answer', async () => {
    spokenMocks.findLatestAssistantMessage.mockReturnValue(null)

    expect(await generateSpokenSummary({} as never, 'conversation-1', null)).toBeNull()
    expect(spokenMocks.generateAiSpokenOutput).not.toHaveBeenCalled()
  })
})
