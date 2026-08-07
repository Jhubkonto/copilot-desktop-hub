import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import {
  callWithResilience,
  isRetryableProviderError,
  isForcedToolChoiceRejection,
  MAX_PROVIDER_RETRIES,
} from '../provider-resilience'
import type { ProviderNonStreamResult } from '../provider-types'

const ok: ProviderNonStreamResult = { content: 'ok', toolCalls: [] }
const noSleep = async () => {}

function httpError(status: number, message = 'boom'): Error {
  const err = new Error(message)
  ;(err as Error & { status?: number }).status = status
  return err
}

describe('isRetryableProviderError', () => {
  it('classifies 429 and 5xx as retryable', () => {
    for (const s of [429, 500, 502, 503, 504]) {
      expect(isRetryableProviderError(httpError(s))).toBe(true)
    }
  })

  it('does not retry 4xx client errors (other than 429)', () => {
    for (const s of [400, 401, 403, 404, 422]) {
      expect(isRetryableProviderError(httpError(s))).toBe(false)
    }
  })

  it('classifies transient network errors as retryable', () => {
    expect(isRetryableProviderError(new Error('socket hang up'))).toBe(true)
    expect(isRetryableProviderError(new Error('read ECONNRESET'))).toBe(true)
  })
})

describe('isForcedToolChoiceRejection', () => {
  it('detects endpoints that reject forced tool choice', () => {
    expect(isForcedToolChoiceRejection(new Error('tool_choice "required" is not supported by this model'))).toBe(true)
    expect(isForcedToolChoiceRejection(new Error('Invalid tool_choice value'))).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isForcedToolChoiceRejection(new Error('rate limit exceeded'))).toBe(false)
  })
})

describe('callWithResilience', () => {
  it('retries a transient failure then succeeds', async () => {
    const send = vi.fn<(c: string) => Promise<ProviderNonStreamResult>>()
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(ok)

    const result = await callWithResilience(send as never, 'auto', noSleep)
    expect(result).toBe(ok)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('gives up after MAX_PROVIDER_RETRIES and rethrows', async () => {
    const send = vi.fn().mockRejectedValue(httpError(500))
    await expect(callWithResilience(send as never, 'auto', noSleep)).rejects.toThrow()
    // 1 initial attempt + MAX_PROVIDER_RETRIES retries
    expect(send).toHaveBeenCalledTimes(MAX_PROVIDER_RETRIES + 1)
  })

  it('does not retry non-retryable errors', async () => {
    const send = vi.fn().mockRejectedValue(httpError(400))
    await expect(callWithResilience(send as never, 'auto', noSleep)).rejects.toThrow()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('downgrades required→auto once when the endpoint rejects forced tool choice', async () => {
    const seenChoices: string[] = []
    const send = vi.fn(async (choice: string) => {
      seenChoices.push(choice)
      if (choice === 'required') throw new Error('tool_choice: required is not supported')
      return ok
    })

    const result = await callWithResilience(send as never, 'required', noSleep)
    expect(result).toBe(ok)
    expect(seenChoices).toEqual(['required', 'auto'])
  })
})
