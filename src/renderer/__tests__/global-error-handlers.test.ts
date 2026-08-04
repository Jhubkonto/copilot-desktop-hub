import { afterEach, describe, expect, it, vi } from 'vitest'
import { installGlobalErrorHandlers } from '../lib/global-error-handlers'

describe('global renderer error handlers', () => {
  afterEach(() => vi.restoreAllMocks())

  it('persists uncaught errors and unhandled promise rejections', async () => {
    const recordRendererError = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { recordRendererError },
    })
    const uninstall = installGlobalErrorHandlers()

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('click failed') }))
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: new Error('async failed') })
    window.dispatchEvent(rejection)
    await Promise.resolve()

    expect(recordRendererError).toHaveBeenCalledTimes(2)
    expect(recordRendererError.mock.calls[0][0].message).toContain('click failed')
    expect(recordRendererError.mock.calls[1][0].message).toContain('async failed')
    uninstall()
  })
})
