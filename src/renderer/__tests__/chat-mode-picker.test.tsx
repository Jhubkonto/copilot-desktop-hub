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
})
