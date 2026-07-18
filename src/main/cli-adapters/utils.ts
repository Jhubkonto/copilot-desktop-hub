import { execSync, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { debugLog, debugTime, debugTimeEnd } from '../debug-mode'

const cache = new Map<string, string | null>()

export function resolveCliPath(name: string): string | null {
  if (cache.has(name)) {
    debugLog('cli', `resolveCliPath cache hit: ${name} -> ${cache.get(name)}`)
    return cache.get(name)!
  }
  const timer = `resolveCliPath where ${name}`
  debugTime(timer)
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${name}` : `which ${name}`
    const output = execSync(cmd, { encoding: 'utf8' }).trim()
    const result = output.split('\n')[0].trim() || null
    cache.set(name, result)
    debugTimeEnd(timer)
    return result
  } catch {
    cache.set(name, null)
    debugTimeEnd(timer)
    return null
  }
}

export function clearCliPathCache(): void {
  cache.clear()
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Newline-delimited stdout accumulator shared by the CLI adapters' JSONL
 * streams: buffers partial lines across chunks, emits each complete line,
 * and exposes the trailing unterminated remainder for close-time handling.
 */
export function createLineBuffer(onLine: (line: string) => void) {
  let buffer = ''
  return {
    push(chunk: Buffer | string): void {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    },
    /** The unterminated tail after the last newline (checked on process close). */
    remainder(): string {
      return buffer
    },
  }
}

/**
 * "Open block" id tracker used for reasoning/text segmentation: `next()` reuses
 * the current block id across consecutive events of the same kind, while
 * `interrupt()` closes it so the next event starts a fresh `${prefix}-N` block.
 * Prevents unrelated bursts (separated by tool calls or other content) from
 * silently merging under one block id.
 */
export function createOpenBlockTracker(prefix: string) {
  let seq = 0
  let openId: string | null = null
  return {
    next(): string {
      if (!openId) openId = `${prefix}-${seq++}`
      return openId
    },
    interrupt(): void {
      openId = null
    },
    get current(): string | null {
      return openId
    },
  }
}

/**
 * Kill a spawned process and its entire process tree.
 * On Windows, cmd.exe wrappers don't propagate SIGTERM to their children,
 * so we use taskkill /F /T to force-kill the whole tree by PID.
 */
export function killProcess(proc: ChildProcess): void {
  if (process.platform === 'win32' && proc.pid != null) {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { detached: true, stdio: 'ignore' }).unref()
    } catch {
      proc.kill()
    }
  } else {
    proc.kill()
  }
}
