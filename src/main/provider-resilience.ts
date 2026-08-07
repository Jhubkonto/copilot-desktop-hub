import type { ProviderNonStreamResult, ToolChoice } from './provider-types'
import { debugLog } from './debug-mode'

// A single transient provider error inside the tool loop (429 rate-limit, 5xx, socket reset)
// otherwise aborts the whole turn and discards every tool result gathered so far. Retry a bounded
// number of times with exponential backoff before giving up.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
export const MAX_PROVIDER_RETRIES = 3

export function isRetryableProviderError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const status = (err as Error & { status?: number }).status
  if (typeof status === 'number' && RETRYABLE_STATUS.has(status)) return true
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|socket hang up|network error|fetch failed|timed? ?out/i.test(err.message)
}

// Some endpoints (several on OpenRouter) reject a forced `tool_choice: required`/`any`. Detect that
// so we can downgrade to `auto` for the round instead of failing the turn.
export function isForcedToolChoiceRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /tool[_ ]?choice/i.test(err.message) &&
    /(not\s+support|unsupported|invalid|required|must be|cannot)/i.test(err.message)
}

function backoffDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250)
}

/**
 * Wraps a single tool-loop round with (a) a one-time `required`→`auto` downgrade when the endpoint
 * rejects forced tool choice, and (b) bounded exponential-backoff retry for transient failures.
 * `send` receives the (possibly downgraded) tool choice to use.
 *
 * `sleep` is injectable so tests don't pay real backoff delays.
 */
export async function callWithResilience(
  send: (choice: ToolChoice) => Promise<ProviderNonStreamResult>,
  choice: ToolChoice,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ProviderNonStreamResult> {
  let attempt = 0
  let effectiveChoice = choice
  let downgraded = false
  for (;;) {
    try {
      return await send(effectiveChoice)
    } catch (err) {
      if (!downgraded && effectiveChoice === 'required' && isForcedToolChoiceRejection(err)) {
        debugLog('provider', `tool_choice=required rejected by endpoint — retrying round with 'auto'`)
        effectiveChoice = 'auto'
        downgraded = true
        continue
      }
      if (isRetryableProviderError(err) && attempt < MAX_PROVIDER_RETRIES) {
        attempt++
        const delayMs = backoffDelayMs(attempt)
        debugLog('provider', `retryable provider error (attempt ${attempt}/${MAX_PROVIDER_RETRIES}) — backing off ${delayMs}ms: ${(err as Error).message}`)
        await sleep(delayMs)
        continue
      }
      throw err
    }
  }
}
