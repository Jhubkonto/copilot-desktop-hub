import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageBubble } from '../../renderer/components/MessageBubble'
import { setupMockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../../renderer/store/app-store', () => ({ useAppStore }))

beforeEach(() => {
  setupMockApi()
  setupStoreMock(useAppStore, createMockAppStore())
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

  it('shows green highlight on copy button after click', () => {
    render(<MessageBubble {...baseProps} onCopy={vi.fn()} />)

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)
    fireEvent.click(screen.getByText('Copy'))

    // Label stays "Copy"; button gets green highlight classes
    expect(screen.getByText('Copy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveClass('bg-green-100')
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

  it('calls onRegenerateWithModel from regenerate dropdown', () => {
    const onRegenerateWithModel = vi.fn()
    setupStoreMock(useAppStore, createMockAppStore({
      catalogModels: [{ id: 'gpt-5.4', name: 'GPT-5.4', vendor: 'OpenAI', capabilities: [] }],
    }))
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        isLastAssistant={true}
        onRegenerate={vi.fn()}
        onRegenerateWithModel={onRegenerateWithModel}
      />
    )

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)
    fireEvent.click(screen.getByLabelText('Regenerate with model'))
    fireEvent.click(screen.getByText('GPT-5.4'))

    expect(onRegenerateWithModel).toHaveBeenCalledWith('gpt-5.4')
  })

  it('shows choose model action for model_not_available errors', () => {
    const onPickModel = vi.fn()
    render(
      <MessageBubble
        {...baseProps}
        role="assistant"
        isError={true}
        errorType="model_not_available"
        retryable={false}
        onPickModel={onPickModel}
      />
    )
    expect(screen.getByText('Choose model')).toBeInTheDocument()
  })

  it('shows edit action for user messages', () => {
    const onEdit = vi.fn()
    render(<MessageBubble {...baseProps} onEdit={onEdit} />)

    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.mouseEnter(container)

    expect(screen.getByText('Edit')).toBeInTheDocument()
  })

  it('calls onEdit on user double-click', () => {
    const onEdit = vi.fn()
    render(<MessageBubble {...baseProps} onEdit={onEdit} />)
    const container = screen.getByText('Hello there').closest('.group')!
    fireEvent.doubleClick(container)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('shows edited indicator for edited user message', () => {
    render(<MessageBubble {...baseProps} isEdited={true} />)
    expect(screen.getByText('edited')).toBeInTheDocument()
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
