/**
 * Fast, provider-neutral token estimate for live UI feedback.
 *
 * Exact tokenization depends on the selected model and on provider-side wrappers that
 * Nexy cannot always inspect (especially CLI system prompts and tool schemas). Keep this
 * deliberately cheap so context assembly can report progress without blocking a turn.
 */
export function estimateCharacterTokens(characterCount: number): number {
  if (characterCount <= 0) return 0
  return Math.max(1, Math.ceil(characterCount / 4))
}

export function estimateTextTokens(text: string): number {
  return estimateCharacterTokens(text.length)
}

export function estimateInputTokens(value: unknown): number {
  if (typeof value === 'string') {
    return value.startsWith('data:image/') ? 1_000 : estimateTextTokens(value)
  }
  if (value == null) return 0
  try {
    let imageTokens = 0
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'string' && item.startsWith('data:image/')) {
        imageTokens += 1_000
        return '[image]'
      }
      return item
    })
    return estimateTextTokens(serialized) + imageTokens
  } catch {
    return 0
  }
}

export function formatEstimatedTokens(tokens: number): string {
  const rounded = Math.max(0, Math.round(tokens))
  return `~${rounded.toLocaleString('en-US')} ${rounded === 1 ? 'token' : 'tokens'}`
}
