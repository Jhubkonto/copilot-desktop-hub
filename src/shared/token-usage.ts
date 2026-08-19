export type TokenCountQuality = 'provider' | 'tokenizer' | 'estimate'
export type TokenCountSource = 'anthropic' | 'openai' | 'gemini' | 'cli' | 'hermes-acp' | 'heuristic' | string
export interface TokenCount { inputTokens: number; quality: TokenCountQuality; source: TokenCountSource; model?: string | null; contextWindow?: number | null }
export interface TokenUsage { inputTokens: number; outputTokens: number; totalCostUsd?: number; quality: TokenCountQuality; source: TokenCountSource; requestId?: string; cachedInputTokens?: number; reasoningTokens?: number }
export interface TurnUsageTotal { inputTokens: number; outputTokens: number; totalCostUsd: number; requestCount: number; quality: TokenCountQuality; source: TokenCountSource; cachedInputTokens?: number; reasoningTokens?: number; complete: boolean }
export class TurnUsageAccumulator {
  private total: TurnUsageTotal = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, requestCount: 0, quality: 'estimate', source: 'heuristic', complete: false }
  private readonly requestUsages = new Map<string, TokenUsage>()
  private readonly anonymousFingerprints = new Set<string>()
  add(usage: TokenUsage): TurnUsageTotal {
    const inputTokens = Math.max(0, Math.round(usage.inputTokens || 0))
    const outputTokens = Math.max(0, Math.round(usage.outputTokens || 0))
    const totalCostUsd = Math.max(0, usage.totalCostUsd ?? 0)
    const normalized = { ...usage, inputTokens, outputTokens, totalCostUsd }
    if (usage.requestId) this.requestUsages.set(usage.requestId, normalized)
    else {
      const fingerprint = `${inputTokens}:${outputTokens}:${totalCostUsd}`
      if (this.anonymousFingerprints.has(fingerprint)) return this.snapshot()
      this.anonymousFingerprints.add(fingerprint)
      this.requestUsages.set(`anonymous-${this.requestUsages.size}`, normalized)
    }
    const entries = [...this.requestUsages.values()]
    this.total = {
      ...this.total,
      inputTokens: entries.reduce((sum, entry) => sum + entry.inputTokens, 0),
      outputTokens: entries.reduce((sum, entry) => sum + entry.outputTokens, 0),
      totalCostUsd: entries.reduce((sum, entry) => sum + (entry.totalCostUsd ?? 0), 0),
      requestCount: entries.length,
      quality: entries.some((entry) => entry.quality === 'provider') ? 'provider' : entries.some((entry) => entry.quality === 'tokenizer') ? 'tokenizer' : 'estimate',
      source: entries.at(-1)?.source ?? 'heuristic',
      ...(entries.some((entry) => entry.cachedInputTokens != null) ? { cachedInputTokens: entries.reduce((sum, entry) => sum + (entry.cachedInputTokens ?? 0), 0) } : {}),
      ...(entries.some((entry) => entry.reasoningTokens != null) ? { reasoningTokens: entries.reduce((sum, entry) => sum + (entry.reasoningTokens ?? 0), 0) } : {}),
    }
    return this.snapshot()
  }
  markComplete(): TurnUsageTotal { this.total.complete = true; return this.snapshot() }
  snapshot(): TurnUsageTotal { return { ...this.total } }
}
