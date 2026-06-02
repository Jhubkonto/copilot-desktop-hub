import type { StateCreator } from 'zustand'
import { isApiError } from '../../../shared/types'
import type { AppState } from '../app-store'
import type { AuthState } from '../types'

export interface AuthSlice {
  authState: AuthState
  authLoading: boolean
  checkAuth: () => Promise<void>
  loginByok: () => Promise<void>
  logout: () => Promise<void>
}

export const createAuthSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  AuthSlice
> = (set, get) => ({
  authState: { authenticated: false, mode: 'none', user: null, cliInstalled: false },
  authLoading: false,

  checkAuth: async () => {
    const result = await window.api.authStatus()
    set((s) => {
      s.authState = { ...result, cliInstalled: result.cliInstalled ?? false }
    })
  },

  loginByok: async () => {
    const result = await window.api.authLoginByok()
    if (!isApiError(result) && result.success) {
      set((s) => {
        s.authState = { authenticated: true, mode: 'byok', user: null, cliInstalled: s.authState.cliInstalled }
      })
    }
  },

  logout: async () => {
    try {
      const result = await window.api.authLogout()
      if (isApiError(result)) {
        get().addToast('Logout failed: ' + result.error, 'error')
        return
      }
      set((s) => {
        s.authState = { authenticated: false, mode: 'none', user: null, cliInstalled: s.authState.cliInstalled }
      })
    } catch {
      get().addToast('Logout failed. Please try again.', 'error')
    }
  },
})
