import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ToolDefinition } from '../provider-types'

const { sendProviderWithToolsMock } = vi.hoisted(() => ({
  sendProviderWithToolsMock: vi.fn(),
}))

vi.mock('../providers', () => ({
  sendProviderWithTools: sendProviderWithToolsMock,
}))

import {
  parsePromptedToolCalls,
  buildPromptedToolSystemAddendum,
  injectPromptedToolSystemPrompt,
  createPromptedToolCaller,
} from '../self-heal/prompted-tool-caller'

const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search workspace files for a literal query using ripgrep.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, path: { type: 'string' } },
        required: ['query'],
      },
    },
  },
]

describe('parsePromptedToolCalls', () => {
  it('parses a single fenced json block with tool_calls wrapper', () => {
    const text = [
      '```json',
      '{ "tool_calls": [ { "name": "read_file", "arguments": { "path": "a.ts" } } ] }',
      '```',
    ].join('\n')
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([{ name: 'read_file', arguments: { path: 'a.ts' } }])
    expect(result.remainingText).toBe('')
  })

  it('keeps surrounding prose in remainingText and strips the fence', () => {
    const text = [
      'Sure, let me check that file.',
      '```json',
      '{ "tool_calls": [ { "name": "grep", "arguments": { "query": "x" } } ] }',
      '```',
      'Thanks.',
    ].join('\n')
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([{ name: 'grep', arguments: { query: 'x' } }])
    expect(result.remainingText).toContain('Sure, let me check that file.')
    expect(result.remainingText).toContain('Thanks.')
    expect(result.remainingText).not.toContain('tool_calls')
  })

  it('tolerates a bare object without the tool_calls wrapper', () => {
    const text = '```json\n{ "name": "grep", "arguments": { "query": "x" } }\n```'
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([{ name: 'grep', arguments: { query: 'x' } }])
  })

  it('tolerates a bare array', () => {
    const text = '```json\n[ { "name": "list_directory", "arguments": {} } ]\n```'
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([{ name: 'list_directory', arguments: {} }])
  })

  it('degrades gracefully on malformed JSON inside a fence', () => {
    const text = '```json\n{ "tool_calls": [ { "name": "grep", } ] }\n```'
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([])
    expect(result.remainingText).toBe(text.trim())
  })

  it('passes plain markdown with no fence through unchanged', () => {
    const text = '---\nconfidence: high\n---\n\n# Summary\nNo tool needed.'
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([])
    expect(result.remainingText).toBe(text.trim())
  })

  it('extracts only the valid tool-call fence among multiple fences', () => {
    const text = [
      '```json',
      '{ "example": "unrelated" }',
      '```',
      '```json',
      '{ "tool_calls": [ { "name": "read_file", "arguments": { "path": "b.ts" } } ] }',
      '```',
    ].join('\n')
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([{ name: 'read_file', arguments: { path: 'b.ts' } }])
    expect(result.remainingText).toBe('')
  })

  it('collects calls from two distinct valid fences in order', () => {
    const text = [
      '```json',
      '{ "name": "read_file", "arguments": { "path": "a.ts" } }',
      '```',
      '```json',
      '{ "name": "grep", "arguments": { "query": "x" } }',
      '```',
    ].join('\n')
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([
      { name: 'read_file', arguments: { path: 'a.ts' } },
      { name: 'grep', arguments: { query: 'x' } },
    ])
  })

  it('coerces missing arguments to an empty object', () => {
    const text = '```json\n{ "name": "read_file" }\n```'
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([{ name: 'read_file', arguments: {} }])
  })

  it('handles empty input', () => {
    const result = parsePromptedToolCalls('')
    expect(result.toolCalls).toEqual([])
    expect(result.remainingText).toBe('')
  })

  it('parses raw JSON with no fence at all', () => {
    const text = '{ "tool_calls": [ { "name": "grep", "arguments": { "query": "y" } } ] }'
    const result = parsePromptedToolCalls(text)
    expect(result.toolCalls).toEqual([{ name: 'grep', arguments: { query: 'y' } }])
  })
})

describe('buildPromptedToolSystemAddendum', () => {
  it('includes every tool name and is non-empty', () => {
    const addendum = buildPromptedToolSystemAddendum(TOOLS)
    expect(addendum.length).toBeGreaterThan(0)
    expect(addendum).toContain('read_file')
    expect(addendum).toContain('grep')
  })

  it('warns against inventing findings when a tool keeps failing', () => {
    const addendum = buildPromptedToolSystemAddendum(TOOLS)
    expect(addendum).toContain('do not treat a failed tool call as license to invent findings')
  })

  it('reinforces the single leading front-matter block format', () => {
    const addendum = buildPromptedToolSystemAddendum(TOOLS)
    expect(addendum).toContain('never repeated later in the response')
    expect(addendum).toContain('never additionally restated inside a ```yaml fenced block')
  })
})

describe('injectPromptedToolSystemPrompt', () => {
  it('merges the addendum into an existing system message', () => {
    const messages = [{ role: 'system' as const, content: 'Base prompt.' }]
    const result = injectPromptedToolSystemPrompt(messages, TOOLS)
    expect(result[0].content as string).toContain('Base prompt.')
    expect(result[0].content as string).toContain('You do not have native function-calling')
  })

  it('is idempotent across repeated calls on the same message object', () => {
    const messages = [{ role: 'system' as const, content: 'Base prompt.' }]
    injectPromptedToolSystemPrompt(messages, TOOLS)
    injectPromptedToolSystemPrompt(messages, TOOLS)
    const occurrences = (messages[0].content as string).split('You do not have native function-calling').length - 1
    expect(occurrences).toBe(1)
  })

  it('unshifts a new system message when none exists', () => {
    const messages = [{ role: 'user' as const, content: 'hello' }]
    const result = injectPromptedToolSystemPrompt(messages, TOOLS)
    expect(result[0].role).toBe('system')
    expect(result).toHaveLength(2)
  })
})

describe('createPromptedToolCaller', () => {
  beforeEach(() => {
    sendProviderWithToolsMock.mockReset()
  })

  it('returns parsed tool calls with generated ids when the model emits a tool-call fence', async () => {
    sendProviderWithToolsMock.mockResolvedValue({
      content: '```json\n{ "tool_calls": [ { "name": "read_file", "arguments": { "path": "a.ts" } } ] }\n```',
      toolCalls: [],
      model: 'hermes-4-70b',
    })
    const caller = createPromptedToolCaller('openrouter', 'sk-test', 'hermes-4-70b', {})
    const result = await caller([{ role: 'system', content: 'sys' }], [], 'auto')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('read_file')
    expect(result.toolCalls[0].arguments).toEqual({ path: 'a.ts' })
    expect(typeof result.toolCalls[0].id).toBe('string')
    expect(result.toolCalls[0].id.length).toBeGreaterThan(0)
  })

  it('returns text with no tool calls when the model answers in plain text', async () => {
    sendProviderWithToolsMock.mockResolvedValue({
      content: 'No tool needed, here is the answer.',
      toolCalls: [],
      model: 'hermes-4-70b',
    })
    const caller = createPromptedToolCaller('openrouter', 'sk-test', 'hermes-4-70b', {})
    const result = await caller([{ role: 'system', content: 'sys' }], [], 'auto')
    expect(result.toolCalls).toEqual([])
    expect(result.content).toBe('No tool needed, here is the answer.')
  })

  it('always calls sendProviderWithTools with tools=[] and toolChoice=none', async () => {
    sendProviderWithToolsMock.mockResolvedValue({ content: 'ok', toolCalls: [], model: 'm' })
    const caller = createPromptedToolCaller('openrouter', 'sk-test', 'hermes-4-70b', {})
    await caller([{ role: 'system', content: 'sys' }], [{ type: 'function', function: { name: 'x', description: '', parameters: {} } }], 'required')
    expect(sendProviderWithToolsMock).toHaveBeenCalledWith(
      'openrouter', 'sk-test', 'hermes-4-70b', expect.any(Array), [], 'none', {},
    )
  })
})
