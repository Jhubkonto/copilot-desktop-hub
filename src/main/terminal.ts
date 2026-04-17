import { spawn, ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'

const terminals = new Map<string, ChildProcess>()

function getDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

export function registerTerminalHandlers(): void {
  safeHandle('terminal:create', (event, id: string, cwd?: string) => {
    const shell = getDefaultShell()
    const proc = spawn(shell, [], {
      cwd: cwd || process.env.HOME || process.env.USERPROFILE || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const window = BrowserWindow.fromWebContents(event.sender)

    proc.stdout?.on('data', (data: Buffer) => {
      window?.webContents.send('terminal:data', id, data.toString())
    })

    proc.stderr?.on('data', (data: Buffer) => {
      window?.webContents.send('terminal:data', id, data.toString())
    })

    proc.on('exit', (code) => {
      window?.webContents.send('terminal:exit', id, code)
      terminals.delete(id)
    })

    proc.on('error', (err) => {
      window?.webContents.send(
        'terminal:data',
        id,
        `\r\nTerminal error: ${err.message}\r\n`
      )
    })

    terminals.set(id, proc)
    return true
  })

  safeHandle('terminal:write', (_event, id: string, data: string) => {
    const proc = terminals.get(id)
    if (proc?.stdin?.writable) {
      proc.stdin.write(data)
      return true
    }
    return false
  })

  safeHandle('terminal:dispose', (_event, id: string) => {
    const proc = terminals.get(id)
    if (proc) {
      proc.kill()
      terminals.delete(id)
    }
    return true
  })
}

export function disposeAllTerminals(): void {
  for (const [, proc] of terminals) {
    proc.kill()
  }
  terminals.clear()
}
