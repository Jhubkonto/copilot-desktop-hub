import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DeviceCodeModal } from '../components/DeviceCodeModal'

const defaultProps = {
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  onCancel: vi.fn(),
}

describe('DeviceCodeModal', () => {
  it('displays the user code', () => {
    render(<DeviceCodeModal {...defaultProps} />)
    expect(screen.getByText('ABCD-1234')).toBeTruthy()
  })

  it('renders a link to the verification URL', () => {
    render(<DeviceCodeModal {...defaultProps} />)
    const link = screen.getByRole('link', { name: /open github/i })
    expect(link.getAttribute('href')).toBe('https://github.com/login/device')
  })

  it('copies user code to clipboard when code div is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })
    render(<DeviceCodeModal {...defaultProps} />)
    const codeDiv = screen.getByTitle('Click to copy')
    fireEvent.click(codeDiv)
    expect(writeText).toHaveBeenCalledWith('ABCD-1234')
  })

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<DeviceCodeModal {...defaultProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('has correct dialog aria attributes', () => {
    render(<DeviceCodeModal {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('GitHub device code')
  })
})
