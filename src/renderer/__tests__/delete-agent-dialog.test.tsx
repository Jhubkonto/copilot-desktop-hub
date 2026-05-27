import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeleteAgentDialog } from '../components/DeleteAgentDialog'
import type { DeleteAgentImpact } from '../store/app-store'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeImpact(overrides: Partial<DeleteAgentImpact> = {}): DeleteAgentImpact {
  return {
    agentId: 'agent-1',
    agentName: 'Test Agent',
    affectedProjects: [],
    affectedConvCount: 0,
    ...overrides
  }
}

describe('DeleteAgentDialog', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── i5-1: Dialog title ─────────────────────────────────────────────────────

  it('i5-1: renders agent name in the dialog title', () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact({ agentName: 'My Custom Agent' })}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText(/My Custom Agent/)).toBeInTheDocument()
  })

  // ── i5-2: affected projects listed ────────────────────────────────────────

  it('i5-2: lists affected project names', () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact({
          affectedProjects: [
            { id: 'p1', name: 'Alpha Project', is_primary: 0 },
            { id: 'p2', name: 'Beta Project', is_primary: 0 }
          ]
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText('Alpha Project')).toBeInTheDocument()
    expect(screen.getByText('Beta Project')).toBeInTheDocument()
  })

  // ── i5-3: primary project warning ─────────────────────────────────────────

  it('i5-3: shows primary agent warning for affected primary project', () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact({
          affectedProjects: [{ id: 'p1', name: 'Lead Project', is_primary: 1 }]
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText(/was primary agent/i)).toBeInTheDocument()
  })

  it('i5-3b: non-primary project does not show primary warning', () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact({
          affectedProjects: [{ id: 'p1', name: 'Side Project', is_primary: 0 }]
        })}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.queryByText(/was primary agent/i)).not.toBeInTheDocument()
  })

  // ── i5-4: conversation count ───────────────────────────────────────────────

  it('i5-4: shows affected conversation count', () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact({ affectedConvCount: 14 })}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText(/14 past conversation/i)).toBeInTheDocument()
  })

  // ── i5-5: Cancel button ────────────────────────────────────────────────────

  it('i5-5: Cancel button calls onCancel', async () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact()}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // ── i5-6: Delete Agent button ──────────────────────────────────────────────

  it('i5-6: Delete Agent button calls onConfirm', async () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact()}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /delete agent/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  // ── i5-7: Escape key ───────────────────────────────────────────────────────

  it('i5-7: pressing Escape calls onCancel', async () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact()}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  // ── i5-8: backdrop click ───────────────────────────────────────────────────

  it('i5-8: clicking the backdrop calls onCancel', async () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact()}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    const backdrop = screen.getByRole('dialog')
    await userEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  // ── i5-9: cannot-be-undone notice ─────────────────────────────────────────

  it('i5-9: shows "cannot be undone" notice', () => {
    render(
      <DeleteAgentDialog
        impact={makeImpact()}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
  })
})
