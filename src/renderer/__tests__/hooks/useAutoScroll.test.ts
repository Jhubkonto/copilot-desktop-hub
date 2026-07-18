import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAutoScroll } from '../../../renderer/hooks/useAutoScroll'

const flushRaf = () => act(async () => {
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await new Promise((resolve) => requestAnimationFrame(resolve))
})

function mockScrollElement(overrides: Partial<HTMLDivElement> = {}) {
  const scrollTo = vi.fn()
  const el = {
    scrollHeight: 2000,
    scrollTop: 1920,
    clientHeight: 80,
    scrollTo,
    ...overrides,
  } as unknown as HTMLDivElement
  return { el, scrollTo }
}

beforeEach(() => {
  class NoopResizeObserver {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAutoScroll', () => {
  it('does not yank the user back to the bottom when a turn starts while they are scrolled up reading history', async () => {
    // Reproduces the reported bug: isGenerating flipping true (which can happen for a
    // background/remote-initiated turn, not just the viewing user's own send) used to
    // force-scroll to the bottom unconditionally, regardless of where the user currently
    // was — making it impossible to read earlier history whenever anything was generating.
    const { result, rerender } = renderHook(
      ({ isGenerating }) => useAutoScroll({ isGenerating, contentSignal: 0 }),
      { initialProps: { isGenerating: false } },
    )

    const { el, scrollTo } = mockScrollElement({ scrollTop: 0 })
    result.current.scrollContainerRef.current = el
    // Mount itself schedules an initial scroll-to-bottom (entering a chat always starts at
    // the latest content) — flush it out of the way before simulating the user scrolling up,
    // so it isn't mistaken for the generation-begin effect under test below.
    await flushRaf()
    scrollTo.mockClear()

    act(() => {
      result.current.handleScrollContainerScroll()
    })
    expect(result.current.isUserScrolledUp).toBe(true)

    rerender({ isGenerating: true })
    await flushRaf()

    expect(scrollTo).not.toHaveBeenCalled()
    expect(result.current.isUserScrolledUp).toBe(true)
  })

  it('still follows to the bottom when a turn starts and the user is already there', async () => {
    const { result, rerender } = renderHook(
      ({ isGenerating }) => useAutoScroll({ isGenerating, contentSignal: 0 }),
      { initialProps: { isGenerating: false } },
    )

    // Far from the bottom (content grew past the last-known position) but the user never
    // scrolled away themselves — isUserScrolledUpRef stays false, so this should still
    // auto-follow once generation begins.
    const { el, scrollTo } = mockScrollElement({ scrollTop: 0 })
    result.current.scrollContainerRef.current = el
    await flushRaf()
    scrollTo.mockClear()

    rerender({ isGenerating: true })
    await flushRaf()

    expect(scrollTo).toHaveBeenCalled()
  })
})
