import { safeHandle } from './safe-handle'
import { spawnPty, writeToPty, resizePty, killPty } from './pty-manager'

export function registerPtyHandlers(): void {
  safeHandle('cli:spawn', async (event, shell: string, args: string[], cwd: string, cols: number, rows: number) => {
    const sessionId = spawnPty(event.sender.id, shell, args, cwd, cols ?? 80, rows ?? 24)
    return { sessionId }
  })

  safeHandle('cli:write', async (event, sessionId: string, data: string) => {
    writeToPty(event.sender.id, sessionId, data)
  })

  safeHandle('cli:resize', async (event, sessionId: string, cols: number, rows: number) => {
    resizePty(event.sender.id, sessionId, cols, rows)
  })

  safeHandle('cli:kill', async (event, sessionId: string) => {
    killPty(event.sender.id, sessionId)
  })
}
