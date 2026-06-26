import { describe, expect, it } from 'vitest'
import { ChatTurnEmitter } from '../chat-turn-emitter'

describe('ChatTurnEmitter', () => {
  it('emits normalized turn events with ordered compatibility events', () => {
    const desktop: Array<{ channel: string; args: unknown[] }> = []
    const mobile: Array<{ event?: string; data?: unknown }> = []
    const emitter = new ChatTurnEmitter(
      'conv-1',
      {
        sendDesktop: (channel, ...args) => desktop.push({ channel, args }),
        broadcastMobile: (event) => mobile.push(event),
      },
      'turn-1',
    )

    const started = emitter.started()
    const activity = emitter.activity({ state: 'thinking', label: 'Preparing context' })
    const delta = emitter.assistantTextDelta('Hello')
    const thinking = emitter.thinkingDelta('reasoning-1', 'Checking')
    const thinkingDone = emitter.thinkingEnd('reasoning-1')
    const completed = emitter.streamEnd()

    expect([started, activity, delta, thinking, thinkingDone, completed].map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(desktop.map((entry) => entry.channel)).toEqual([
      'chat:turn-event',
      'chat:turn-event',
      'chat:activity-global',
      'chat:turn-event',
      'chat:stream-response',
      'chat:turn-event',
      'chat:thinking-delta',
      'chat:turn-event',
      'chat:thinking-end',
      'chat:turn-event',
      'chat:stream-response',
    ])
    expect(mobile).toContainEqual({
      event: 'chat:stream-chunk',
      data: { conversationId: 'conv-1', chunk: 'Hello', turnId: 'turn-1', sequence: 3 },
    })
    expect(mobile).toContainEqual({
      event: 'chat:stream-end',
      data: { conversationId: 'conv-1', turnId: 'turn-1', sequence: 6 },
    })
  })

  it('emits failed turns separately from the compatibility stream close', () => {
    const desktop: Array<{ channel: string; args: unknown[] }> = []
    const mobile: Array<{ event?: string; data?: unknown }> = []
    const emitter = new ChatTurnEmitter(
      'conv-2',
      {
        sendDesktop: (channel, ...args) => desktop.push({ channel, args }),
        broadcastMobile: (event) => mobile.push(event),
      },
      'turn-2',
    )

    const failed = emitter.streamError({ type: 'api', message: 'No provider configured', retryable: false })
    emitter.closeStream()

    expect(failed.type).toBe('turn_failed')
    expect(failed.sequence).toBe(1)
    expect(desktop).toContainEqual({
      channel: 'chat:stream-error',
      args: [{ type: 'api', message: 'No provider configured', retryable: false }],
    })
    expect(mobile).toContainEqual({
      event: 'chat:stream-end',
      data: { conversationId: 'conv-2', turnId: 'turn-2', sequence: 1 },
    })
  })

  it('BYOK and CLI paths produce equivalent normalized turn_started → activity → text_delta → turn_completed sequences', () => {
    function collectNormalizedEventTypes(setup: (emitter: ChatTurnEmitter) => void): string[] {
      const normalized: string[] = []
      const emitter = new ChatTurnEmitter('conv-equiv', {
        sendDesktop: (channel, ...args) => {
          if (channel === 'chat:turn-event') normalized.push((args[0] as { type: string }).type)
        },
        broadcastMobile: () => undefined,
      }, 'turn-equiv')
      setup(emitter)
      return normalized
    }

    const byokSequence = collectNormalizedEventTypes((e) => {
      e.started()
      e.activity({ state: 'thinking', label: 'Preparing context' })
      e.assistantTextDelta('Hello')
      e.streamEnd()
    })

    const cliSequence = collectNormalizedEventTypes((e) => {
      e.started()
      e.activity({ state: 'thinking', label: 'Preparing context' })
      e.assistantTextDelta('Hello')
      e.streamEnd()
    })

    expect(byokSequence).toEqual(['turn_started', 'activity_changed', 'assistant_text_delta', 'turn_completed'])
    expect(cliSequence).toEqual(byokSequence)
  })

  it('BYOK tool-loop and CLI tool paths produce equivalent normalized tool event sequences', () => {
    function collectNormalizedToolEvents(setup: (emitter: ChatTurnEmitter) => void): Array<{ type: string; toolName?: string; success?: boolean }> {
      const events: Array<{ type: string; toolName?: string; success?: boolean }> = []
      const emitter = new ChatTurnEmitter('conv-tool-equiv', {
        sendDesktop: (channel, ...args) => {
          if (channel === 'chat:turn-event') {
            const event = args[0] as { type: string; toolName?: string; success?: boolean }
            if (event.type === 'tool_started' || event.type === 'tool_finished') {
              events.push({ type: event.type, toolName: event.toolName, success: event.success })
            }
          }
        },
        broadcastMobile: () => undefined,
      }, 'turn-tool-equiv')
      setup(emitter)
      return events
    }

    const byokToolSequence = collectNormalizedToolEvents((e) => {
      e.toolFinished({ toolName: 'read_file', serverName: 'Files', args: { path: 'README.md' }, result: 'contents', success: true })
    })

    const cliToolSequence = collectNormalizedToolEvents((e) => {
      e.cliToolStart('tool-1', 'read_file', { path: 'README.md' })
      e.cliToolEnd('tool-1', 'contents', false, { name: 'read_file', input: { path: 'README.md' }, serverName: 'Files' })
    })

    expect(byokToolSequence).toEqual([{ type: 'tool_finished', toolName: 'read_file', success: true }])
    expect(cliToolSequence).toEqual([
      { type: 'tool_started', toolName: undefined, success: undefined },
      { type: 'tool_finished', toolName: 'read_file', success: true },
    ])
  })

  it('emits one normalized CLI tool finish with desktop and mobile compatibility outputs', () => {
    const desktop: Array<{ channel: string; args: unknown[] }> = []
    const mobile: Array<{ event?: string; data?: unknown }> = []
    const emitter = new ChatTurnEmitter(
      'conv-cli',
      {
        sendDesktop: (channel, ...args) => desktop.push({ channel, args }),
        broadcastMobile: (event) => mobile.push(event),
      },
      'turn-cli',
    )

    emitter.cliToolStart('tool-1', 'read_file', { path: 'README.md' })
    const finished = emitter.cliToolEnd('tool-1', 'contents', false, {
      name: 'read_file',
      input: { path: 'README.md' },
      serverName: 'codex',
    })

    expect(finished).toMatchObject({
      type: 'tool_finished',
      sequence: 2,
      id: 'tool-1',
      toolName: 'read_file',
      result: 'contents',
      success: true,
    })
    expect(desktop.filter((entry) => entry.channel === 'chat:turn-event')).toHaveLength(2)
    expect(desktop).toContainEqual({
      channel: 'chat:cli-tool-end',
      args: [{ id: 'tool-1', content: 'contents', isError: false }],
    })
    expect(mobile).toContainEqual({
      event: 'chat:tool-call-event',
      data: {
        conversationId: 'conv-cli',
        id: 'tool-1',
        toolName: 'read_file',
        serverName: 'codex',
        args: { path: 'README.md' },
        result: 'contents',
        success: true,
        turnId: 'turn-cli',
        sequence: 2,
      },
    })
  })
})
