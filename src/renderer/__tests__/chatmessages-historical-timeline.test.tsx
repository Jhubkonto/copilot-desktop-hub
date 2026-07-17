import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChatMessagesBase } from '../components/chat/ChatMessages'
import { createEmptyChatTurnState } from '../hooks/chat-turn-reducer'
import type { ChatMessage } from '../hooks/chat-types'

const noop = () => {}

function renderChatMessages(messages: ChatMessage[]) {
  return render(
    <ChatMessagesBase
      messages={messages}
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
      liveTurnState={createEmptyChatTurnState(null)}
    />,
  )
}

describe('ChatMessages historical timeline interleaving', () => {
  it('positions a persisted assistant text segment before the tool call that followed it, and shows only the tail segment in the bubble', () => {
    const messages: ChatMessage[] = [
      {
        id: 'tool-1',
        role: 'tool-call',
        content: '',
        timestamp: 200,
        toolCallId: 'tool-1',
        toolName: 'Read',
        toolArgs: { file_path: 'README.md' },
        toolResult: 'contents',
        toolSuccess: true,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: "I'll look at the key config files to give you a fuller picture.Here's the fuller picture of the setup.",
        timestamp: 300,
        textSegments: new Map([
          ['text-0', { blockId: 'text-0', content: "I'll look at the key config files to give you a fuller picture.", done: true, firstSeenAt: 100 }],
          ['text-1', { blockId: 'text-1', content: "Here's the fuller picture of the setup.", done: true, firstSeenAt: 250 }],
        ]),
      },
    ]

    renderChatMessages(messages)

    // The lead-in segment (said before the tool call) renders inline in the timeline.
    expect(screen.getByText("I'll look at the key config files to give you a fuller picture.")).toBeInTheDocument()
    // The tool call itself.
    expect(screen.getByText('Read README.md')).toBeInTheDocument()
    // The tail segment (said after the tool call) is the only text in the bubble —
    // it should not be duplicated inline.
    const tailMatches = screen.getAllByText("Here's the fuller picture of the setup.")
    expect(tailMatches).toHaveLength(1)
    // The lead-in segment is not repeated a second time inside the bubble either.
    expect(screen.getAllByText(/I'll look at the key config files/)).toHaveLength(1)
  })

  it('falls back to a single bubble with the full content when there are no text segments', () => {
    const messages: ChatMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'A simple, uninterrupted answer.',
        timestamp: 100,
      },
    ]

    renderChatMessages(messages)

    expect(screen.getByText('A simple, uninterrupted answer.')).toBeInTheDocument()
  })
})
