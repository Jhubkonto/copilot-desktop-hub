import { callMcpTool, servers } from './mcp'
import type { ToolDefinition, CopilotNonStreamResult } from './copilot-api'
import type { ProviderMessage } from './providers'

export const MCP_MAX_ITERATIONS = 20
export const MCP_REQUIRED_ITERATIONS = 3

export interface ModelToolCaller {
  (
    messages: ProviderMessage[],
    tools: ToolDefinition[] | undefined,
    toolChoice: 'auto' | 'required' | 'none'
  ): Promise<CopilotNonStreamResult>
}

export async function runProviderMcpToolLoop(
  caller: ModelToolCaller,
  messages: ProviderMessage[],
  toolDefs: ToolDefinition[],
  toolMap: Map<string, { serverId: string; toolName: string }>,
  agentId: string,
  webContents: Electron.WebContents,
  onChunk: (chunk: string) => void
): Promise<string> {
  const toolNames = [...new Set(toolDefs.map((t) => t.function.name.split('__').pop()))].join(', ')
  const directive =
    `You have browser automation tools available: ${toolNames}. ` +
    'IMPORTANT: When performing browser tasks, call the tools immediately and completely — ' +
    'do NOT say you "will" do something, just do it. ' +
    'Continue calling tools until the task is fully finished, then give a brief summary.'
  const baseMessages: ProviderMessage[] = messages.length > 0 && messages[0].role === 'system'
    ? [
        { role: 'system' as const, content: `${messages[0].content as string}\n\n${directive}` },
        ...messages.slice(1)
      ]
    : [{ role: 'system' as const, content: directive }, ...messages]

  const loopMessages = [...baseMessages]
  let fullResponse = ''

  for (let i = 0; i < MCP_MAX_ITERATIONS; i++) {
    const toolChoice = i < MCP_REQUIRED_ITERATIONS ? 'required' : 'auto'
    const result = await caller(loopMessages, toolDefs, toolChoice)

    if (!result.toolCalls || result.toolCalls.length === 0) {
      const text = result.content ?? ''
      onChunk(text)
      fullResponse += text
      return fullResponse
    }

    loopMessages.push({
      role: 'assistant' as const,
      content: null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
      }))
    })

    for (const call of result.toolCalls) {
      const toolShortName = call.name.split('__').pop() ?? call.name
      const resolved = toolMap.get(call.name)
      let toolResultContent: string
      let toolImages: { dataUrl: string }[] | undefined
      if (!resolved) {
        toolResultContent = `Error: Unknown tool "${call.name}"`
        if (!webContents.isDestroyed()) {
          webContents.send('chat:tool-call-event', {
            toolName: toolShortName,
            serverName: call.name.split('__')[0] ?? '',
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: false
          })
        }
      } else {
        const toolResult = await callMcpTool(
          resolved.serverId,
          resolved.toolName,
          call.arguments as Record<string, unknown>,
          agentId,
          webContents
        )
        toolResultContent = toolResult.success
          ? (toolResult.result ?? '(no output)')
          : `Error: ${toolResult.error ?? 'Tool execution failed'}`
        if (toolResult.images?.length) {
          toolImages = toolResult.images.map(img => ({ dataUrl: img.dataUrl }))
        }
        if (!webContents.isDestroyed()) {
          const serverInstance = servers.get(resolved.serverId)
          webContents.send('chat:tool-call-event', {
            toolName: toolShortName,
            serverName: serverInstance?.config.name ?? resolved.serverId,
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: toolResult.success,
            ...(toolImages?.length && { resultImages: toolImages })
          })
        }
      }
      const toolMsg: ProviderMessage = { role: 'tool' as const, tool_call_id: call.id, content: toolResultContent }
      if (toolImages?.length) {
        (toolMsg as { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }).images = toolImages
      }
      loopMessages.push(toolMsg)
    }
  }

  const finalResult = await caller(loopMessages, undefined, 'none')
  const text = finalResult.content ?? ''
  onChunk(text)
  fullResponse += text
  return fullResponse
}
