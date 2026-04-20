import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContainer, useToasts, type Toast } from '../../renderer/components/Toast'

describe('Toast Component', () => {
  it('renders toast messages', () => {
    const toasts: Toast[] = [
      { id: '1', message: 'Hello', type: 'info' },
      { id: '2', message: 'Error!', type: 'error' }
    ]
    render(<ToastContainer toasts={toasts} onDismiss={vi.fn()} />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('Error!')).toBeInTheDocument()
  })

  it('calls onDismiss when dismiss button clicked', async () => {
    const onDismiss = vi.fn()
    const toasts: Toast[] = [{ id: '1', message: 'Test toast', type: 'success' }]
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />)

    const user = userEvent.setup()
    const dismissBtn = screen.getByLabelText('Dismiss')
    await user.click(dismissBtn)
    expect(onDismiss).toHaveBeenCalledWith('1')
  })

  it('auto-dismisses after timeout', async () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const toasts: Toast[] = [{ id: 'auto-1', message: 'Auto dismiss', type: 'info' }]
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />)

    expect(onDismiss).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(onDismiss).toHaveBeenCalledWith('auto-1')
    vi.useRealTimers()
  })

  it('renders correct icon for each type', () => {
    const toasts: Toast[] = [
      { id: 's', message: 'Success', type: 'success' },
      { id: 'e', message: 'Error', type: 'error' },
      { id: 'i', message: 'Info', type: 'info' }
    ]
    render(<ToastContainer toasts={toasts} onDismiss={vi.fn()} />)
    expect(screen.getByText('✓')).toBeInTheDocument()
    expect(screen.getByText('✕')).toBeInTheDocument()
    expect(screen.getByText('ℹ')).toBeInTheDocument()
  })

  it('renders empty when no toasts', () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={vi.fn()} />)
    const alerts = container.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(0)
  })
})

describe('useToasts hook', () => {
  function TestComponent() {
    const { toasts, addToast, dismissToast } = useToasts()
    return (
      <div>
        <button onClick={() => addToast('Test message', 'success')}>Add</button>
        <button onClick={() => toasts[0] && dismissToast(toasts[0].id)}>Dismiss First</button>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    )
  }

  it('adds and dismisses toasts', async () => {
    const user = userEvent.setup()
    render(<TestComponent />)

    expect(screen.queryByText('Test message')).not.toBeInTheDocument()
    await user.click(screen.getByText('Add'))
    expect(screen.getByText('Test message')).toBeInTheDocument()
    await user.click(screen.getByText('Dismiss First'))
    expect(screen.queryByText('Test message')).not.toBeInTheDocument()
  })
})
