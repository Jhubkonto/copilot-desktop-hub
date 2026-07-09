import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChatMessagesBase } from '../components/chat/ChatMessages'
import { createEmptyChatTurnState } from '../hooks/chat-turn-reducer'

const noop = () => {}

function renderChatMessages(overrides: Partial<Parameters<typeof ChatMessagesBase>[0]> = {}) {
  return render(
    <ChatMessagesBase
      messages={[]}
      isLoadingMessages={false}
      isGenerating={false}
      liveTeamActivity={[]}
      streamingContent=""
      generationStartedAt={null}
      loadingFailed={false}
      messagesEndRef={createRef<HTMLDivElement>()}
      scrollContainerRef={createRef<HTMLDivElement>()}
      onCopy={noop}
      wikiMessageIds={new Set()}
      onRegenerate={noop}
      onEdit={noop}
      onRetry={noop}
      onSignIn={noop}
      onPickModel={noop}
      {...overrides}
    />,
  )
}

describe('ChatMessages Codex CLI bulleted timeline', () => {
  it('renders a Codex tool call as a bulleted action line, not the boxed ToolCallBlock', () => {
    renderChatMessages({
      liveTurnState: {
        ...createEmptyChatTurnState('conv-1'),
        turnId: 'turn-1',
        status: 'active',
        toolCalls: [{
          id: 'cmd-1',
          toolName: 'Run Command',
          serverName: 'codex-cli',
          args: { command: 'ls -la' },
          result: 'file.txt',
          success: true,
          inProgress: false,
        }],
      },
    })

    expect(screen.getByText('Ran')).toBeInTheDocument()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    // ToolCallBlock renders the server-name badge as its own pill; the bulleted
    // Codex variant never does, so its absence confirms the boxed card didn't render.
    expect(screen.queryByText('codex-cli')).not.toBeInTheDocument()
  })

  it('still renders a Claude CLI tool call with the boxed ToolCallBlock (server-name badge)', () => {
    renderChatMessages({
      liveTurnState: {
        ...createEmptyChatTurnState('conv-1'),
        turnId: 'turn-1',
        status: 'active',
        toolCalls: [{
          id: 'call-1',
          toolName: 'Read',
          serverName: 'claude-cli',
          args: { file_path: 'x.ts' },
          result: 'contents',
          success: true,
          inProgress: false,
        }],
      },
    })

    expect(screen.getByText('claude-cli')).toBeInTheDocument()
  })

  it('renders a Codex reasoning burst as a plain narration bullet, not the collapsible ThinkingBlock', () => {
    renderChatMessages({
      liveTurnState: {
        ...createEmptyChatTurnState('conv-1'),
        turnId: 'turn-1',
        status: 'active',
        thinkingBlocks: new Map([
          ['codex-reasoning-summary-0', { blockId: 'codex-reasoning-summary-0', content: 'Checking the file first.', done: false }],
        ]),
      },
    })

    expect(screen.getByText('Checking the file first.')).toBeInTheDocument()
    // ThinkingBlock renders a "Reasoning…" toggle label; the bulleted variant never does.
    expect(screen.queryByText(/Reasoning/)).not.toBeInTheDocument()
  })

  it('still renders a non-Codex reasoning burst with the collapsible ThinkingBlock', () => {
    renderChatMessages({
      liveTurnState: {
        ...createEmptyChatTurnState('conv-1'),
        turnId: 'turn-1',
        status: 'active',
        thinkingBlocks: new Map([
          ['thinking-0', { blockId: 'thinking-0', content: 'Planning the change.', done: false }],
        ]),
      },
    })

    expect(screen.getByText('Reasoning…')).toBeInTheDocument()
  })
})
