import { beforeEach, describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { StateCreator } from 'zustand'
import { createAuthSlice, type AuthSlice } from '../../store/slices/authSlice'
import type { UiSlice } from '../../store/slices/uiSlice'
import { setupMockApi, type MockApi } from '../../../test/mocks/api'

let mockApi: MockApi

type TestState = AuthSlice & Pick<UiSlice, 'toasts' | 'addToast'>

function createAuthStore() {
  return create<TestState>()(
    immer((set, get, store) => ({
      toasts: [],
      addToast: (message, type = 'info') => {
        const id = `toast-${get().toasts.length + 1}`
        set((s) => {
          s.toasts.push({ id, message, type })
        })
      },
      ...(
        createAuthSlice as unknown as StateCreator<
          TestState,
          [['zustand/immer', never]],
          [],
          AuthSlice
        >
      )(set, get, store)
    }))
  )
}

beforeEach(() => {
  mockApi = setupMockApi()
})

describe('authSlice', () => {
  it('checkAuth updates auth state from IPC', async () => {
    const store = createAuthStore()
    mockApi.authStatus.mockResolvedValue({
      authenticated: true,
      mode: 'byok',
      user: null,
      cliInstalled: false,
    })

    await store.getState().checkAuth()

    expect(store.getState().authState).toEqual({
      authenticated: true,
      mode: 'byok',
      user: null,
      cliInstalled: false,
    })
  })

  it('loginByok enables BYOK auth mode', async () => {
    const store = createAuthStore()
    mockApi.authLoginByok.mockResolvedValue({ success: true })

    await store.getState().loginByok()

    expect(store.getState().authState).toEqual({
      authenticated: true,
      mode: 'byok',
      user: null,
      cliInstalled: false,
    })
    expect(store.getState().authLoading).toBe(false)
  })

  it('logout clears authenticated state', async () => {
    const store = createAuthStore()
    store.setState({
      authState: {
        authenticated: true,
        mode: 'byok',
        user: null,
        cliInstalled: false,
      }
    })

    await store.getState().logout()

    expect(store.getState().authState).toEqual({
      authenticated: false,
      mode: 'none',
      user: null,
      cliInstalled: false,
    })
  })

  it('logout errors surface as toasts', async () => {
    const store = createAuthStore()
    store.setState({
      authState: {
        authenticated: true,
        mode: 'byok',
        user: null,
        cliInstalled: false,
      }
    })
    mockApi.authLogout.mockResolvedValue({ error: 'fail' })

    await store.getState().logout()

    expect(store.getState().authState.authenticated).toBe(true)
    expect(store.getState().toasts[0]?.type).toBe('error')
  })
})
