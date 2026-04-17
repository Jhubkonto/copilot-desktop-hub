import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { MessageBubble } from './MessageBubble'
import { MarkdownRenderer } from './MarkdownRenderer'

interface Attachment {
  id: string
  name: string
  path: string
  size: number
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  attachments?: Attachment[]
}

interface ChatWindowProps {
  conversationId: string | null
  onConversationCreated: (id: string) => void
  onRefresh: () => void
  activeAgentId?: string | null
  activeAgent?: { id: string; name: string; icon: string } | null
  onToggleTerminal?: () => void
  showTerminal?: boolean
}

export function ChatWindow({
  conversationId,
  onConversationCreated,
  onRefresh,
  activeAgentId,
  activeAgent,
  onToggleTerminal,
  showTerminal
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeConversationRef = useRef<string | null>(conversationId)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    activeConversationRef.current = conversationId
  }, [conversationId])

  // Track connectivity
  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Load messages when conversation changes
  useEffect(() => {
    if (conversationId) {
      window.api.getMessages(conversationId).then((msgs: any[]) => {
        setMessages(
          msgs.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp,
            attachments: m.attachments ? JSON.parse(m.attachments) : undefined
          }))
        )
      })
    } else {
      setMessages([])
    }
    setStreamingContent('')
    setIsGenerating(false)
  }, [conversationId])

  // Subscribe to streaming responses
  useEffect(() => {
    const unsubscribe = window.api.onStreamResponse((chunk: string | null) => {
      if (chunk === null) {
        setStreamingContent((current) => {
          if (current) {
            const assistantMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: current,
              timestamp: Date.now()
            }
            setMessages((prev) => [...prev, assistantMessage])
          }
          return ''
        })
        setIsGenerating(false)
        onRefresh()
      } else {
        setStreamingContent((prev) => prev + chunk)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [onRefresh])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content)
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (!conversationId || messages.length < 2 || isGenerating) return

    const lastMsg = messages[messages.length - 1]
    if (lastMsg.role !== 'assistant') return

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return

    // Remove last assistant message from state
    setMessages((prev) => prev.slice(0, -1))

    // Delete from DB
    await window.api.deleteMessage(lastMsg.id)

    // Re-send the user message
    setIsGenerating(true)
    setStreamingContent('')

    try {
      await window.api.sendMessage(conversationId, lastUser.content, { regenerate: true })
    } catch (error) {
      console.error('Regenerate failed:', error)
      setIsGenerating(false)
    }
  }, [conversationId, messages, isGenerating])

  const handleEdit = useCallback(
    (messageIndex: number) => {
      if (isGenerating) return

      const message = messages[messageIndex]
      setInput(message.content)
      inputRef.current?.focus()

      // Remove this message and all after it from state
      const removedMessages = messages.slice(messageIndex)
      setMessages((prev) => prev.slice(0, messageIndex))

      // Delete from DB
      if (conversationId && message.timestamp) {
        window.api.deleteMessagesAfter(conversationId, message.timestamp)
      }
    },
    [conversationId, messages, isGenerating]
  )

  const handleFilePick = async () => {
    const files = await window.api.openFileDialog()
    if (files && files.length > 0) {
      setPendingAttachments((prev) => [...prev, ...files])
    }
  }

  const removeAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const attachments: Attachment[] = files.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      path: (f as any).path || '',
      size: f.size
    }))

    // Only add files with valid paths
    const validAttachments = attachments.filter((a) => a.path)
    if (validAttachments.length > 0) {
      setPendingAttachments((prev) => [...prev, ...validAttachments])
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return

    const content = input.trim()
    const attachments =
      pendingAttachments.length > 0 ? [...pendingAttachments] : undefined

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      attachments
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setPendingAttachments([])
    setIsGenerating(true)
    setStreamingContent('')

    let convId = activeConversationRef.current
    if (!convId) {
      convId = crypto.randomUUID()
      onConversationCreated(convId)
      activeConversationRef.current = convId
    }

    try {
      await window.api.sendMessage(convId, content, { attachments, agentId: activeAgentId ?? undefined })
    } catch (error) {
      console.error('Failed to send message:', error)
      setIsGenerating(false)
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'An error occurred while sending your message. Please try again.',
        timestamp: Date.now()
      }
      setMessages((prev) => [...prev, errorMessage])
    }
  }

  const handleStop = async () => {
    await window.api.stopGeneration()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Find the last assistant message index for regenerate button
  const lastAssistantIndex = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages.length - 1
    : -1

  const renderInput = () => (
    <div className="p-4 border-t border-gray-200 dark:border-gray-700">
      <div className="max-w-3xl mx-auto">
        {/* Pending attachments */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingAttachments.map((att) => (
              <span
                key={att.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300"
              >
                📎 {att.name}
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="text-gray-400 hover:text-red-500 ml-0.5"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleFilePick}
            disabled={isGenerating}
            className="px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
            title="Attach files"
            aria-label="Attach files"
          >
            📎
          </button>
          <button
            onClick={onToggleTerminal}
            className={`px-3 py-2.5 rounded-lg border text-sm transition-colors ${
              showTerminal
                ? 'border-blue-500 text-blue-500 bg-blue-50 dark:bg-blue-900/30'
                : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            title="Toggle terminal"
            aria-label="Toggle terminal"
            aria-pressed={showTerminal}
          >
            &gt;_
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isOnline ? 'Type a message...' : '⚠ Offline — reconnect to send messages'}
            rows={1}
            disabled={!isOnline}
            aria-label="Message input"
            className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {isGenerating ? (
            <button
              onClick={handleStop}
              className="px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
              aria-label="Stop generating"
            >
              ■ Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !isOnline}
              className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Send message"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )

  if (!conversationId && messages.length === 0) {
    return (
      <div
        className={`flex-1 flex flex-col ${isDragging ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/5' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
              {activeAgent ? `${activeAgent.icon} ${activeAgent.name}` : 'Copilot Desktop Hub'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {activeAgent
                ? `Start a conversation with ${activeAgent.name}`
                : 'Start a conversation with GitHub Copilot'}
            </p>
            {isDragging && (
              <p className="text-sm text-blue-500 animate-pulse">
                Drop files to attach
              </p>
            )}
          </div>
        </div>
        {renderInput()}
      </div>
    )
  }

  return (
    <div
      className={`flex-1 flex flex-col ${isDragging ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="region"
      aria-label="Chat conversation"
    >
      <div className="flex-1 overflow-y-auto px-4 py-6" role="log" aria-live="polite" aria-label="Messages">
        <div className="max-w-3xl mx-auto space-y-8">
          {messages.map((msg, index) => (
            <MessageBubble
              key={msg.id}
              id={msg.id}
              role={msg.role}
              content={msg.content}
              attachments={msg.attachments}
              isLastAssistant={index === lastAssistantIndex}
              isGenerating={isGenerating}
              onCopy={handleCopy}
              onRegenerate={
                index === lastAssistantIndex ? handleRegenerate : undefined
              }
              onEdit={
                msg.role === 'user' ? () => handleEdit(index) : undefined
              }
            />
          ))}
          {isGenerating && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[80%] bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                <MarkdownRenderer content={streamingContent} />
                <span className="animate-pulse text-blue-500">▊</span>
              </div>
            </div>
          )}
          {isGenerating && !streamingContent && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-500">
                <span className="animate-pulse">Thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 pointer-events-none z-10">
          <div className="text-lg font-medium text-blue-500 bg-white dark:bg-gray-800 px-6 py-3 rounded-xl shadow-lg">
            Drop files to attach
          </div>
        </div>
      )}
      {renderInput()}
    </div>
  )
}
