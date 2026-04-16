import { useState, useRef, useEffect } from 'react'

interface ChatWindowProps {
  conversationId: string | null
  onConversationCreated: (id: string) => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export function ChatWindow({ conversationId, onConversationCreated }: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeConversationRef = useRef<string | null>(conversationId)

  useEffect(() => {
    activeConversationRef.current = conversationId
  }, [conversationId])

  // Load messages when conversation changes
  useEffect(() => {
    if (conversationId) {
      window.api.getMessages(conversationId).then((msgs: ChatMessage[]) => {
        setMessages(
          msgs.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content
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
        // Stream complete — finalize the assistant message
        setStreamingContent((current) => {
          if (current) {
            const assistantMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: current
            }
            setMessages((prev) => [...prev, assistantMessage])
          }
          return ''
        })
        setIsGenerating(false)
      } else {
        setStreamingContent((prev) => prev + chunk)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return

    const content = input.trim()
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsGenerating(true)
    setStreamingContent('')

    // If no active conversation, create one
    let convId = activeConversationRef.current
    if (!convId) {
      convId = crypto.randomUUID()
      onConversationCreated(convId)
      activeConversationRef.current = convId
    }

    try {
      await window.api.sendMessage(convId, content)
    } catch (error) {
      console.error('Failed to send message:', error)
      setIsGenerating(false)
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'An error occurred while sending your message. Please try again.'
      }
      setMessages((prev) => [...prev, errorMessage])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const renderInput = () => (
    <div className="p-4 border-t border-gray-200 dark:border-gray-700">
      <div className="max-w-3xl mx-auto flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isGenerating}
          className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  )

  if (!conversationId && messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
              Copilot Desktop Hub
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Start a conversation with GitHub Copilot
            </p>
          </div>
        </div>
        {renderInput()}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isGenerating && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[80%] bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                {streamingContent}
                <span className="animate-pulse">▊</span>
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
      {renderInput()}
    </div>
  )
}
