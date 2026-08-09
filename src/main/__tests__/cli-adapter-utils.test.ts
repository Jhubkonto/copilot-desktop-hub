import { describe, it, expect, vi, afterEach } from 'vitest'
import { stripAnsi, createLineBuffer, createOpenBlockTracker, buildCliChildEnv, createInactivityWatchdog } from '../cli-adapters/utils'

describe('stripAnsi', () => {
  it('removes SGR color codes and leaves text intact', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m plain')).toBe('red plain')
    expect(stripAnsi('no codes')).toBe('no codes')
  })
})

describe('createLineBuffer', () => {
  it('emits complete lines and buffers partial ones across chunks', () => {
    const lines: string[] = []
    const buf = createLineBuffer((l) => lines.push(l))
    buf.push('{"a":1}\n{"b"')
    expect(lines).toEqual(['{"a":1}'])
    buf.push(':2}\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(buf.remainder()).toBe('')
  })

  it('exposes the unterminated tail as remainder', () => {
    const buf = createLineBuffer(() => {})
    buf.push('partial line without newline')
    expect(buf.remainder()).toBe('partial line without newline')
  })

  it('handles Buffer chunks', () => {
    const lines: string[] = []
    const buf = createLineBuffer((l) => lines.push(l))
    buf.push(Buffer.from('hello\nworld'))
    expect(lines).toEqual(['hello'])
    expect(buf.remainder()).toBe('world')
  })

  it('drops an unterminated line that grows past maxLineBytes but keeps working after', () => {
    const lines: string[] = []
    const buf = createLineBuffer((l) => lines.push(l), 10)
    buf.push('12345678901234567890') // 20 chars, no newline → exceeds cap → dropped
    expect(buf.remainder()).toBe('')
    buf.push('short\n')
    expect(lines).toEqual(['short'])
  })

  it('still emits a complete line longer than the cap (only unterminated partials drop)', () => {
    const lines: string[] = []
    const buf = createLineBuffer((l) => lines.push(l), 10)
    buf.push('a-very-long-complete-line-over-the-cap\n')
    expect(lines).toEqual(['a-very-long-complete-line-over-the-cap'])
    expect(buf.remainder()).toBe('')
  })
})

describe('buildCliChildEnv', () => {
  const saved = { ...process.env }
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  })

  it('strips Electron/Node runtime-injected vars but preserves user auth vars', () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    process.env.NODE_OPTIONS = '--require /tmp/inject.js'
    process.env.ANTHROPIC_API_KEY = 'sk-user-key'
    const env = buildCliChildEnv()
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe('sk-user-key')
  })

  it('applies overrides on top of the sanitized env without mutating process.env', () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    const env = buildCliChildEnv({ HERMES_ACP_SKIP_CONFIGURED_MCP: '1' })
    expect(env.HERMES_ACP_SKIP_CONFIGURED_MCP).toBe('1')
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    // Original environment is untouched — sanitization happens on a copy.
    expect(process.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})

describe('createInactivityWatchdog', () => {
  afterEach(() => { vi.useRealTimers() })

  it('fires once after sustained silence, and touch() resets the timer', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const wd = createInactivityWatchdog(1000, onTimeout, 100)

    vi.advanceTimersByTime(900)
    expect(onTimeout).not.toHaveBeenCalled()
    wd.touch() // fresh activity — the 1000ms clock restarts from here
    vi.advanceTimersByTime(900)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200) // now 1100ms since the last touch
    expect(onTimeout).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect(onTimeout).toHaveBeenCalledTimes(1) // fires at most once
    wd.clear()
  })

  it('does not fire after clear()', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const wd = createInactivityWatchdog(1000, onTimeout, 100)
    wd.clear()
    vi.advanceTimersByTime(5000)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})

describe('createOpenBlockTracker', () => {
  it('reuses the open block id until interrupted', () => {
    const tracker = createOpenBlockTracker('thinking')
    expect(tracker.next()).toBe('thinking-0')
    expect(tracker.next()).toBe('thinking-0')
    tracker.interrupt()
    expect(tracker.current).toBeNull()
    expect(tracker.next()).toBe('thinking-1')
  })

  it('exposes the current open id', () => {
    const tracker = createOpenBlockTracker('text')
    expect(tracker.current).toBeNull()
    tracker.next()
    expect(tracker.current).toBe('text-0')
  })
})
