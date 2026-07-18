import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../../renderer/components/ui/ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders title, body, and confirm label', () => {
    render(
      <ConfirmDialog title='Delete "Thing"?' confirmLabel="Delete Thing" onConfirm={vi.fn()} onCancel={vi.fn()}>
        <p>Body text</p>
      </ConfirmDialog>,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Body text')).toBeInTheDocument()
    expect(screen.getByText('Delete Thing')).toBeInTheDocument()
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
  })

  it('hides the irreversible note when irreversible=false', () => {
    render(
      <ConfirmDialog title="Discard?" confirmLabel="Discard" irreversible={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.queryByText('This action cannot be undone.')).not.toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog title="Delete?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={vi.fn()} />)
    await userEvent.setup().click(screen.getByText('Delete'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel on Cancel click and on Escape', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog title="Delete?" confirmLabel="Delete" onConfirm={vi.fn()} onCancel={onCancel} />)
    await userEvent.setup().click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('focuses the Cancel button on open', () => {
    render(<ConfirmDialog title="Delete?" confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(document.activeElement).toBe(screen.getByText('Cancel'))
  })

  it('disables both buttons and blocks Escape while busy', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog title="Delete?" confirmLabel="Delete" busy onConfirm={vi.fn()} onCancel={onCancel} />,
    )
    expect(screen.getByText('Delete')).toBeDisabled()
    expect(screen.getByText('Cancel')).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
