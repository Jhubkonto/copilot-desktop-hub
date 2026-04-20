import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageBubble } from '../../renderer/components/MessageBubble'
import { setupMockApi } from '../../test/mocks/api'

beforeEach(() => {
  setupMockApi()
})

const baseProps = {
  id: 'msg-1',
  role: 'user' as const,
  content: 'Hello there',
  isLastAssistant: false,
  isGenerating: false,
  onCopy: vi.fn()
}

describe('MessageBubble', () => {
  it('renders user message content as plain text', () => {
    render(<MessageBubble {...baseProps} />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
  })

  it('renders assistant message with markdown', () => {
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        content="**Bold** text"
      />
    )
    expect(screen.getByText('Bold')).toBeInTheDocument()
  })

  it('shows attachment chips when present', () => {
    render(
      <MessageBubble
        {...baseProps}
        attachments={[
          { id: 'a1', name: 'file.txt', size: 1024 },
          { id: 'a2', name: 'code.ts', size: 2048 }
        ]}
      />
    )
    expect(screen.getByText(/file\.txt/)).toBeInTheDocument()
    expect(screen.getByText(/code\.ts/)).toBeInTheDocument()
    expect(screen.getByText(/1\.0KB/)).toBeInTheDocument()
  })

  it('shows copy action on hover', () => {
    render(<MessageBubble {...baseProps} />)
    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)

    expect(screen.getByText('Copy')).toBeInTheDocument()
  })

  it('calls onCopy when copy button clicked', () => {
    const onCopy = vi.fn()
    render(<MessageBubble {...baseProps} onCopy={onCopy} />)

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)
    fireEvent.click(screen.getByText('Copy'))

    expect(onCopy).toHaveBeenCalledWith('Hello there')
  })

  it('shows regenerate action for last assistant message', () => {
    const onRegenerate = vi.fn()
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        isLastAssistant={true}
        onRegenerate={onRegenerate}
      />
    )

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)

    expect(screen.getByText('Regenerate')).toBeInTheDocument()
  })

  it('shows edit action for user messages', () => {
    const onEdit = vi.fn()
    render(<MessageBubble {...baseProps} onEdit={onEdit} />)

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)

    expect(screen.getByText('Edit')).toBeInTheDocument()
  })

  it('hides actions while generating', () => {
    render(<MessageBubble {...baseProps} isGenerating={true} />)

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)

    expect(screen.queryByText('Copy')).not.toBeInTheDocument()
  })

  it('formats file sizes correctly', () => {
    render(
      <MessageBubble
        {...baseProps}
        attachments={[
          { id: 'a1', name: 'tiny.txt', size: 500 },
          { id: 'a2', name: 'big.bin', size: 1500000 }
        ]}
      />
    )
    expect(screen.getByText(/500B/)).toBeInTheDocument()
    expect(screen.getByText(/1\.4MB/)).toBeInTheDocument()
  })
})
