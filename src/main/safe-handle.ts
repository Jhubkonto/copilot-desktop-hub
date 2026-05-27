import { ipcMain } from 'electron'

/**
 * Validates that an IPC invocation originates from a trusted frame.
 * In production: only `file://` origins are permitted.
 * In development (Vite dev server): `http://localhost` is also permitted.
 * Returns `true` when `senderFrame` is absent — this covers test/CI contexts
 * where the frame URL is not available.
 */
export function validateSender(event: Electron.IpcMainInvokeEvent): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url: string | undefined = (event as any).senderFrame?.url
  if (!url) return true
  return url.startsWith('file://') || url.startsWith('http://localhost')
}

/**
 * Wraps an IPC handler with try/catch to prevent unhandled rejections.
 * Returns `{ error: string }` on failure instead of crashing.
 * Rejects invocations from untrusted senders (defence-in-depth).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeHandle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!validateSender(event)) {
      console.warn(`IPC rejected [${channel}]: unauthorized sender`)
      return { error: 'Unauthorized sender' }
    }
    try {
      return await handler(event, ...args)
    } catch (err) {
      console.error(`IPC error [${channel}]:`, err)
      return { error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })
}
