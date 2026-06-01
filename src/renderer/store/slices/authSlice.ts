import type { StateCreator } from 'zustand'
import { isApiError } from '../../../shared/types'
import type { AppState } from '../app-store'
import type { AuthState, DeviceCode } from '../types'

export interface AuthSlice {
  authState: AuthState
  deviceCode: DeviceCode | null
  authLoading: boolean
  checkAuth: () => Promise<void>
  login: () => Promise<void>
  loginByok: () => Promise<void>
  logout: () => Promise<void>
  setDeviceCode: (code: DeviceCode | null) => void
}

export const createAuthSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  AuthSlice
> = (set, get) => ({
  authState: { authenticated: false, mode: 'none', user: null },
  deviceCode: null,
  authLoading: false,

  checkAuth: async () => {
    const result = await window.api.authStatus()
    set((s) => {
      s.authState = result
    })
  },

  login: async () => {
    set((s) => {
      s.authLoading = true
    })
    try {
      const result = await window.api.authLogin()
      set((s) => {
        s.deviceCode = null
        s.authLoading = false
      })
      if (isApiError(result)) {
        const msg =
          result.error === 'Device code expired'
            ? 'Login timed out. Please try again.'
            : result.error
        get().addToast(msg, 'error')
        return
      }
      if (result.success) {
        set((s) => {
          s.authState = { authenticated: true, mode: 'copilot', user: result.user ?? null }
        })
        get().addToast(
          `Signed in as ${result.user?.login ?? 'user'}`,
          'success'
        )
      }
    } catch {
      set((s) => {
        s.deviceCode = null
        s.authLoading = false
      })
      get().addToast('Login failed. Please try again.', 'error')
    }
  },

  loginByok: async () => {
    const result = await window.api.authLoginByok()
    if (!isApiError(result) && result.success) {
      set((s) => {
        s.authState = { authenticated: true, mode: 'byok', user: null }
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
        s.authState = { authenticated: false, mode: 'none', user: null }
      })
    } catch {
      get().addToast('Logout failed. Please try again.', 'error')
    }
  },

  setDeviceCode: (code) => {
    set((s) => {
      s.deviceCode = code
    })
  }
})