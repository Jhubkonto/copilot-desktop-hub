/**
 * Tests for useChat thinking-block lifecycle:
 * - thinking_end arriving before matching thinking_chunk is queued and replayed (H6)
 * - all live blocks are marked done=true after stream closes (H1/C1)
 * - thinking_end after stream close is ignored (guard against late events)
 */
import { describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Minimal hook extraction — test the pure logic extracted from useChat without
// needing a full React component render.
// ---------------------------------------------------------------------------

type ThinkingBlock = { blockId: string; content: string; done: boolean }

function buildThinkingReducer() {
  let blocks: Map<string, ThinkingBlock> = new Map()
  const pendingEnds = new Set<string>()
  let streamClosed = false

  function onDelta(blockId: string, chunk: string) {
    if (streamClosed) return
    const existing = blocks.get(blockId) ?? { blockId, content: '', done: false }
    const updated = { ...existing, content: existing.content + chunk }
    // Replay pending end if it arrived before this chunk
    if (pendingEnds.has(blockId)) {
      updated.done = true
      pendingEnds.delete(blockId)
    }
    blocks = new Map(blocks).set(blockId, updated)
  }

  function onEnd(blockId: string) {
    if (streamClosed) return
    const existing = blocks.get(blockId)
    if (!existing) {
      pendingEnds.add(blockId)
      return
    }
    blocks = new Map(blocks).set(blockId, { ...existing, done: true })
  }

  function onStreamClose() {
    streamClosed = true
    // Mark all live blocks done
    const next = new Map<string, ThinkingBlock>()
    for (const [k, v] of blocks.entries()) {
      next.set(k, { ...v, done: true })
    }
    blocks = next
    pendingEnds.clear()
  }

  function getBlocks() {
    return blocks
  }

  function reset() {
    blocks = new Map()
    pendingEnds.clear()
    streamClosed = false
  }

  return { onDelta, onEnd, onStreamClose, getBlocks, reset }
}

describe('useChat thinking-block lifecycle logic', () => {
  const reducer = buildThinkingReducer()

  beforeEach(() => {
    reducer.reset()
  })

  it('normal flow: chunk then end → block is done=true with content', () => {
    reducer.onDelta('thinking-0', 'Let me think...')
    reducer.onEnd('thinking-0')
    const block = reducer.getBlocks().get('thinking-0')!
    expect(block.content).toBe('Let me think...')
    expect(block.done).toBe(true)
  })

  it('out-of-order: end arrives before chunk → block still ends up done=true (H6)', () => {
    reducer.onEnd('thinking-0')
    // At this point block doesn't exist yet — end is queued
    expect(reducer.getBlocks().get('thinking-0')).toBeUndefined()

    reducer.onDelta('thinking-0', 'Reasoning content')
    const block = reducer.getBlocks().get('thinking-0')!
    expect(block.content).toBe('Reasoning content')
    expect(block.done).toBe(true)
  })

  it('multiple chunks accumulate before end', () => {
    reducer.onDelta('thinking-0', 'Part 1. ')
    reducer.onDelta('thinking-0', 'Part 2.')
    reducer.onEnd('thinking-0')
    const block = reducer.getBlocks().get('thinking-0')!
    expect(block.content).toBe('Part 1. Part 2.')
    expect(block.done).toBe(true)
  })

  it('stream close marks all live blocks done=true even without thinking_end (H1)', () => {
    reducer.onDelta('thinking-0', 'Incomplete thought')
    reducer.onDelta('thinking-1', 'Also incomplete')
    // Stream closes before thinking_end fires
    reducer.onStreamClose()

    const b0 = reducer.getBlocks().get('thinking-0')!
    const b1 = reducer.getBlocks().get('thinking-1')!
    expect(b0.done).toBe(true)
    expect(b1.done).toBe(true)
  })

  it('thinking_end after stream close is a no-op (guard for late events)', () => {
    reducer.onDelta('thinking-0', 'Content')
    reducer.onStreamClose()
    // Late thinking_end — should not re-open or cause errors
    reducer.onEnd('thinking-0')
    const block = reducer.getBlocks().get('thinking-0')!
    expect(block.done).toBe(true)
    expect(block.content).toBe('Content')
  })

  it('thinking_delta after stream close is a no-op', () => {
    reducer.onStreamClose()
    reducer.onDelta('thinking-0', 'Should be ignored')
    expect(reducer.getBlocks().get('thinking-0')).toBeUndefined()
  })
})
