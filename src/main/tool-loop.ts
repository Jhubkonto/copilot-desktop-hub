import { callMcpTool, servers } from './mcp'
import type { ProviderNonStreamResult, ToolChoice, ToolDefinition } from './provider-types'
import type { ProviderMessage } from './providers'

export const MCP_MAX_ITERATIONS = 20
export const MCP_REQUIRED_ITERATIONS = 0

/**
 * Tool result content is truncated to this length before being added to the
 * model's context. Large accessibility trees and DOM snapshots can easily
 * exceed 20k characters and push the model into "explanation mode" rather than
 * action mode. The full result is still forwarded to the renderer for display.
 */
export const MAX_TOOL_RESULT_CHARS = 16000

/**
 * Tool name fragments that indicate a read-only inspection step.
 * When the previous loop iteration consisted entirely of inspection tools,
 * a text-only response is treated as a planning step and the loop attempts
 * one recovery by forcing the next call with toolChoice = 'required'.
 */
const INSPECTION_TOOL_KEYWORDS = ['snapshot', 'screenshot', 'evaluate', 'source', 'console', 'dom']

function isInspectionTool(toolName: string): boolean {
  const lower = toolName.toLowerCase()
  return INSPECTION_TOOL_KEYWORDS.some((kw) => lower.includes(kw))
}

export interface ModelToolCaller {
  (
    messages: ProviderMessage[],
    tools: ToolDefinition[] | undefined,
    toolChoice: ToolChoice
  ): Promise<ProviderNonStreamResult>
}

export async function runProviderMcpToolLoop(
  caller: ModelToolCaller,
  messages: ProviderMessage[],
  toolDefs: ToolDefinition[],
  toolMap: Map<string, { serverId: string; toolName: string }>,
  agentId: string,
  webContents: Electron.WebContents,
  onChunk: (chunk: string) => void,
  onModel?: (model: string) => void,
  agenticMode?: boolean,
  inlineHandlers?: Map<string, (args: Record<string, unknown>) => Promise<{ success: boolean; result?: string; error?: string }>>,
  toolDirective?: string
): Promise<string> {
  const toolNames = [...new Set(toolDefs.map((t) => t.function.name.split('__').pop()))].join(', ')
  const directive = toolDirective ??
    `You have browser automation tools available: ${toolNames}. ` +
    'CRITICAL: Only use these tools when the user\'s request explicitly requires interacting with a web browser or web page. ' +
    'For conversational questions, general knowledge, or anything that does not require a browser, respond directly WITHOUT calling any tools. ' +
    'When a browser task IS required, call the tools immediately and completely — ' +
    'do NOT say you "will" do something, just do it. ' +
    'After any inspection step (e.g. browser_snapshot), take the next required action immediately — ' +
    'do NOT narrate your findings before acting. ' +
    'Continue calling tools until the task is fully finished, then give a brief summary.'
  const baseMessages: ProviderMessage[] = messages.length > 0 && messages[0].role === 'system'
    ? [
        { role: 'system' as const, content: `${messages[0].content as string}\n\n${directive}` },
        ...messages.slice(1)
      ]
    : [{ role: 'system' as const, content: directive }, ...messages]

  const loopMessages = [...baseMessages]
  let fullResponse = ''
  let modelEmitted = false

  // Recovery state — when the model returns planning text after a pure inspection step,
  // we force one additional 'required' iteration rather than exiting immediately.
  let prevIterationInspectionOnly = false
  let hasRecovered = false
  let forcedToolChoice: 'required' | null = null

  const sendActivity = (event: { type: 'thinking' } | { type: 'tool'; name: string; server: string }) => {
    if (!webContents.isDestroyed()) webContents.send('chat:activity', event)
  }

  for (let i = 0; i < MCP_MAX_ITERATIONS; i++) {
    let toolChoice: 'auto' | 'required' | 'none'
    if (forcedToolChoice) {
      toolChoice = forcedToolChoice
      forcedToolChoice = null
    } else {
      toolChoice = i < MCP_REQUIRED_ITERATIONS ? 'required' : 'auto'
    }

    sendActivity({ type: 'thinking' })
    const result = await caller(loopMessages, toolDefs, toolChoice)

    if (!modelEmitted && onModel && result.model) {
      modelEmitted = true
      onModel(result.model)
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
      const text = result.content ?? ''

      // Mid-loop recovery: the model returned planning text after a pure inspection
      // step (e.g. browser_snapshot). Push a user nudge (not an assistant message —
      // ending a turn with a bare assistant text message and then requesting more tool
      // calls causes a 400 from the API) and force one more 'required' iteration.
      if (prevIterationInspectionOnly && !hasRecovered && text.trim()) {
        hasRecovered = true
        forcedToolChoice = 'required'
        loopMessages.push({
          role: 'user' as const,
          content: 'Please proceed with the actions now — call the appropriate tools directly.'
        })
        continue
      }

      onChunk(text)
      fullResponse += text
      return fullResponse
    }

    // Track whether this iteration was entirely inspection tools (no mutations).
    prevIterationInspectionOnly = result.toolCalls.every((tc) =>
      isInspectionTool(tc.name.split('__').pop() ?? tc.name)
    )

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
      const inlineHandler = inlineHandlers?.get(call.name)
      let toolResultContent: string
      let toolImages: { dataUrl: string }[] | undefined
      if (!resolved && !inlineHandler) {
        toolResultContent = `Error: Unknown tool "${call.name}"`
        sendActivity({ type: 'tool', name: toolShortName, server: call.name.split('__')[0] ?? '' })
        if (!webContents.isDestroyed()) {
          webContents.send('chat:tool-call-event', {
            toolName: toolShortName,
            serverName: call.name.split('__')[0] ?? '',
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: false
          })
        }
      } else if (inlineHandler) {
        sendActivity({ type: 'tool', name: call.name, server: 'Project Wiki' })
        const toolResult = await inlineHandler(call.arguments as Record<string, unknown>)
        toolResultContent = toolResult.success
          ? (toolResult.result ?? '(no output)')
          : `Error: ${toolResult.error ?? 'Tool execution failed'}`
        if (!webContents.isDestroyed()) {
          webContents.send('chat:tool-call-event', {
            toolName: call.name,
            serverName: 'Project Wiki',
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: toolResult.success
          })
        }
      } else {
        // resolved is guaranteed non-null: the first branch handles !resolved && !inlineHandler
        const mcpResolved = resolved!
        const serverInstance = servers.get(mcpResolved.serverId)
        const serverName = serverInstance?.config.name ?? mcpResolved.serverId
        sendActivity({ type: 'tool', name: toolShortName, server: serverName })
        const toolResult = await callMcpTool(
          mcpResolved.serverId,
          mcpResolved.toolName,
          call.arguments as Record<string, unknown>,
          agentId,
          webContents,
          agenticMode
        )
        toolResultContent = toolResult.success
          ? (toolResult.result ?? '(no output)')
          : `Error: ${toolResult.error ?? 'Tool execution failed'}`
        if (toolResult.images?.length) {
          toolImages = toolResult.images.map(img => ({ dataUrl: img.dataUrl }))
        }
        if (!webContents.isDestroyed()) {
          webContents.send('chat:tool-call-event', {
            toolName: toolShortName,
            serverName,
            args: call.arguments as Record<string, unknown>,
            result: toolResultContent,
            success: toolResult.success,
            ...(toolImages?.length && { resultImages: toolImages })
          })
        }
      }

      // Truncate large results for the model context to prevent inspection tools
      // (e.g. browser_snapshot) from overwhelming the model into planning mode.
      // The full result is already forwarded to the renderer above.
      const modelFacingContent = toolResultContent.length > MAX_TOOL_RESULT_CHARS
        ? toolResultContent.slice(0, MAX_TOOL_RESULT_CHARS) +
          '\n...[output truncated — proceed with the task using the above information]'
        : toolResultContent

      const toolMsg: ProviderMessage = { role: 'tool' as const, tool_call_id: call.id, content: modelFacingContent }
      if (toolImages?.length) {
        (toolMsg as { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }).images = toolImages
      }
      loopMessages.push(toolMsg)
    }
  }

  sendActivity({ type: 'thinking' })
  const finalResult = await caller(loopMessages, undefined, 'none')
  if (!modelEmitted && onModel && finalResult.model) {
    onModel(finalResult.model)
  }
  const text = finalResult.content ?? ''
  onChunk(text)
  fullResponse += text
  return fullResponse
}
