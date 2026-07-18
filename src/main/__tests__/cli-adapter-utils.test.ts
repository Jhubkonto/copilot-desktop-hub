import { describe, it, expect } from 'vitest'
import { stripAnsi, createLineBuffer, createOpenBlockTracker } from '../cli-adapters/utils'

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
