import { ipcMain } from 'electron'

/**
 * Wraps an IPC handler with try/catch to prevent unhandled rejections.
 * Returns `{ error: string }` on failure instead of crashing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeHandle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      console.error(`IPC error [${channel}]:`, err)
      return { error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })
}
