import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ResizableChatInput } from '../components/chat/ResizableChatInput'

function TestInput({ value = '' }: { value?: string }) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  return (
    <ResizableChatInput
      inputRef={inputRef}
      value={value}
      onChange={() => {}}
      aria-label="Test message"
      leftActions={<button type="button">Attach</button>}
      rightActions={<button type="button">Send</button>}
    />
  )
}

describe('ResizableChatInput', () => {
  it('renders the shared textarea surface and action slots', () => {
    render(<TestInput value="Draft project" />)

    expect(screen.getByRole('textbox', { name: 'Test message' })).toHaveValue('Draft project')
    expect(screen.getByRole('button', { name: 'Attach' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
    expect(screen.getByTestId('resize-handle')).toHaveClass('cursor-row-resize')
  })

  it('resizes the textarea from the shared top-edge handle', () => {
    render(<TestInput />)
    const textarea = screen.getByRole('textbox', { name: 'Test message' })
    vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 140,
      left: 0,
      right: 300,
      width: 300,
      height: 40,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerDown(screen.getByTestId('resize-handle'), { clientY: 100 })
    fireEvent.pointerMove(window, { clientY: 20 })
    fireEvent.pointerUp(window)

    expect(textarea.style.height).toBe('120px')
  })
})
