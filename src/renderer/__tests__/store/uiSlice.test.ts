import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { StateCreator } from 'zustand'
import { createUiSlice, type UiSlice } from '../../store/slices/uiSlice'
import type { AgentSlice } from '../../store/slices/agentSlice'
import { setupMockApi, type MockApi } from '../../../test/mocks/api'

let mockApi: MockApi

type TestState = UiSlice & Pick<AgentSlice, 'showAgentPanel'>

function createUiStore() {
  return create<TestState>()(
    immer((set, get, store) => ({
      showAgentPanel: false,
      ...(
        createUiSlice as unknown as StateCreator<
          TestState,
          [['zustand/immer', never]],
          [],
          UiSlice
        >
      )(set, get, store)
    }))
  )
}

beforeEach(() => {
  mockApi = setupMockApi()
  document.documentElement.className = ''
  vi.stubGlobal('crypto', { randomUUID: () => 'toast-id' })
})

describe('uiSlice', () => {
  it('manages the toast queue', () => {
    const store = createUiStore()

    store.getState().addToast('Saved', 'success')
    store.getState().addToast('Heads up')
    expect(store.getState().toasts).toEqual([
      { id: 'toast-id', message: 'Saved', type: 'success' },
      { id: 'toast-id', message: 'Heads up', type: 'info' }
    ])

    store.getState().dismissToast('toast-id')
    expect(store.getState().toasts).toEqual([])
  })

  it('handles tool approval add/respond flow', async () => {
    const store = createUiStore()
    store.getState().addToolApprovalRequest({
      requestId: 'req-1',
      tool: 'fileWrite',
      args: { path: 'test.txt' },
      description: 'Write file'
    })

    await store.getState().respondToToolApproval('req-1', true, true)

    expect(mockApi.respondToToolApproval).toHaveBeenCalledWith('req-1', true, true)
    expect(store.getState().toolApprovalRequests).toEqual([])
  })

  it('toggleTheme flips theme, updates DOM, and persists via IPC', () => {
    const store = createUiStore()

    store.getState().toggleTheme()

    expect(store.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(mockApi.setTheme).toHaveBeenCalledWith('light')
  })

  it('toggles sidebar, terminal, and agent panel visibility', () => {
    const store = createUiStore()

    store.getState().toggleSidebar()
    store.getState().toggleTerminal()
    store.getState().toggleAgentPanel()
    store.getState().setShowMcpPanel(true)

    expect(store.getState().showSidebar).toBe(false)
    expect(store.getState().showTerminal).toBe(true)
    expect(store.getState().showAgentPanel).toBe(true)
    expect(store.getState().showMcpPanel).toBe(true)
  })
})
