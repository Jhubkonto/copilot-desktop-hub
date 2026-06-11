import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeleteConversationDialog } from '../components/DeleteConversationDialog'

describe('DeleteConversationDialog', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── dc-1: Dialog renders conversation title ────────────────────────────────

  it('dc-1: renders conversation title in the dialog heading', () => {
    render(
      <DeleteConversationDialog
        conversationTitle="My Chat Session"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText(/My Chat Session/)).toBeInTheDocument()
  })

  // ── dc-2: Cancel calls onCancel ────────────────────────────────────────────

  it('dc-2: Cancel button calls onCancel without calling onConfirm', async () => {
    render(
      <DeleteConversationDialog
        conversationTitle="My Chat"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // ── dc-3: Delete Chat button calls onConfirm ───────────────────────────────

  it('dc-3: Delete Chat button calls onConfirm', async () => {
    render(
      <DeleteConversationDialog
        conversationTitle="My Chat"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /delete chat/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  // ── dc-4: Escape key calls onCancel ───────────────────────────────────────

  it('dc-4: pressing Escape calls onCancel', async () => {
    render(
      <DeleteConversationDialog
        conversationTitle="My Chat"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  // ── dc-5: Backdrop click calls onCancel ───────────────────────────────────

  it('dc-5: clicking the backdrop calls onCancel', async () => {
    render(
      <DeleteConversationDialog
        conversationTitle="My Chat"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    const backdrop = screen.getByTestId('modal-backdrop')
    await userEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  // ── dc-6: Cannot be undone notice ─────────────────────────────────────────

  it('dc-6: shows "cannot be undone" notice', () => {
    render(
      <DeleteConversationDialog
        conversationTitle="My Chat"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
  })
})
