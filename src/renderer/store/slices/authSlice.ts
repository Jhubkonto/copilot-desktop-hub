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
  authState: {
    authenticated: false,
    mode: 'none',
    user: null,
    cliInstalled: false,
    clis: { claude: false, codex: false },
  },
  authLoading: false,

  checkAuth: async () => {
    const result = await window.api.authStatus()
    set((s) => {
      const clis = result.clis ?? { claude: result.cliInstalled ?? false, codex: false }
      s.authState = {
        ...result,
        cliInstalled: result.cliInstalled ?? (clis.claude || clis.codex),
        clis,
      }
    })
  },

  loginByok: async () => {
    const result = await window.api.authLoginByok()
    if (!isApiError(result) && result.success) {
      set((s) => {
        s.authState = {
          authenticated: true,
          mode: 'byok',
          user: null,
          cliInstalled: s.authState.cliInstalled,
          clis: s.authState.clis,
        }
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
        s.authState = {
          authenticated: false,
          mode: 'none',
          user: null,
          cliInstalled: s.authState.cliInstalled,
          clis: s.authState.clis,
        }
      })
    } catch {
      get().addToast('Logout failed. Please try again.', 'error')
    }
  },
})
