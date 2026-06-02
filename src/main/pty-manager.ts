import { randomUUID } from 'crypto'
import { BrowserWindow, webContents } from 'electron'
import type { IPty } from 'node-pty'
import { createRequire } from 'module'

interface PtySession {
  pty: IPty
  ownerWebContentsId: number
}

const sessions = new Map<string, PtySession>()
const require = createRequire(import.meta.url)

function getOwnerWindow(ownerWebContentsId: number): BrowserWindow | null {
  const ownerContents = webContents.fromId(ownerWebContentsId)
  return ownerContents ? BrowserWindow.fromWebContents(ownerContents) : null
}

function getNodePty(): typeof import('node-pty') {
  return require('node-pty') as typeof import('node-pty')
}

export function spawnPty(
  ownerWebContentsId: number,
  shell: string,
  args: string[],
  cwd: string,
  cols: number,
  rows: number
): string {
  const nodePty = getNodePty()
  const sessionId = randomUUID()
  const pty = nodePty.spawn(shell, args, { name: 'xterm-256color', cols, rows, cwd })
  sessions.set(sessionId, { pty, ownerWebContentsId })

  pty.onData((data) => {
    const win = getOwnerWindow(ownerWebContentsId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('cli:data', { sessionId, data })
    }
  })

  pty.onExit(({ exitCode }) => {
    sessions.delete(sessionId)
    const win = getOwnerWindow(ownerWebContentsId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('cli:exit', { sessionId, code: exitCode })
    }
  })

  return sessionId
}

export function writeToPty(callerWebContentsId: number, sessionId: string, data: string): void {
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`PTY session ${sessionId} not found`)
  if (session.ownerWebContentsId !== callerWebContentsId) throw new Error('Unauthorized')
  session.pty.write(data)
}

export function resizePty(callerWebContentsId: number, sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`PTY session ${sessionId} not found`)
  if (session.ownerWebContentsId !== callerWebContentsId) throw new Error('Unauthorized')
  session.pty.resize(cols, rows)
}

export function killPty(callerWebContentsId: number, sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  if (session.ownerWebContentsId !== callerWebContentsId) throw new Error('Unauthorized')
  session.pty.kill()
  sessions.delete(sessionId)
}

export function cleanupAll(): void {
  for (const { pty } of sessions.values()) {
    try {
      pty.kill()
    } catch {
      // Best-effort cleanup for closing app/test teardown.
    }
  }
  sessions.clear()
}
