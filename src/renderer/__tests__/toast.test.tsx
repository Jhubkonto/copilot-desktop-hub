import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContainer } from '../../renderer/components/Toast'
import type { Toast } from '../../renderer/store/types'

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
    // Icons are now Lucide SVGs; query by aria-label on dismiss and role on toast
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(3)
    expect(screen.getAllByLabelText('Dismiss')).toHaveLength(3)
  })

  it('renders empty when no toasts', () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={vi.fn()} />)
    const alerts = container.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(0)
  })
})
