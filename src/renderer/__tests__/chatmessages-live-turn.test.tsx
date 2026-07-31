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

    expect(screen.getByText('read_file path: README.md')).toBeInTheDocument()
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

    // Still exactly one — confirms exactly one ToolCallBlock rendered, not both the
    // live and the now-committed historical version.
    expect(screen.getAllByText('read_file path: README.md')).toHaveLength(1)
  })

  it('positions a lead-in text segment above the tool call it preceded, during active generation (not just after the turn settles)', () => {
    const state = {
      ...createEmptyChatTurnState('conv-1'),
      turnId: 'turn-1',
      status: 'active' as const,
      text: "I'll search online for user feedback.Here's what I found so far",
      // text-0 is already closed (the tool call interrupted it) — text-1 is the one
      // still being typed. Ordering must be driven by `done`, not map-insertion-order,
      // since text-0 was for a while the *only* entry yet was never "the open one".
      textBlocks: new Map([
        ['text-0', { blockId: 'text-0', content: "I'll search online for user feedback.", done: true, firstSeenSequence: 1 }],
        ['text-1', { blockId: 'text-1', content: 'Here\'s what I found so far', done: false, firstSeenSequence: 3 }],
      ]),
      toolCalls: [{
        id: 'tool-1',
        toolName: 'WebSearch',
        args: { query: 'Hermes Agent feedback' },
        result: '',
        success: true,
        inProgress: true,
        firstSeenSequence: 2,
      }],
    }

    renderChatMessages({
      isGenerating: true,
      streamingContent: state.text,
      liveTurnState: state,
    })

    const container = screen.getByRole('log')
    const text = container.textContent ?? ''
    const leadInIndex = text.indexOf("I'll search online for user feedback.")
    const toolIndex = text.indexOf('Search "Hermes Agent feedback"')
    const trailingIndex = text.indexOf('Here\'s what I found so far')

    expect(leadInIndex).toBeGreaterThan(-1)
    expect(toolIndex).toBeGreaterThan(-1)
    expect(trailingIndex).toBeGreaterThan(-1)
    // Chronological order: lead-in text, then the tool call, then the still-open
    // trailing segment — not all bunched together after the tool call.
    expect(leadInIndex).toBeLessThan(toolIndex)
    expect(toolIndex).toBeLessThan(trailingIndex)
    // The lead-in text appears exactly once — not repeated in the trailing block too.
    expect(screen.getAllByText("I'll search online for user feedback.")).toHaveLength(1)
  })

  it('interleaves a single already-closed text segment above the tool call it preceded, instead of deferring it to the bottom as if still being typed', () => {
    // The exact reported bug: a lead-in sentence is written, a tool call interrupts it
    // (closing it — done: true), and no new text has started yet. Since it's the ONLY
    // entry in textBlocks, naively treating "last in the map" as "still open" would wrongly
    // defer it below the (still-running) tool call.
    const state = {
      ...createEmptyChatTurnState('conv-1'),
      turnId: 'turn-1',
      status: 'active' as const,
      text: 'I want to flag something before running this search.',
      textBlocks: new Map([
        ['text-0', { blockId: 'text-0', content: 'I want to flag something before running this search.', done: true, firstSeenSequence: 1 }],
      ]),
      toolCalls: [{
        id: 'tool-1',
        toolName: 'WebSearch',
        args: { query: 'Hermes Agent feedback' },
        result: '',
        success: true,
        inProgress: true,
        firstSeenSequence: 2,
      }],
    }

    renderChatMessages({
      isGenerating: true,
      streamingContent: state.text,
      liveTurnState: state,
    })

    const text = screen.getByRole('log').textContent ?? ''
    const leadInIndex = text.indexOf('I want to flag something before running this search.')
    const toolIndex = text.indexOf('Search "Hermes Agent feedback"')

    expect(leadInIndex).toBeGreaterThan(-1)
    expect(toolIndex).toBeGreaterThan(-1)
    expect(leadInIndex).toBeLessThan(toolIndex)
    // Nothing is currently open, so there's no trailing "current response" block —
    // the sentence appears exactly once, as an inline segment above the tool call.
    expect(screen.getAllByText('I want to flag something before running this search.')).toHaveLength(1)
  })

  it('does not render a completed CLI text segment beside its persisted assistant message', () => {
    const response = 'That traceback is a plain YAML syntax error.'
    const completedState = {
      ...createEmptyChatTurnState('conv-1'),
      turnId: 'turn-1',
      status: 'completed' as const,
      text: response,
      textBlocks: new Map([
        ['text-0', {
          blockId: 'text-0',
          content: response,
          done: true,
          firstSeenSequence: 1,
        }],
      ]),
    }

    renderChatMessages({
      messages: [{
        id: 'persisted-assistant',
        role: 'assistant',
        content: response,
        timestamp: 2,
        model: 'claude-cli',
      }],
      isGenerating: false,
      streamingContent: '',
      liveTurnState: completedState,
    })

    expect(screen.getAllByText(response)).toHaveLength(1)
  })

  it('keeps an earlier live thought above an eagerly stored command until the turn settles', () => {
    const state = {
      ...createEmptyChatTurnState('conv-1'),
      turnId: 'turn-1',
      status: 'active' as const,
      thinkingBlocks: new Map([
        ['thinking-0', {
          blockId: 'thinking-0',
          content: 'I should inspect the workspace first.',
          done: true,
          firstSeenSequence: 1,
        }],
      ]),
      toolCalls: [{
        id: 'tool-1',
        toolName: 'PowerShell',
        serverName: 'claude-cli',
        args: { command: 'Get-ChildItem -Force' },
        result: '',
        success: true,
        inProgress: true,
        firstSeenSequence: 2,
      }],
    }

    renderChatMessages({
      messages: [{
        id: 'optimistic-tool-1',
        role: 'tool-call',
        content: '',
        timestamp: 2,
        toolCallId: 'tool-1',
        toolName: 'PowerShell',
        serverName: 'claude-cli',
        toolArgs: { command: 'Get-ChildItem -Force' },
        toolResult: '',
        toolSuccess: true,
        toolInProgress: true,
      }],
      isGenerating: true,
      liveTurnState: state,
    })

    const text = screen.getByRole('log').textContent ?? ''
    expect(text.indexOf('I should inspect the workspace first.')).toBeLessThan(text.indexOf('PowerShell'))
    expect(screen.getAllByText(/PowerShell command:/)).toHaveLength(1)
  })
})
