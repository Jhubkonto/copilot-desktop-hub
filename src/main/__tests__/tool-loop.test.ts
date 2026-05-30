import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCallMcpTool, mockServers } = vi.hoisted(() => ({
  mockCallMcpTool: vi.fn(),
  mockServers: new Map<string, { config: { name: string } }>()
}))

vi.mock('../mcp', () => ({
  callMcpTool: mockCallMcpTool,
  servers: mockServers
}))

import { MCP_MAX_ITERATIONS, MCP_REQUIRED_ITERATIONS, runProviderMcpToolLoop } from '../tool-loop'
import type { ModelToolCaller } from '../tool-loop'
import type { ProviderMessage } from '../providers'
import type { ToolDefinition } from '../copilot-api'

function makeWebContents() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false)
  } as unknown as Electron.WebContents
}

const toolDefs: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'server-1__click',
      description: 'Click something',
      parameters: { type: 'object', properties: {} }
    }
  }
]

const toolMap = new Map<string, { serverId: string; toolName: string }>([
  ['server-1__click', { serverId: 'server-1', toolName: 'click' }]
])

describe('runProviderMcpToolLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockServers.clear()
    mockServers.set('server-1', { config: { name: 'Browser Server' } })
    mockCallMcpTool.mockResolvedValue({ success: true, result: 'clicked' })
  })

  it('stops when no tool calls in first response', async () => {
    const caller: ModelToolCaller = vi.fn().mockResolvedValue({ content: 'final answer', toolCalls: [] })
    const onChunk = vi.fn()

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'hello' }],
      toolDefs,
      toolMap,
      'agent-1',
      makeWebContents(),
      onChunk
    )

    expect(result).toBe('final answer')
    expect(onChunk).toHaveBeenCalledWith('final answer')
    expect(caller).toHaveBeenCalledWith(
      expect.any(Array),
      toolDefs,
      'required'
    )
  })

  it('calls with required for the first required iterations then auto', async () => {
    const choices: Array<'auto' | 'required' | 'none'> = []
    const caller: ModelToolCaller = vi.fn(async (_messages, _tools, toolChoice) => {
      choices.push(toolChoice)
      if (choices.length <= MCP_REQUIRED_ITERATIONS + 1) {
        return {
          content: null,
          toolCalls: [{ id: `call-${choices.length}`, name: 'server-1__click', arguments: {} }]
        }
      }
      return { content: 'done', toolCalls: [] }
    })

    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'hello' }],
      toolDefs,
      toolMap,
      'agent-1',
      makeWebContents(),
      vi.fn()
    )

    expect(choices.slice(0, MCP_REQUIRED_ITERATIONS)).toEqual(Array(MCP_REQUIRED_ITERATIONS).fill('required'))
    expect(choices[MCP_REQUIRED_ITERATIONS]).toBe('auto')
  })

  it('appends tool results and continues the loop', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: { target: 'submit' } }]
      })
      .mockImplementationOnce(async (messages) => {
        expect(messages).toContainEqual({
          role: 'tool',
          tool_call_id: 'call-1',
          content: 'clicked'
        })
        return { content: 'finished', toolCalls: [] }
      })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'click submit' }],
      toolDefs,
      toolMap,
      'agent-1',
      makeWebContents(),
      vi.fn()
    )

    expect(result).toBe('finished')
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      'server-1',
      'click',
      { target: 'submit' },
      'agent-1',
      expect.any(Object)
    )
  })

  it('attaches images to the tool message when a step produces images', async () => {
    mockCallMcpTool.mockResolvedValueOnce({
      success: true,
      result: 'captured',
      images: [{ dataUrl: 'data:image/png;base64,abc' }]
    })

    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'server-1__click', arguments: {} }]
      })
      .mockImplementationOnce(async (messages) => {
        const toolMsg = messages.find(
          (m: ProviderMessage): m is ProviderMessage & { role: 'tool'; images?: { dataUrl: string }[] } =>
            m.role === 'tool' && (m as { tool_call_id?: string }).tool_call_id === 'call-1'
        )
        expect(toolMsg).toBeDefined()
        expect(toolMsg?.images).toEqual([{ dataUrl: 'data:image/png;base64,abc' }])
        // No synthetic user message should be present
        const syntheticMsg = messages.find(
          (m: ProviderMessage) => m.role === 'user' &&
            Array.isArray(m.content) &&
            (m.content as { type: string; text?: string }[])[0]?.text === '[Browser screenshots from current step]'
        )
        expect(syntheticMsg).toBeUndefined()
        return { content: 'done', toolCalls: [] }
      })

    await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'take screenshot' }],
      toolDefs,
      toolMap,
      'agent-1',
      makeWebContents(),
      vi.fn()
    )
  })

  it('handles unknown tool gracefully', async () => {
    const caller: ModelToolCaller = vi.fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'missing__tool', arguments: { foo: 'bar' } }]
      })
      .mockImplementationOnce(async (messages) => {
        expect(messages).toContainEqual({
          role: 'tool',
          tool_call_id: 'call-1',
          content: 'Error: Unknown tool "missing__tool"'
        })
        return { content: 'recovered', toolCalls: [] }
      })

    const webContents = makeWebContents()
    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'use missing tool' }],
      toolDefs,
      toolMap,
      'agent-1',
      webContents,
      vi.fn()
    )

    expect(result).toBe('recovered')
    expect(webContents.send).toHaveBeenCalledWith('chat:tool-call-event', expect.objectContaining({
      toolName: 'tool',
      success: false,
      result: 'Error: Unknown tool "missing__tool"'
    }))
  })

  it('caps at max iterations and requests a final answer without tools', async () => {
    const caller: ModelToolCaller = vi.fn(async (_messages, tools, toolChoice) => {
      if (toolChoice === 'none') {
        expect(tools).toBeUndefined()
        return { content: 'fallback final', toolCalls: [] }
      }
      return {
        content: null,
        toolCalls: [{ id: randomId(), name: 'server-1__click', arguments: {} }]
      }
    })

    const result = await runProviderMcpToolLoop(
      caller,
      [{ role: 'user', content: 'loop forever' }],
      toolDefs,
      toolMap,
      'agent-1',
      makeWebContents(),
      vi.fn()
    )

    expect(result).toBe('fallback final')
    expect(caller).toHaveBeenCalledTimes(MCP_MAX_ITERATIONS + 1)
    expect(caller).toHaveBeenLastCalledWith(expect.any(Array), undefined, 'none')
  })

  it('prepends the directive to an existing system prompt', async () => {
    const caller: ModelToolCaller = vi.fn(async (messages) => {
      expect(messages[0]).toMatchObject({
        role: 'system',
        content: expect.stringContaining('Original system')
      })
      expect((messages[0] as ProviderMessage).content).toEqual(expect.stringContaining('You have browser automation tools available: click.'))
      return { content: 'ok', toolCalls: [] }
    })

    await runProviderMcpToolLoop(
      caller,
      [{ role: 'system', content: 'Original system' }, { role: 'user', content: 'hello' }],
      toolDefs,
      toolMap,
      'agent-1',
      makeWebContents(),
      vi.fn()
    )
  })
})

function randomId() {
  return Math.random().toString(36).slice(2)
}
