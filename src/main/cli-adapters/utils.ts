import { execFile, execSync, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { debugLog, debugTime, debugTimeEnd } from '../debug-mode'

const cache = new Map<string, string>()
const negativeCacheAt = new Map<string, number>()

// A found CLI path is cached for the whole session (it does not move). A *negative*
// result is only trusted briefly: without this, a user who installs the CLI after Nexy
// has launched would see "not found" until an app restart, because the first failed
// probe stuck permanently. Re-probe once the negative entry ages past this window.
const NEGATIVE_CACHE_TTL_MS = 15_000
// `where`/`which` is normally instant, but a wedged filesystem or a hung shim can make it
// block forever. Cap it so a bad probe cannot freeze the main process (and thus the UI) —
// matching the 5s ceiling every probe in cli-detection.ts already uses.
const RESOLVE_TIMEOUT_MS = 5000

function resolveCommand(): string {
  return process.platform === 'win32' ? 'where.exe' : 'which'
}

function firstPathLine(output: string): string | null {
  // Split on CRLF or LF — `where.exe` emits CRLF, and a stray `\r` left on the path
  // would make the resolved executable un-spawnable.
  return output.split(/\r?\n/)[0].trim() || null
}

export function resolveCliPath(name: string): string | null {
  const positive = cache.get(name)
  if (positive !== undefined) {
    debugLog('cli', `resolveCliPath cache hit: ${name} -> ${positive}`)
    return positive
  }
  const negativeAt = negativeCacheAt.get(name)
  if (negativeAt !== undefined && Date.now() - negativeAt < NEGATIVE_CACHE_TTL_MS) {
    return null
  }
  const timer = `resolveCliPath where ${name}`
  debugTime(timer)
  try {
    const output = execSync(`${resolveCommand()} ${name}`, { encoding: 'utf8', timeout: RESOLVE_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    const result = firstPathLine(output)
    if (result) {
      cache.set(name, result)
      negativeCacheAt.delete(name)
    } else {
      negativeCacheAt.set(name, Date.now())
    }
    debugTimeEnd(timer)
    return result
  } catch {
    negativeCacheAt.set(name, Date.now())
    debugTimeEnd(timer)
    return null
  }
}

/**
 * Asynchronous counterpart used by main-process discovery and UI-facing IPC handlers.
 * PATH resolution invokes an external helper (`where.exe`/`which`), so it must not use
 * the synchronous variant on Electron's main thread.
 */
export function resolveCliPathAsync(name: string): Promise<string | null> {
  const positive = cache.get(name)
  if (positive !== undefined) {
    debugLog('cli', `resolveCliPathAsync cache hit: ${name} -> ${positive}`)
    return Promise.resolve(positive)
  }
  const negativeAt = negativeCacheAt.get(name)
  if (negativeAt !== undefined && Date.now() - negativeAt < NEGATIVE_CACHE_TTL_MS) {
    return Promise.resolve(null)
  }

  const timer = `resolveCliPathAsync ${resolveCommand()} ${name}`
  debugTime(timer)
  return new Promise((resolve) => {
    execFile(resolveCommand(), [name], {
      encoding: 'utf8',
      timeout: RESOLVE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      const result = !error && typeof stdout === 'string' ? firstPathLine(stdout) : null
      if (result) {
        cache.set(name, result)
        negativeCacheAt.delete(name)
      } else {
        negativeCacheAt.set(name, Date.now())
      }
      debugTimeEnd(timer)
      resolve(result)
    })
  })
}

export function clearCliPathCache(): void {
  cache.clear()
  negativeCacheAt.clear()
}

// Environment variables that must never propagate from the Electron main process into a
// spawned CLI child. These are injected by the Electron/Node *runtime*, not the user, and
// leaking them reconfigures or breaks the child: ELECTRON_RUN_AS_NODE makes a Node-based
// CLI (claude/codex/hermes) start in bare-node mode, and NODE_OPTIONS can carry an injected
// `--require`/`--inspect` that crashes or instruments the child. User-owned auth vars
// (ANTHROPIC_API_KEY, CODEX_*, proxy base URLs, …) are deliberately preserved — they are how
// the CLI authenticates, so stripping them would break legitimate setups.
const STRIPPED_CHILD_ENV_KEYS = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'] as const

/**
 * Build the environment for a spawned CLI child: the inherited process environment with
 * Electron/Node runtime-injected variables removed (see {@link STRIPPED_CHILD_ENV_KEYS}),
 * plus any explicit overrides. Every CLI spawn should route its `env` through this rather
 * than passing `process.env` (or omitting `env`, which inherits it) directly.
 */
export function buildCliChildEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of STRIPPED_CHILD_ENV_KEYS) delete env[key]
  return overrides ? { ...env, ...overrides } : env
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

// The Claude/Codex CLIs surface an expired OAuth session as a raw, developer-facing string
// (typically "Failed to authenticate: OAuth session expired and could not be refreshed").
// Nexy used to relay that verbatim into the chat, which reads like a Nexy-internal failure
// rather than what it actually is: the CLI's *own* locally-stored login has expired and
// must be renewed by running that CLI's login command directly in a terminal — Nexy cannot
// do this on the user's behalf, since the CLI performs an interactive browser OAuth flow.
const OAUTH_EXPIRED_PATTERN = /oauth session expired|could not be refreshed|token.*expired.*refresh/i

const CLI_LOGIN_HINTS: Partial<Record<string, { cliName: string; loginCommand: string }>> = {
  'claude-cli': { cliName: 'Claude CLI', loginCommand: 'claude login' },
  'codex-cli': { cliName: 'Codex CLI', loginCommand: 'codex login' },
  'hermes-cli': { cliName: 'Hermes CLI', loginCommand: 'hermes login' },
}

/**
 * Rewrite a raw CLI error into a clearer message when it indicates an expired OAuth
 * session, telling the user which CLI to re-authenticate and how. Non-matching errors are
 * returned unchanged.
 */
export function clarifyCliAuthError(message: string, backend?: string): string {
  if (!OAUTH_EXPIRED_PATTERN.test(message)) return message
  const hint = backend ? CLI_LOGIN_HINTS[backend] : undefined
  const cliName = hint?.cliName ?? 'the CLI'
  const loginCommand = hint?.loginCommand ?? '<cli> login'
  return (
    `Your ${cliName} login has expired. Nexy can't renew it automatically — open a terminal ` +
    `and run \`${loginCommand}\` to sign in again, then retry this message. ` +
    `(Original error: ${message})`
  )
}

/** Default cap for a single unterminated line in {@link createLineBuffer}. A JSONL line
 *  larger than this is pathological (a CLI streaming a huge unstructured blob with no
 *  newline); dropping the partial protects the main process from unbounded growth. */
const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024

/**
 * Newline-delimited stdout accumulator shared by the CLI adapters' JSONL
 * streams: buffers partial lines across chunks, emits each complete line,
 * and exposes the trailing unterminated remainder for close-time handling.
 *
 * `maxLineBytes` bounds a single newline-less line: if the pending buffer grows past it
 * (a runaway tool dumping megabytes with no line break), the partial is discarded so the
 * buffer cannot grow without limit. Complete, newline-terminated lines are never affected.
 */
export function createLineBuffer(onLine: (line: string) => void, maxLineBytes = DEFAULT_MAX_LINE_BYTES) {
  let buffer = ''
  return {
    push(chunk: Buffer | string): void {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine(line)
      // Safety valve: an unterminated line past the cap is unparseable JSONL anyway.
      if (buffer.length > maxLineBytes) buffer = ''
    },
    /** The unterminated tail after the last newline (checked on process close). */
    remainder(): string {
      return buffer
    },
  }
}

/**
 * Inactivity watchdog for a streaming CLI turn. `touch()` records fresh output; if
 * `timeoutMs` passes with no `touch()`, `onTimeout` fires exactly once. Used so a wedged
 * CLI (network stall, deadlocked tool subprocess) settles the turn instead of hanging
 * forever — the JSON-RPC-style paths have no heartbeat of their own. Poll interval is
 * coarse (default 10s) because the threshold is minutes; the timer is unref'd so it never
 * keeps the process alive on its own.
 */
export function createInactivityWatchdog(timeoutMs: number, onTimeout: () => void, checkIntervalMs = 10_000) {
  let lastActivityAt = Date.now()
  let fired = false
  const timer = setInterval(() => {
    if (fired) return
    if (Date.now() - lastActivityAt < timeoutMs) return
    fired = true
    clearInterval(timer)
    onTimeout()
  }, checkIntervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return {
    touch(): void { lastActivityAt = Date.now() },
    clear(): void { clearInterval(timer) },
  }
}

// Complete-stdout-silence threshold for the Claude `--print` and Codex `exec` turns.
// Generous on purpose: a legitimate long-running tool (a slow build) emits nothing on the
// CLI's JSON stream while it runs, so a short window would kill real work. Ten minutes of
// *total* silence reliably indicates a genuine wedge without tripping on honest long tools.
export const CLI_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000

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
