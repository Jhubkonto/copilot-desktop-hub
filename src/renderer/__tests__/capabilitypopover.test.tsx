import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CapabilityPopover } from '../../renderer/components/CapabilityPopover'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi

const server = {
  id: 'browser',
  name: 'Browser MCP',
  command: 'node',
  args: [],
  env: {},
  enabled: true,
  status: 'connected' as const,
  toolCount: 2,
}

const profile = (trust: 'auto' | 'always-ask' | 'block') => ({
  version: 1 as const,
  skillIds: ['skill-one'],
  mcp: [{ serverId: 'browser', trust }],
})

describe('CapabilityPopover', () => {
  beforeEach(() => {
    mockApi = setupMockApi()
    mockApi.listMcpServers = vi.fn().mockResolvedValue([server])

    let chatProfile = profile('auto')
    mockApi.resolveCapabilities = vi.fn().mockImplementation(async () => ({
      conversationId: 'conv-1',
      // The inherited agent restriction is stricter than the chat value. Execution must still
      // use always-ask, but the chat editor should show the value saved in this chat.
      profile: profile('always-ask'),
      scopeProfiles: { chat: chatProfile, project: null, agent: profile('always-ask') },
      items: [],
      ready: true,
      desktopOnly: true,
    }))
    mockApi.setConversationCapabilities = vi.fn().mockImplementation(async (_id, nextProfile) => {
      chatProfile = nextProfile
      return nextProfile
    })
  })

  it('keeps the chat-scoped approval value after saving despite stricter inherited policy', async () => {
    const user = userEvent.setup()
    render(
      <CapabilityPopover
        conversationId="conv-1"
        skills={[{ id: 'skill-one', name: 'Test skill', icon: '✨', description: 'A test skill' } as never]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Chat capabilities' }))
    const select = await screen.findByRole('combobox')
    expect(select).toHaveValue('auto')

    await user.selectOptions(select, 'block')
    await user.click(screen.getByRole('button', { name: 'Use in this chat' }))

    await waitFor(() => expect(mockApi.setConversationCapabilities).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ skillIds: ['skill-one'], mcp: [{ serverId: 'browser', trust: 'block' }] }),
    ))
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('block'))
  })
})
