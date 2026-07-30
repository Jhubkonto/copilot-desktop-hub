import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatModePicker } from '../components/chat/ChatModePicker'

describe('ChatModePicker', () => {
  it('offers a per-conversation agentic override for BYOK chats', () => {
    const onChange = vi.fn()
    render(
      <ChatModePicker
        open
        onOpenChange={() => {}}
        thinkingEffortOverride={null}
        fullAutoApproveOverride={null}
        agenticModeOverride={null}
        terminalSandboxOverride={null}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('Agentic mode (this chat)')).toBeTruthy()
    const section = screen.getByText('Agentic mode (this chat)').parentElement
    const onButton = section?.querySelectorAll('button')[1]
    expect(onButton?.textContent).toBe('On')
    fireEvent.click(onButton!)
    expect(onChange).toHaveBeenCalledWith({ agenticModeOverride: true })
  })

  it('hides the BYOK-only agentic override for CLI chats', () => {
    render(
      <ChatModePicker
        open
        onOpenChange={() => {}}
        thinkingEffortOverride={null}
        fullAutoApproveOverride={null}
        agenticModeOverride={null}
        terminalSandboxOverride={null}
        activeCliBackend="codex-cli"
        onChange={() => {}}
      />,
    )

    expect(screen.queryByText('Agentic mode (this chat)')).toBeNull()
  })

  it('uses the same two-column grid and button height for every Claude CLI section', () => {
    render(
      <ChatModePicker
        open
        onOpenChange={() => {}}
        thinkingEffortOverride={null}
        fullAutoApproveOverride={null}
        agenticModeOverride={null}
        terminalSandboxOverride={null}
        activeCliBackend="claude-cli"
        onChange={() => {}}
      />,
    )

    for (const heading of [
      'Thinking effort (this chat)',
      'Terminal sandbox bypass (this chat)',
      'Claude Code mode (this chat)',
    ]) {
      const section = screen.getByText(heading).parentElement
      const grid = section?.querySelector('div')
      expect(grid?.className).toContain('grid-cols-2')
      grid?.querySelectorAll('button').forEach((button) => {
        expect(button.className).toContain('py-1')
        expect(button.className).not.toContain('py-1.5')
      })
    }
  })
})
