import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
}))

vi.mock('electron', () => ({
  app: {
    setLoginItemSettings: state.setLoginItemSettings,
    getLoginItemSettings: state.getLoginItemSettings,
  },
}))

vi.mock('../database', () => ({
  getDatabase: () => {
    if (!state.db) throw new Error('DB not initialized')
    return state.db
  },
}))

import { initializeBaseSchema } from '../database-migrations'
import {
  applyLifecycleSetting,
  isRunInBackgroundEnabled,
  isAutoStartEnabled,
  setAutoStartEnabled,
} from '../app-lifecycle-settings'

describe('app lifecycle settings', () => {
  beforeEach(() => {
    state.db = new Database(':memory:')
    initializeBaseSchema(state.db)
    state.setLoginItemSettings.mockReset()
    state.getLoginItemSettings.mockReset()
    state.getLoginItemSettings.mockReturnValue({ openAtLogin: false })
  })

  afterEach(() => {
    state.db?.close()
    state.db = null
  })

  it('persists auto-start and configures a hidden login launch', () => {
    setAutoStartEnabled(true)

    const row = state.db!.prepare("SELECT value FROM settings WHERE key = 'autoStart'").get() as { value: string }
    expect(row.value).toBe('true')
    expect(state.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: true,
      args: ['--hidden'],
    })
  })

  it('reads run-in-background and applies auto-start writes from generic settings APIs', () => {
    state.db!.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('runInBackground', 'true')").run()
    expect(isRunInBackgroundEnabled()).toBe(true)

    applyLifecycleSetting('autoStart', 'false')
    expect(state.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      openAsHidden: true,
      args: [],
    })
  })

  it('reads auto-start with the same hidden-launch arguments used when enabling it', () => {
    state.getLoginItemSettings.mockReturnValue({ openAtLogin: true })

    expect(isAutoStartEnabled()).toBe(true)
    expect(state.getLoginItemSettings).toHaveBeenCalledWith({ args: ['--hidden'] })
  })
})
