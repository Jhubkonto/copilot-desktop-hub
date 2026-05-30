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

  it('expands to show args and result when clicked', () => {
    const args = { selector: 'button[type="submit"]' }
    const result = 'Clicked successfully'

    render(<ToolCallBlock toolName="browser_click" args={args} result={result} />)

    expect(screen.queryByText('Clicked successfully')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Clicked successfully')).toBeInTheDocument()
    expect(screen.getByText(/selector/)).toBeInTheDocument()
  })

  it('collapses when clicked again', () => {
    render(<ToolCallBlock toolName="browser_click" args={{ x: 1 }} result="ok" />)
    const button = screen.getByRole('button')

    fireEvent.click(button)
    expect(screen.getByText('ok')).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByText('ok')).not.toBeInTheDocument()
  })

  it('truncates long results', () => {
    render(<ToolCallBlock toolName="t" result={'x'.repeat(3000)} />)

    fireEvent.click(screen.getByRole('button'))

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
