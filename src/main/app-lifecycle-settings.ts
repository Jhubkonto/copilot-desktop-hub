import { app } from 'electron'
import { getDatabase } from './database'

export const AUTO_START_SETTING = 'autoStart'
export const RUN_IN_BACKGROUND_SETTING = 'runInBackground'
const AUTO_START_ARGS = ['--hidden']

export function isBooleanSettingEnabled(key: string): boolean {
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value === 'true'
}

export function isRunInBackgroundEnabled(): boolean {
  return isBooleanSettingEnabled(RUN_IN_BACKGROUND_SETTING)
}

/** Keep the OS login item and the persisted setting in sync, regardless of whether the
 * change originated on desktop or from the Android companion. */
export function setAutoStartEnabled(enabled: boolean): void {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(AUTO_START_SETTING, String(enabled))

  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: enabled ? AUTO_START_ARGS : [],
  })
}

/** Electron matches login-item state by arguments, so reads must use the same args as writes. */
export function isAutoStartEnabled(): boolean {
  return app.getLoginItemSettings({ args: AUTO_START_ARGS }).openAtLogin
}

export function applyStoredAutoStartSetting(): void {
  setAutoStartEnabled(isBooleanSettingEnabled(AUTO_START_SETTING))
}

/** Apply side effects for lifecycle settings written through a generic settings API. */
export function applyLifecycleSetting(key: string, value: string): void {
  if (key === AUTO_START_SETTING) {
    setAutoStartEnabled(value === 'true')
  }
}
