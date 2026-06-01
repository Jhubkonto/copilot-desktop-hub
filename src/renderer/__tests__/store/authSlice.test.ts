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
      user: { login: 'user1', avatar_url: 'url', name: 'User 1' }
    })

    await store.getState().checkAuth()

    expect(store.getState().authState).toEqual({
      authenticated: true,
      user: { login: 'user1', avatar_url: 'url', name: 'User 1' }
    })
  })

  it('login sets authenticated state and clears loading state', async () => {
    const store = createAuthStore()
    mockApi.authLogin.mockResolvedValue({
      success: true,
      user: { login: 'octocat', avatar_url: 'url', name: 'Octo Cat' }
    })

    await store.getState().login()

    expect(store.getState().authState).toEqual({
      authenticated: true,
      mode: 'copilot',
      user: { login: 'octocat', avatar_url: 'url', name: 'Octo Cat' }
    })
    expect(store.getState().authLoading).toBe(false)
    expect(store.getState().deviceCode).toBeNull()
    expect(store.getState().toasts[0]?.type).toBe('success')
  })

  it('logout clears authenticated user state', async () => {
    const store = createAuthStore()
    store.setState({
      authState: {
        authenticated: true,
        mode: 'copilot' as const,
        user: { login: 'octocat', avatar_url: 'url', name: 'Octo Cat' }
      }
    })

    await store.getState().logout()

    expect(store.getState().authState).toEqual({
      authenticated: false,
      mode: 'none',
      user: null
    })
  })

  it('setDeviceCode updates and clears the device code state', () => {
    const store = createAuthStore()

    store.getState().setDeviceCode({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device'
    })
    expect(store.getState().deviceCode).toEqual({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device'
    })

    store.getState().setDeviceCode(null)
    expect(store.getState().deviceCode).toBeNull()
  })
})
