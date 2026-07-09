import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToolCallBlock } from '../ToolCallBlock'

describe('ToolCallBlock', () => {
  it('renders tool name and server name', () => {
    render(<ToolCallBlock toolName="browser_click" serverName="Playwright (Chromium)" />)

    expect(screen.getByText('browser_click')).toBeInTheDocument()
    expect(screen.getByText(/Playwright \(Chromium\)/)).toBeInTheDocument()
  })

  it('shows success icon when success=true', () => {
    render(<ToolCallBlock toolName="browser_navigate" success={true} />)

    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('shows error icon when success=false', () => {
    render(<ToolCallBlock toolName="browser_click" success={false} result="Error: element not found" />)

    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('shows args and a short result immediately, with nothing to expand', () => {
    const args = { selector: 'button[type="submit"]' }
    const result = 'Clicked successfully'

    render(<ToolCallBlock toolName="browser_click" args={args} result={result} />)

    // A short (single-line, under the char cap) result is already fully shown in the
    // always-visible preview — no click needed, and there's nothing left to expand.
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/selector/)).toBeInTheDocument()
    // Once in the header's compact status text, once in the always-visible preview.
    expect(screen.getAllByText('Clicked successfully')).toHaveLength(2)
  })

  it('reveals the rest of a long multi-line result when clicked, and hides it again on a second click', () => {
    const lines = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`)
    render(<ToolCallBlock toolName="browser_click" args={{ x: 1 }} result={lines.join('\n')} />)
    const button = screen.getByRole('button')

    // The remainder stays mounted at all times (just visually collapsed via a CSS grid
    // transition, so it can animate open smoothly) — aria-expanded and the "+N more
    // lines" hint are the reliable signals for the toggle state, not text presence.
    expect(screen.getByText('+3 more lines')).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('+3 more lines')).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('+3 more lines')).toBeInTheDocument()
  })

  it('truncates a very long single-line result by character count', () => {
    render(<ToolCallBlock toolName="t" result={'x'.repeat(3000)} />)
    const button = screen.getByRole('button')

    // No newlines to count, so the hint falls back to a generic label instead of "+N lines".
    expect(screen.getByText('Show more')).toBeInTheDocument()

    fireEvent.click(button)

    expect(screen.getByText(/…\(truncated\)/)).toBeInTheDocument()
  })

  it('is disabled when no args or result are provided', () => {
    render(<ToolCallBlock toolName="browser_screenshot" />)

    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is not disabled when only resultImages are provided', () => {
    render(<ToolCallBlock toolName="browser_take_screenshot" resultImages={[{ dataUrl: 'data:image/png;base64,abc' }]} />)

    expect(screen.getByRole('button')).not.toBeDisabled()
  })

  it('renders screenshot thumbnail when resultImages are provided', () => {
    const images = [{ dataUrl: 'data:image/png;base64,abc123' }]
    render(<ToolCallBlock toolName="browser_take_screenshot" resultImages={images} />)

    fireEvent.click(screen.getByRole('button'))

    const img = screen.getByRole('img', { name: /screenshot/i })
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123')
  })

  it('shows "Use as context" button when onUseImageAsContext is provided', () => {
    const images = [{ dataUrl: 'data:image/png;base64,abc123' }]
    render(
      <ToolCallBlock
        toolName="browser_take_screenshot"
        resultImages={images}
        onUseImageAsContext={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /browser_take_screenshot/ }))

    expect(screen.getByText(/use as context/i)).toBeInTheDocument()
  })

  it('calls onUseImageAsContext with the dataUrl when clicked', () => {
    const onUse = vi.fn()
    const images = [{ dataUrl: 'data:image/png;base64,abc123' }]
    render(
      <ToolCallBlock
        toolName="browser_take_screenshot"
        resultImages={images}
        onUseImageAsContext={onUse}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /browser_take_screenshot/ }))
    fireEvent.click(screen.getByText(/use as context/i))

    expect(onUse).toHaveBeenCalledWith('data:image/png;base64,abc123')
  })

  it('does not show "Use as context" button when onUseImageAsContext is not provided', () => {
    const images = [{ dataUrl: 'data:image/png;base64,abc123' }]
    render(<ToolCallBlock toolName="browser_take_screenshot" resultImages={images} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.queryByText(/use as context/i)).not.toBeInTheDocument()
  })
})
