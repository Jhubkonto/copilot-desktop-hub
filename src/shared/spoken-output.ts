export type SpokenOutputKind = 'response' | 'quick-recap' | 'ai-recap' | 'notification-recap'
export type SpokenOutputGenerationKind = 'deterministic' | 'provider' | 'cli'

export interface MessageSpokenOutput {
  messageId: string
  spokenText: string
  outputKind: SpokenOutputKind
  generationKind: SpokenOutputGenerationKind
  model: string | null
  createdAt: number
  updatedAt: number
}

export interface SaveSpokenOutputInput {
  messageId: string
  spokenText: string
  outputKind: SpokenOutputKind
  generationKind: SpokenOutputGenerationKind
  model?: string | null
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi
const FENCED_CODE_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`[^`\n]+`/g
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/g
const MARKDOWN_MARKER_RE = /(^|\s)(?:#{1,6}|>|[-+*]|\d+\.)\s+/gm
const COMMAND_LINE_RE = /^\s*(?:[$>]\s+|(?:npm|npx|pnpm|yarn|git|gradle|adb|docker|curl|wget|python|node)\s+).+$/gim

export function sanitizeForSpeech(input: string): string {
  return input
    .replace(FENCED_CODE_RE, ' ')
    .replace(COMMAND_LINE_RE, ' ')
    .replace(MARKDOWN_IMAGE_RE, ' ')
    .replace(MARKDOWN_LINK_RE, '$1')
    .replace(URL_RE, ' ')
    .replace(INLINE_CODE_RE, ' ')
    .replace(MARKDOWN_MARKER_RE, '$1')
    .replace(/[*_~|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
}

export function createQuickRecap(input: string, maxCharacters = 420): string {
  const speech = sanitizeForSpeech(input)
  if (speech.length <= maxCharacters) return speech

  const sentences = speech.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [speech]
  let recap = ''
  for (const sentence of sentences) {
    const next = `${recap} ${sentence.trim()}`.trim()
    if (next.length > maxCharacters) break
    recap = next
  }

  if (recap) return recap
  return `${speech.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`
}
