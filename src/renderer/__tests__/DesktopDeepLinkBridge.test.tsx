import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupMockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

import { DesktopDeepLinkBridge } from '../components/DesktopDeepLinkBridge'

describe('DesktopDeepLinkBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the conversation supplied by a notification deep link', async () => {
    const api = setupMockApi()
    const store = createMockAppStore()
    setupStoreMock(useAppStore, store)

    let openChat: ((conversationId: string) => void) | undefined
    api.onOpenChatDeepLink.mockImplementation((callback) => {
      openChat = callback
      return () => {}
    })

    render(<DesktopDeepLinkBridge />)
    await waitFor(() => expect(openChat).toBeTypeOf('function'))
    openChat?.('conversation-from-notification')

    await waitFor(() => {
      expect(store.selectConversation).toHaveBeenCalledWith('conversation-from-notification')
    })
  })
})
