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

describe('ChatMessages normalized live turn fallback', () => {
  it('renders normalized thinking blocks when legacy live thinking state is empty', () => {
    renderChatMessages({
      liveTurnState: {
        ...createEmptyChatTurnState('conv-1'),
        turnId: 'turn-1',
        status: 'streaming',
        thinkingBlocks: new Map([
          ['reasoning-1', { blockId: 'reasoning-1', content: 'Checking context', done: false }],
        ]),
      },
    })

    expect(screen.getByText('Checking context')).toBeInTheDocument()
  })

  it('renders normalized activity and cost as fallback values', () => {
    const state = {
      ...createEmptyChatTurnState('conv-1'),
      turnId: 'turn-1',
      status: 'active' as const,
      activity: {
        state: 'tool',
        label: 'Running browser_snapshot',
        toolName: 'browser_snapshot',
        serverName: 'Browser',
      },
      cost: {
        inputTokens: 1200,
        outputTokens: 300,
        totalCostUsd: 0.0123,
      },
    }

    const { rerender } = renderChatMessages({
      isGenerating: true,
      liveTurnState: state,
    })

    expect(screen.getByText('browser_snapshot')).toBeInTheDocument()
    expect(screen.getByText('· Browser')).toBeInTheDocument()

    rerender(
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
        liveTurnState={state}
      />,
    )

    expect(screen.getByText('$0.0123')).toBeInTheDocument()
    expect(screen.getByText(/1[,.]200 in/)).toBeInTheDocument()
    expect(screen.getByText('300 out')).toBeInTheDocument()
  })

  it('renders normalized live tool calls until the matching legacy tool message exists', () => {
    const state = {
      ...createEmptyChatTurnState('conv-1'),
      turnId: 'turn-1',
      status: 'active' as const,
      toolCalls: [{
        id: 'tool-1',
        toolName: 'read_file',
        serverName: 'codex',
        args: { path: 'README.md' },
        result: 'contents',
        success: true,
      }],
    }

    const { rerender } = renderChatMessages({
      liveTurnState: state,
    })

    expect(screen.getByText('read_file')).toBeInTheDocument()
    expect(screen.getByText('contents')).toBeInTheDocument()

    rerender(
      <ChatMessagesBase
        messages={[{
          id: 'legacy-tool',
          role: 'tool-call',
          content: '',
          timestamp: 1,
          toolCallId: 'tool-1',
          toolName: 'read_file',
          serverName: 'codex',
          toolArgs: { path: 'README.md' },
          toolResult: 'contents',
          toolSuccess: true,
        }]}
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
        liveTurnState={state}
      />,
    )

    expect(screen.getAllByText('read_file')).toHaveLength(1)
    expect(screen.getAllByText('contents')).toHaveLength(1)
  })
})
