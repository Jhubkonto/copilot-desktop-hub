import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendOpenAINonStreamingMock, sendAzureNonStreamingMock, getAzureEndpointMock } = vi.hoisted(() => ({
  sendOpenAINonStreamingMock: vi.fn(),
  sendAzureNonStreamingMock: vi.fn(),
  getAzureEndpointMock: vi.fn(),
}))

vi.mock('../provider-secrets', () => ({
  getAzureEndpoint: getAzureEndpointMock,
  getOpenRouterModels: vi.fn(() => []),
  retrieveApiKey: vi.fn(() => null),
}))
vi.mock('../providers/openai-provider', () => ({
  sendOpenAIWithTools: vi.fn(),
  sendOpenAINonStreaming: sendOpenAINonStreamingMock,
  sendAzureWithTools: vi.fn(),
  sendAzureNonStreaming: sendAzureNonStreamingMock,
}))
vi.mock('../providers/anthropic-provider', () => ({
  sendAnthropicWithTools: vi.fn(),
}))

import { sendProviderNonStreaming } from '../provider-tools'

describe('sendProviderNonStreaming routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendOpenAINonStreamingMock.mockResolvedValue({ content: 'ok', toolCalls: [] })
  })

  it('routes a vendor-prefixed OpenRouter model through the OpenRouter base URL', async () => {
    const messages = [{ role: 'user' as const, content: 'Generate a quiz' }]
    const options = { maxTokens: 3000, temperature: 0.7 }

    await sendProviderNonStreaming(
      'openrouter',
      'sk-or-test',
      'anthropic/claude-haiku-4.5',
      messages,
      options,
    )

    expect(sendOpenAINonStreamingMock).toHaveBeenCalledWith(
      'sk-or-test',
      'anthropic/claude-haiku-4.5',
      messages,
      options,
      'https://openrouter.ai/api/v1',
    )
    expect(getAzureEndpointMock).not.toHaveBeenCalled()
    expect(sendAzureNonStreamingMock).not.toHaveBeenCalled()
  })

  it('only requires an Azure endpoint for the Azure provider', async () => {
    getAzureEndpointMock.mockReturnValue(null)

    await expect(sendProviderNonStreaming('azure', 'azure-key', 'deployment', [], {}))
      .rejects.toThrow('Azure endpoint not configured')
  })
})
