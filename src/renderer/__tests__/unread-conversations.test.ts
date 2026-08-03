import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createUiSlice, type UiSlice } from '../store/slices/uiSlice'

function createTestStore() {
  return create<UiSlice>()(
    immer((set, get, store) => createUiSlice(set, get as never, store as never) as never) as never,
  )
}

describe('unread conversation reconciliation', () => {
  it('combines persisted background unread chats with renderer-only scroll unread state', () => {
    const store = createTestStore()

    store.getState().markConversationUnread('open-chat')
    store.getState().syncUnreadConversationIds(['background-chat'])

    expect(store.getState().unreadConversationIds).toEqual(['open-chat', 'background-chat'])

    store.getState().syncUnreadConversationIds([])
    expect(store.getState().unreadConversationIds).toEqual(['open-chat'])
  })

  it('optimistically clears both unread sources when a chat is viewed', () => {
    const store = createTestStore()

    store.getState().syncUnreadConversationIds(['background-chat'])
    store.getState().markConversationRead('background-chat')

    expect(store.getState().unreadConversationIds).toEqual([])
    expect(store.getState().syncedUnreadConversationIds).toEqual([])
  })
})
