import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToolCallBlock } from '../ToolCallBlock'

describe('ToolCallBlock', () => {
  it('renders tool name and server name', () => {
    render(<ToolCallBlock toolName="browser_click" serverName="Playwright (Chromium)" />)

    expect(screen.getByText('browser_click')).toBeInTheDocument()
    expect(screen.getByText(/Playwright \(Chromium\)/)).toBeInTheDocument()
  })

  it('folds scalar args into the title instead of a raw key/value dump', () => {
    render(<ToolCallBlock toolName="browser_click" args={{ selector: 'button[type="submit"]' }} />)

    expect(screen.getByText(/browser_click selector: button/)).toBeInTheDocument()
  })

  it('never renders raw JSON braces for object-valued args', () => {
    render(<ToolCallBlock toolName="some_tool" args={{ config: { retries: 3 } }} />)

    expect(screen.queryByText(/\{/)).not.toBeInTheDocument()
  })

  it('summarizes an Edit tool call as added/removed lines, not raw args', () => {
    render(
      <ToolCallBlock
        toolName="Edit"
        args={{ file_path: 'src/foo.ts', old_string: 'a', new_string: 'a\nb\nc' }}
        result="The file has been updated."
      />
    )

    expect(screen.getByText('Edit src/foo.ts')).toBeInTheDocument()
    expect(screen.getByText('Added 2 lines')).toBeInTheDocument()
    // The tool's raw result text is redundant once the summary is shown.
    expect(screen.queryByText(/file has been updated/)).not.toBeInTheDocument()
  })

  it('shows a line range for a Read call with offset/limit', () => {
    render(<ToolCallBlock toolName="Read" args={{ file_path: 'src/foo.ts', offset: 10, limit: 5 }} />)

    expect(screen.getByText('Read src/foo.ts (lines 10-14)')).toBeInTheDocument()
  })

  it('shows a short result immediately when there is nothing to expand', () => {
    const result = 'Clicked successfully'
    render(<ToolCallBlock toolName="browser_click" result={result} />)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Clicked successfully')).toBeInTheDocument()
  })

  it('reveals the rest of a long multi-line result when clicked, and hides it again on a second click', () => {
    const lines = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`)
    render(<ToolCallBlock toolName="browser_click" result={lines.join('\n')} />)
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
