import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import { ClaudeAdapter } from './cli-adapters/claude'
import type { AuthMode } from '../shared/types'

export function storeAuthMode(mode: AuthMode): void {
  const db = getDatabase()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auth_mode', ?)").run(mode)
}

export function retrieveAuthMode(): AuthMode {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auth_mode'").get() as
    | { value: string }
    | undefined

  return row?.value === 'byok' ? 'byok' : 'none'
}

export function registerAuthHandlers(): void {
  safeHandle('auth:status', () => {
    const mode = retrieveAuthMode()
    return {
      authenticated: mode === 'byok',
      mode,
      user: null,
      cliInstalled: ClaudeAdapter.isAvailable(),
    }
  })

  safeHandle('auth:login-byok', () => {
    storeAuthMode('byok')
    return { success: true }
  })

  safeHandle('auth:logout', () => {
    const db = getDatabase()
    db.prepare("DELETE FROM settings WHERE key IN ('auth_token', 'auth_encrypted', 'auth_user')").run()
    storeAuthMode('none')
    return true
  })
}
