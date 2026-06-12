import type { MessageContent, MessageContentPart, ProviderMessage } from './provider-core-types'

interface AnthropicTextBlock { type: 'text'; text: string }
interface AnthropicImageBlock { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
interface AnthropicToolResultBlock { type: 'tool_result'; tool_use_id: string; content: (AnthropicTextBlock | AnthropicImageBlock)[] }
export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export function toAnthropicContent(content: MessageContent): string | AnthropicContentBlock[] {
  if (typeof content === 'string') return content
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text } as AnthropicTextBlock
    if (part.type === 'image_url') {
      const url = part.image_url.url
      const match = url.match(/^data:([^;]+);base64,(.+)$/)
      if (match) {
        return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } } as AnthropicImageBlock
      }
      return { type: 'text', text: `[Image: ${url}]` } as AnthropicTextBlock
    }
    return { type: 'text', text: '' } as AnthropicTextBlock
  })
}

export function toAnthropicMessages(
  messages: ProviderMessage[]
): { system: string | undefined; messages: AnthropicMessage[] } {
  let system: string | undefined
  const result: AnthropicMessage[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]

    if (msg.role === 'system') {
      if (!system) system = typeof msg.content === 'string' ? msg.content : ''
      i++
      continue
    }

    if (msg.role === 'user') {
      result.push({ role: 'user', content: toAnthropicContent(msg.content) })
      i++
      continue
    }

    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const blocks: AnthropicContentBlock[] = []
        if (msg.content) {
          const textStr = typeof msg.content === 'string' ? msg.content : null
          if (textStr && textStr.trim()) blocks.push({ type: 'text', text: textStr })
        }
        for (const tc of msg.tool_calls) {
          let parsedArgs: Record<string, unknown>
          try { parsedArgs = JSON.parse(tc.function.arguments) } catch { parsedArgs = {} }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: parsedArgs })
        }
        result.push({ role: 'assistant', content: blocks })
      } else {
        result.push({ role: 'assistant', content: toAnthropicContent(msg.content ?? '') })
      }
      i++
      continue
    }

    if (msg.role === 'tool') {
      const toolResultBlocks: AnthropicToolResultBlock[] = []
      while (i < messages.length && messages[i].role === 'tool') {
        const toolMsg = messages[i] as { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }
        const content: (AnthropicTextBlock | AnthropicImageBlock)[] = [{ type: 'text', text: toolMsg.content }]
        if (toolMsg.images?.length) {
          for (const img of toolMsg.images) {
            const match = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
            if (match) {
              content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
            }
          }
        }
        toolResultBlocks.push({ type: 'tool_result', tool_use_id: toolMsg.tool_call_id, content })
        i++
      }

      // Legacy fallback: consume a synthetic screenshot user message produced by old-format
      // message arrays (sentinel text '[Browser screenshots from current step]').
      if (i < messages.length && messages[i].role === 'user') {
        const nextMsg = messages[i]
        const isLegacyScreenshotMsg = Array.isArray(nextMsg.content) &&
          nextMsg.content.length > 0 &&
          nextMsg.content[0].type === 'text' &&
          (nextMsg.content[0] as { type: 'text'; text: string }).text === '[Browser screenshots from current step]'
        if (isLegacyScreenshotMsg && toolResultBlocks.length > 0) {
          const legacyImages: AnthropicImageBlock[] = []
          for (const part of nextMsg.content as MessageContentPart[]) {
            if (part.type === 'image_url') {
              const url = part.image_url.url
              const match = url.match(/^data:([^;]+);base64,(.+)$/)
              if (match) {
                legacyImages.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
              }
            }
          }
          if (legacyImages.length > 0) {
            toolResultBlocks[toolResultBlocks.length - 1].content.push(...legacyImages)
          }
          i++
        }
      }

      result.push({ role: 'user', content: toolResultBlocks as AnthropicContentBlock[] })
      continue
    }

    i++
  }

  return { system, messages: result }
}

/**
 * Converts ProviderMessages for OpenAI-compatible APIs.
 * Tool messages with `images` are represented as synthetic user messages
 * appended after each group of tool results. Images are attributed per tool.
 */
export function toOpenAICompatibleMessages(messages: ProviderMessage[]): ProviderMessage[] {
  const result: ProviderMessage[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role !== 'tool') {
      result.push(msg)
      i++
      continue
    }

    const toolGroup: { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] }[] = []
    while (i < messages.length && messages[i].role === 'tool') {
      toolGroup.push(messages[i] as { role: 'tool'; tool_call_id: string; content: string; images?: { dataUrl: string }[] })
      i++
    }

    for (const t of toolGroup) {
      result.push({ role: 'tool', tool_call_id: t.tool_call_id, content: t.content })
    }

    const imageParts: MessageContentPart[] = []
    for (const t of toolGroup) {
      if (!t.images?.length) continue
      const toolLabel = `[Screenshots from tool: ${t.tool_call_id}]`
      imageParts.push({ type: 'text', text: toolLabel })
      for (const img of t.images) {
        imageParts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
      }
    }
    if (imageParts.length > 0) {
      result.push({ role: 'user', content: imageParts })
    }
  }
  return result
}
