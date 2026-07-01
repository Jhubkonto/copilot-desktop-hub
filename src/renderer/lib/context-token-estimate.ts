import type { ContextRef } from '../hooks/chat-types'

/** Tokens per resolved @ref (rough estimate before actual resolution). */
export const REF_TOKEN_ESTIMATE: Record<string, number> = {
  workspace: 500,
  git: 200,
  'git-diff': 800,
  file: 300,
  wiki: 1000,
}

export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}

export function estimateRefTokens(ref: Pick<ContextRef, 'key'>): number {
  return REF_TOKEN_ESTIMATE[ref.key] ?? 300
}

export const CONTEXT_INSPECTOR_MAX_TOKENS = 16000
