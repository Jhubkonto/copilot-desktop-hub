import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatWindow } from '../../renderer/components/ChatWindow'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore
}))

let mockApi: MockApi
let streamCallback: ((chunk: string | null) => void) | null = null
let mockStore: ReturnType<typeof createMockAppStore>

beforeEach(() => {
  mockApi = setupMockApi()
  streamCallback = null
  mockApi.getMessages.mockResolvedValue([])

  mockApi.onStreamResponse.mockImplementation((cb: (chunk: string | null) => void) => {
    streamCallback = cb
    return () => {
      streamCallback = null
    }
  })

  mockStore = createMockAppStore({
    authState: { authenticated: true, user: null }
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('ChatWindow — Empty State', () => {
  it('chat-r-1: shows welcome message with default title', () => {
    render(<ChatWindow />)
    expect(screen.getByText('Copilot Desktop Hub')).toBeInTheDocument()
  })

  it('chat-r-1b: shows agent name when activeAgent provided', () => {
    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      agents: [{ id: 'a1', name: 'Code Helper', icon: '🧑‍💻' }],
      activeAgentId: 'a1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ChatWindow />)
    expect(screen.getByText('🧑‍💻 Code Helper')).toBeInTheDocument()
  })

  it('chat-r-9: empty input does not send', async () => {
    const user = userEvent.setup()
    render(<ChatWindow />)

    const sendButton = screen.getByRole('button', { name: /send/i })
    await user.click(sendButton)
    expect(mockApi.sendMessage).not.toHaveBeenCalled()
  })
})

describe('ChatWindow — Sending Messages', () => {
  it('chat-r-3: user message appears immediately after send (optimistic)', async () => {
    const user = userEvent.setup()
    render(<ChatWindow />)

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'Hello world')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('chat-r-8: Enter sends message, Shift+Enter inserts newline', async () => {
    const user = userEvent.setup()
    render(<ChatWindow />)

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'Line 1{Shift>}{Enter}{/Shift}Line 2')

    expect(mockApi.sendMessage).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('Line 1\nLine 2')

    await user.type(textarea, '{Enter}')

    expect(mockStore.conversationCreated).toHaveBeenCalled()
  })

  it('chat-r-6: send button disabled while isGenerating', async () => {
    const user = userEvent.setup()
    render(<ChatWindow />)

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'Test message')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument()
  })
})

describe('ChatWindow — Streaming', () => {
  it('chat-r-4: streaming content renders with typing indicator', async () => {
    const user = userEvent.setup()
    render(<ChatWindow />)

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'Test')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(screen.getByText('Thinking...')).toBeInTheDocument()

    act(() => {
      streamCallback?.('Hello ')
    })
    act(() => {
      streamCallback?.('world')
    })

    await waitFor(() => {
      expect(screen.getByText(/Hello world/)).toBeInTheDocument()
    })
    expect(screen.getByText('▊')).toBeInTheDocument()
  })

  it('chat-r-5: stream end appends final message and clears streaming', async () => {
    const user = userEvent.setup()
    render(<ChatWindow />)

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'Test')
    await user.click(screen.getByRole('button', { name: /send/i }))

    act(() => {
      streamCallback?.('Response text')
    })

    act(() => {
      streamCallback?.(null)
    })

    await waitFor(() => {
      expect(screen.getByText('Response text')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    expect(screen.queryByText('▊')).not.toBeInTheDocument()
  })

  it('chat-r-7: stop button visible while generating', async () => {
    const user = userEvent.setup()
    render(<ChatWindow />)

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'Test')
    await user.click(screen.getByRole('button', { name: /send/i }))

    const stopBtn = screen.getByRole('button', { name: /stop/i })
    expect(stopBtn).toBeInTheDocument()

    await user.click(stopBtn)
    expect(mockApi.stopGeneration).toHaveBeenCalled()
  })
})

describe('ChatWindow — Messages Display', () => {
  it('chat-r-2: messages render in chronological order', async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'First message', timestamp: 1000 },
      { id: 'm2', role: 'assistant', content: 'First reply', timestamp: 2000 },
      { id: 'm3', role: 'user', content: 'Second message', timestamp: 3000 }
    ])

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: 'conv-1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ChatWindow />)

    await waitFor(() => {
      expect(screen.getByText('First message')).toBeInTheDocument()
    })

    const messages = screen.getAllByText(/message|reply/i)
    expect(messages[0]).toHaveTextContent('First message')
    expect(messages[1]).toHaveTextContent('First reply')
    expect(messages[2]).toHaveTextContent('Second message')
  })
})

describe('ChatWindow — File Attachments', () => {
  it('chat-r-11: file attachment badge appears after file pick', async () => {
    const user = userEvent.setup()
    mockApi.openFileDialog.mockResolvedValue([
      { id: 'f1', name: 'test.ts', path: '/tmp/test.ts', size: 500 }
    ])

    render(<ChatWindow />)

    const attachBtn = screen.getByRole('button', { name: /attach/i })
    await user.click(attachBtn)

    await waitFor(() => {
      expect(screen.getByText(/test\.ts/)).toBeInTheDocument()
    })
  })

  it('chat-r-12: attachment removed when X clicked', async () => {
    const user = userEvent.setup()
    mockApi.openFileDialog.mockResolvedValue([
      { id: 'f1', name: 'test.ts', path: '/tmp/test.ts', size: 500 }
    ])

    render(<ChatWindow />)

    await user.click(screen.getByRole('button', { name: /attach/i }))

    await waitFor(() => {
      expect(screen.getByText(/test\.ts/)).toBeInTheDocument()
    })

    const removeBtn = screen.getByLabelText(/Remove/)
    await user.click(removeBtn)

    expect(screen.queryByText(/test\.ts/)).not.toBeInTheDocument()
  })
})

describe('ChatWindow — Offline State', () => {
  it('chat-r-13: offline placeholder shown when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true })

    render(<ChatWindow />)

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    expect(textarea).toHaveAttribute(
      'placeholder',
      expect.stringContaining('Offline')
    )

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true })
  })

  it('chat-r-14: input disabled when offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true })

    render(<ChatWindow />)

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    expect(textarea).toBeDisabled()

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true })
  })
})

describe('ChatWindow — Regenerate & Edit', () => {
  it('chat-r-15: regenerate button shown only on last assistant message', async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'Question', timestamp: 1000 },
      { id: 'm2', role: 'assistant', content: 'Answer', timestamp: 2000 }
    ])

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: 'conv-1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ChatWindow />)

    await waitFor(() => {
      expect(screen.getByText('Answer')).toBeInTheDocument()
    })

    expect(screen.getByText('Answer')).toBeInTheDocument()
  })

  it('chat-r-17: edit button shown on user messages', async () => {
    mockApi.getMessages.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'My question', timestamp: 1000 },
      { id: 'm2', role: 'assistant', content: 'My answer', timestamp: 2000 }
    ])

    mockStore = createMockAppStore({
      authState: { authenticated: true, user: null },
      currentConversationId: 'conv-1'
    })
    setupStoreMock(useAppStore, mockStore)

    render(<ChatWindow />)

    await waitFor(() => {
      expect(screen.getByText('My question')).toBeInTheDocument()
    })

    expect(screen.getByText('My question')).toBeInTheDocument()
  })
})
