import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ComposerActionsMenu } from '../components/chat/ComposerActionsMenu'

function renderMenu(overrides: Partial<Parameters<typeof ComposerActionsMenu>[0]> = {}) {
  const props = {
    showContextInspector: false,
    onAttachFiles: vi.fn(),
    onAttachFolder: vi.fn(),
    onCaptureScreen: vi.fn(),
    onPasteClipboardImage: vi.fn(),
    onOpenPromptLibrary: vi.fn(),
    onToggleContextInspector: vi.fn(),
    ...overrides,
  }
  render(<ComposerActionsMenu {...props} />)
  return props
}

describe('ComposerActionsMenu', () => {
  it('consolidates composer utilities into one menu and invokes an action', async () => {
    const user = userEvent.setup()
    const props = renderMenu()

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More message actions' }))

    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(6)

    await user.click(screen.getByRole('menuitem', { name: 'Capture screen' }))
    expect(props.onCaptureScreen).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps context inspection available while generation disables mutating actions', async () => {
    const user = userEvent.setup()
    const props = renderMenu({ disabled: true, showContextInspector: true })

    await user.click(screen.getByRole('button', { name: 'More message actions' }))

    expect(screen.getByRole('menuitem', { name: 'Attach files' })).toBeDisabled()
    const contextAction = screen.getByRole('menuitem', { name: 'Close context inspector' })
    expect(contextAction).toBeEnabled()

    await user.click(contextAction)
    expect(props.onToggleContextInspector).toHaveBeenCalledOnce()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'More message actions' })

    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
