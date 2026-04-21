import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Paperclip, TerminalSquare, Square, Send, X } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useAppStore } from '../store/app-store'
import { MODEL_OPTIONS, getModelLabel, getModelMultiplier } from '../../shared/models'

type ToastType = 'info' | 'success' | 'error'

interface Attachment {
  id: string
  name: string
  path: string
  size: number
}

interface PastedImage {
  id: string
  dataUrl: string
  name: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  model?: string | null
  attachments?: Attachment[]
  images?: PastedImage[]
  isEdited?: boolean
  isError?: boolean
  errorType?: string
  retryable?: boolean
  isStopped?: boolean
}

interface SlashCommandDef {
  name: string
  usage: string
  description: string
}

interface ContextRef {
  key: 'workspace' | 'git' | 'file'
  token: string
  value?: string
}

function hasIpcError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && 'error' in result
}

const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: '/clear', usage: '/clear', description: 'Clear current conversation messages' },
  { name: '/new', usage: '/new [prompt]', description: 'Start a new chat' },
  { name: '/undo', usage: '/undo', description: 'Remove the last user/assistant exchange' },
  { name: '/redo', usage: '/redo', description: 'Resend the last undone user message' },
  { name: '/compact', usage: '/compact', description: 'Compact visible chat to recent context' },
  { name: '/exit', usage: '/exit', description: 'Exit current conversation view' },
  { name: '/help', usage: '/help', description: 'Show slash command help' },
  { name: '/version', usage: '/version', description: 'Show app version' },
  { name: '/login', usage: '/login', description: 'Start GitHub sign-in flow' },
  { name: '/logout', usage: '/logout', description: 'Sign out from GitHub' },
  { name: '/cwd', usage: '/cwd', description: 'Show working directory' },
  { name: '/cd', usage: '/cd <dir>', description: 'Change working directory' },
  { name: '/add-dir', usage: '/add-dir <dir>', description: 'Add directory to active agent context' },
  { name: '/list-dirs', usage: '/list-dirs', description: 'List active agent context directories' },
  { name: '/share', usage: '/share [file]', description: 'Share conversation as markdown' },
  { name: '/copy', usage: '/copy', description: 'Copy last assistant response' },
  { name: '/model', usage: '/model [name]', description: 'Show or set conversation model' },
  { name: '/models', usage: '/models', description: 'List available models' },
  { name: '/usage', usage: '/usage', description: 'Show session usage stats' },
  { name: '/config', usage: '/config', description: 'Show current chat configuration' },
  { name: '/theme', usage: '/theme [dark|light]', description: 'Show or set theme' },
  { name: '/explain', usage: '/explain [text]', description: 'Explain code or request' },
  { name: '/fix', usage: '/fix [text]', description: 'Fix code issues' },
  { name: '/tests', usage: '/tests [text]', description: 'Generate tests' },
  { name: '/refactor', usage: '/refactor [text]', description: 'Refactor code' },
  { name: '/docs', usage: '/docs [text]', description: 'Generate documentation' },
  { name: '/review', usage: '/review [text]', description: 'Review code for issues' }
]

const AT_CONTEXT_OPTIONS = [
  { token: '@workspace', key: 'workspace', description: 'Attach workspace summary' },
  { token: '@git', key: 'git', description: 'Attach git branch, status, recent commits' },
  { token: '@file:', key: 'file', description: 'Attach file by path (example: @file:src/main.ts)' }
] as const

export function ChatWindow() {
  const conversationId = useAppStore((s) => s.currentConversationId)
  const activeAgentId = useAppStore((s) => s.activeAgentId)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const agents = useAppStore((s) => s.agents)
  const conversations = useAppStore((s) => s.conversations)
  const authenticated = useAppStore((s) => s.authState.authenticated)
  const theme = useAppStore((s) => s.theme)
  const showTerminal = useAppStore((s) => s.showTerminal)

  const conversationCreated = useAppStore((s) => s.conversationCreated)
  const loadConversations = useAppStore((s) => s.loadConversations)
  const loadAgents = useAppStore((s) => s.loadAgents)
  const newChat = useAppStore((s) => s.newChat)
  const setTheme = useAppStore((s) => s.setTheme)
  const login = useAppStore((s) => s.login)
  const logout = useAppStore((s) => s.logout)
  const toggleTerminal = useAppStore((s) => s.toggleTerminal)
  const addToast = useAppStore((s) => s.addToast) as (message: string, type?: ToastType) => void

  const activeAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) ?? null : null
  const currentConversation = conversationId
    ? conversations.find((c) => c.id === conversationId) ?? null
    : null
  const [defaultModelSetting, setDefaultModelSetting] = useState('default')
  const conversationModel = currentConversation?.model ?? null
  const effectiveModel = conversationModel || activeAgent?.model || defaultModelSetting || 'default'
  const effectiveModelLabel = getModelLabel(effectiveModel)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null)
  const [generationElapsedSec, setGenerationElapsedSec] = useState(0)
  const [rateLimitRemainingSec, setRateLimitRemainingSec] = useState(0)
  const [streamingContent, setStreamingContent] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])
  const [pendingImages, setPendingImages] = useState<PastedImage[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const dragDepthRef = useRef(0)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
  const [showAtMenu, setShowAtMenu] = useState(false)
  const [atFilter, setAtFilter] = useState('')
  const [selectedAtIndex, setSelectedAtIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLSelectElement>(null)
  const activeConversationRef = useRef<string | null>(conversationId)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamingContentRef = useRef('')
  const lastUndoneUserMessageRef = useRef<string | null>(null)
  const pendingEditedResendRef = useRef(false)
  const streamModelRef = useRef<string | null>(null)
  // Input history (like a CLI — Alt+Up/Down to cycle)
  const inputHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1) // -1 = live input (not browsing history)
  const historyDraftRef = useRef('') // saves current draft when entering history mode
  const contextRefs = useMemo(() => {
    const refs: ContextRef[] = []
    const regex = /(?:^|\s)@(workspace|git)\b|(?:^|\s)@file:([^\s]+)/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(input)) !== null) {
      if (match[1]) {
        const key = match[1].toLowerCase() as 'workspace' | 'git'
        refs.push({ key, token: `@${key}` })
      } else if (match[2]) {
        refs.push({ key: 'file', token: `@file:${match[2]}`, value: match[2] })
      }
    }
    return refs
  }, [input])

  useEffect(() => {
    activeConversationRef.current = conversationId
  }, [conversationId])

  useEffect(() => {
    window.api.getSetting('default_model')
      .then((value) => setDefaultModelSetting(typeof value === 'string' ? value : 'default'))
      .catch(() => setDefaultModelSetting('default'))
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
      setIsLoadingMessages(true)
      window.api.getMessages(conversationId).then((msgs: Array<{
        id: string
        role: string
        content: string
        timestamp: number
        model?: string | null
        is_edited?: number
        attachments?: string
      }>) => {
      setMessages((prev) => {
          const imageMap = new Map(
            prev.filter((m) => m.images).map((m) => [m.id, m.images!])
          )
          return msgs.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            timestamp: m.timestamp,
            model: m.model ?? null,
            isEdited: m.is_edited === 1,
            attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
            images: imageMap.get(m.id)
          }))
        })
      }).catch(() => {
        addToast('Failed to load messages', 'error')
        setMessages([])
      }).finally(() => {
        setIsLoadingMessages(false)
      })
    } else {
      setMessages([])
      setIsLoadingMessages(false)
    }
    setStreamingContent('')
    streamingContentRef.current = ''
    setIsGenerating(false)
    setGenerationStartedAt(null)
    setGenerationElapsedSec(0)
  }, [conversationId, addToast])

  // Subscribe to streaming responses
  useEffect(() => {
    const unsubscribe = window.api.onStreamResponse((chunk: string | null) => {
      if (chunk === null) {
        const finalContent = streamingContentRef.current
        if (finalContent) {
          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: finalContent,
            timestamp: Date.now(),
            model: streamModelRef.current
          }
          setMessages((prev) => [...prev, assistantMessage])
        }
        streamingContentRef.current = ''
        streamModelRef.current = null
        setStreamingContent('')
        setIsGenerating(false)
        setGenerationStartedAt(null)
        setGenerationElapsedSec(0)
        loadConversations()
      } else {
        streamingContentRef.current += chunk
        setStreamingContent((prev) => prev + chunk)
      }
    })

    const unsubscribeError = window.api.onStreamError((error: {
      type: string
      message: string
      retryable: boolean
      retryAfterSeconds?: number
    }) => {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error.message,
        timestamp: Date.now(),
        isError: true,
        errorType: error.type,
        retryable: error.retryable
      }
      streamingContentRef.current = ''
      streamModelRef.current = null
      setStreamingContent('')
      setIsGenerating(false)
      setGenerationStartedAt(null)
      setGenerationElapsedSec(0)
      if (error.type === 'rate_limit') {
        const waitSeconds = typeof error.retryAfterSeconds === 'number' && error.retryAfterSeconds > 0
          ? error.retryAfterSeconds
          : 15
        setRateLimitRemainingSec(waitSeconds)
      }
      setMessages((prev) => [...prev, errorMessage])
      loadConversations()
    })

    return () => {
      unsubscribe()
      unsubscribeError()
    }
  }, [loadConversations])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  useEffect(() => {
    if (!isGenerating || !generationStartedAt) return
    const id = window.setInterval(() => {
      setGenerationElapsedSec(Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)))
    }, 250)
    return () => {
      window.clearInterval(id)
    }
  }, [isGenerating, generationStartedAt])

  useEffect(() => {
    if (rateLimitRemainingSec <= 0) return
    const id = window.setInterval(() => {
      setRateLimitRemainingSec((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => {
      window.clearInterval(id)
    }
  }, [rateLimitRemainingSec])

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content)
  }, [])

  const handleRegenerate = useCallback(async (modelOverride?: string) => {
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
    setGenerationStartedAt(Date.now())
    setGenerationElapsedSec(0)
    setStreamingContent('')
    streamingContentRef.current = ''
    streamModelRef.current = effectiveModel === 'default' ? null : effectiveModel
    const requestModel = effectiveModel === 'default' ? undefined : effectiveModel
    streamModelRef.current = requestModel ?? null
    const regenModel = modelOverride ?? (effectiveModel === 'default' ? null : effectiveModel)
    streamModelRef.current = regenModel

    try {
      if (modelOverride) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system',
            content: `Regenerating with ${getModelLabel(modelOverride)}.`,
            timestamp: Date.now()
          }
        ])
      }
      const regenOptions: { regenerate: true; model?: string; images?: { id: string; name: string; dataUrl: string }[]; attachments?: { id: string; name: string; path: string; size: number }[] } = { regenerate: true }
      if (regenModel) regenOptions.model = String(regenModel)
      if (lastUser.images && lastUser.images.length > 0) regenOptions.images = lastUser.images
      if (lastUser.attachments && lastUser.attachments.length > 0) regenOptions.attachments = lastUser.attachments
      await window.api.sendMessage(String(conversationId), String(lastUser.content), regenOptions)
    } catch (error) {
      console.error('Regenerate failed:', error)
      setIsGenerating(false)
      setGenerationStartedAt(null)
      streamModelRef.current = null
      addToast('Failed to regenerate response', 'error')
    }
  }, [conversationId, messages, isGenerating, addToast, effectiveModel])

  const handleEdit = useCallback(
    (messageIndex: number) => {
      if (isGenerating) return

      const message = messages[messageIndex]
      setInput(message.content)
      inputRef.current?.focus()
      pendingEditedResendRef.current = true

      // Remove this message and all after it from state
      setMessages((prev) => prev.slice(0, messageIndex))

      // Delete from DB
      if (conversationId && message.timestamp) {
        window.api.deleteMessagesAfter(conversationId, message.timestamp).catch(() => {
          addToast('Failed to delete messages', 'error')
        })
      }
    },
    [conversationId, messages, isGenerating, addToast]
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

  const removeImage = (id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    e.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setPendingImages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), dataUrl, name: `image.${item.type.split('/')[1] ?? 'png'}` }
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current++
    setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current--
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setIsDragging(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)

    const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'])
    const files = Array.from(e.dataTransfer.files)

    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      if (IMAGE_EXTS.has(ext) || f.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          setPendingImages((prev) => [...prev, { id: crypto.randomUUID(), dataUrl, name: f.name }])
        }
        reader.readAsDataURL(f)
      } else {
        const path = (f as File & { path?: string }).path || ''
        if (path) {
          setPendingAttachments((prev) => [...prev, { id: crypto.randomUUID(), name: f.name, path, size: f.size }])
        }
      }
    }
  }

  const pushSystemMessage = useCallback((content: string) => {
    const systemMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content,
      timestamp: Date.now()
    }
    setMessages((prev) => [...prev, systemMessage])
  }, [])

  const transformCodeSlashCommand = useCallback((rawInput: string): string | null => {
    const [command, ...rest] = rawInput.split(/\s+/)
    const argText = rest.join(' ').trim()
    const content = argText || 'Use the attached context and provide the best possible result.'

    const map: Record<string, string> = {
      '/explain': 'Explain this code clearly and concisely.',
      '/fix': 'Fix bugs and issues in this code.',
      '/tests': 'Generate robust tests for this code.',
      '/refactor': 'Refactor this code for readability and maintainability.',
      '/docs': 'Write documentation and inline doc comments for this code.',
      '/review': 'Review this code for bugs, edge cases, and security issues.'
    }

    const instruction = map[command]
    if (!instruction) return null
    return `${instruction}\n\n${content}`
  }, [])

  const buildConversationMarkdown = useCallback((): string => {
    const lines: string[] = ['# Conversation Export', '']
    for (const msg of messages) {
      if (msg.role === 'system') {
        lines.push(`_System_: ${msg.content}`)
      } else if (msg.role === 'user') {
        lines.push(`## User`, '', msg.content, '')
      } else {
        lines.push(`## Assistant`, '', msg.content, '')
      }
    }
    return lines.join('\n')
  }, [messages])

  const executeSlashCommand = useCallback(async (rawInput: string): Promise<boolean> => {
    if (!rawInput.startsWith('/')) return false

    const [command, ...rest] = rawInput.split(/\s+/)
    const argText = rest.join(' ').trim()

    switch (command) {
      case '/help': {
        const helpText = [
          'Available slash commands:',
          ...SLASH_COMMANDS.map((c) => `- ${c.usage}: ${c.description}`)
        ].join('\n')
        pushSystemMessage(helpText)
        return true
      }
      case '/version': {
        try {
          const version = await window.api.getVersion()
          pushSystemMessage(`Copilot Desktop Hub v${version}`)
        } catch {
          pushSystemMessage('Unable to read app version.')
        }
        return true
      }
      case '/login': {
        await login()
        pushSystemMessage('Started sign-in flow.')
        return true
      }
      case '/logout': {
        await logout()
        pushSystemMessage('Signed out.')
        return true
      }
      case '/cwd': {
        const cwd = await window.api.getWorkingDirectory()
        pushSystemMessage(`Current working directory:\n${cwd}`)
        return true
      }
      case '/cd': {
        if (!argText) {
          pushSystemMessage('Usage: /cd <directory>')
          return true
        }
        try {
          await window.api.setWorkingDirectory(argText)
          pushSystemMessage(`Working directory set to:\n${argText}`)
        } catch {
          pushSystemMessage(`Failed to set working directory:\n${argText}`)
        }
        return true
      }
      case '/add-dir': {
        if (!argText) {
          pushSystemMessage('Usage: /add-dir <directory>')
          return true
        }
        if (!activeAgent) {
          pushSystemMessage('No active agent selected. Select an agent first.')
          return true
        }
        const nextDirs = Array.from(new Set([...(activeAgent.contextDirectories ?? []), argText]))
        await window.api.updateAgent(activeAgent.id, {
          ...activeAgent,
          contextDirectories: nextDirs
        })
        await loadAgents()
        pushSystemMessage(`Added directory to ${activeAgent.name} context:\n${argText}`)
        return true
      }
      case '/list-dirs': {
        if (!activeAgent) {
          pushSystemMessage('No active agent selected.')
          return true
        }
        const dirs = activeAgent.contextDirectories ?? []
        if (dirs.length === 0) {
          pushSystemMessage(`${activeAgent.name} has no context directories.`)
        } else {
          pushSystemMessage(
            `${activeAgent.name} context directories:\n${dirs.map((d) => `- ${d}`).join('\n')}`
          )
        }
        return true
      }
      case '/copy': {
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
        if (!lastAssistant) {
          pushSystemMessage('No assistant message to copy.')
          return true
        }
        await navigator.clipboard.writeText(lastAssistant.content)
        pushSystemMessage('Copied last assistant response to clipboard.')
        return true
      }
      case '/share': {
        const markdown = buildConversationMarkdown()
        if (argText.toLowerCase() === 'file') {
          const savedPath = await window.api.saveTextFile('conversation.md', markdown)
          if (savedPath) {
            pushSystemMessage(`Conversation saved to:\n${savedPath}`)
          } else {
            pushSystemMessage('Save canceled.')
          }
        } else if (argText.toLowerCase() === 'gist') {
          try {
            const gistUrl = await window.api.createGist(
              'conversation.md',
              markdown,
              'Shared from Copilot Desktop Hub'
            )
            pushSystemMessage(`Created secret gist:\n${gistUrl}`)
          } catch {
            pushSystemMessage('Failed to create gist. Make sure you are signed in to GitHub.')
          }
        } else {
          await navigator.clipboard.writeText(markdown)
          pushSystemMessage('Conversation markdown copied to clipboard.')
        }
        return true
      }
      case '/model': {
        if (!argText) {
          pushSystemMessage(`Current model: ${effectiveModelLabel}`)
          return true
        }
        if (!(MODEL_OPTIONS as readonly string[]).includes(argText)) {
          pushSystemMessage(`Unknown model: ${argText}. Use /models to list available models.`)
          return true
        }
        if (!conversationId) {
          pushSystemMessage('No active conversation. Start a chat before setting a model.')
          return true
        }
        const value = argText === 'default' ? null : argText
        const result = await window.api.setConversationModel(conversationId, value)
        if (hasIpcError(result)) {
          pushSystemMessage(`Failed to set model: ${result.error}`)
          return true
        }
        await loadConversations()
        pushSystemMessage(`Model set to ${getModelLabel(argText)}.`)
        return true
      }
      case '/models': {
        const current = conversationModel ?? 'default'
        const text = ['Available models:']
        for (const model of MODEL_OPTIONS) {
          const mark = model === current ? '*' : '-'
          text.push(`${mark} ${getModelLabel(model)}`)
        }
        pushSystemMessage(text.join('\n'))
        return true
      }
      case '/usage': {
        const userCount = messages.filter((m) => m.role === 'user').length
        const assistantCount = messages.filter((m) => m.role === 'assistant').length
        const systemCount = messages.filter((m) => m.role === 'system').length
        const charCount = messages.reduce((sum, m) => sum + m.content.length, 0)
        const estimatedTokens = Math.ceil(charCount / 4)
        pushSystemMessage(
          `Usage (current chat)\n- Messages: ${messages.length}\n- User: ${userCount}\n- Assistant: ${assistantCount}\n- System: ${systemCount}\n- Estimated tokens: ${estimatedTokens}`
        )
        return true
      }
      case '/config': {
        const configLines = [
          'Current config:',
          `- Conversation model: ${getModelLabel(conversationModel ?? 'default')}`,
          `- Effective model: ${effectiveModelLabel}`,
          `- Theme: ${theme}`,
          `- Active agent: ${activeAgent ? activeAgent.name : 'none'}`
        ]
        if (activeAgent) {
          configLines.push(`- Agent temperature: ${activeAgent.temperature}`)
          configLines.push(`- Agent max tokens: ${activeAgent.maxTokens}`)
        }
        pushSystemMessage(configLines.join('\n'))
        return true
      }
      case '/theme': {
        if (!argText) {
          pushSystemMessage(`Current theme: ${theme}`)
          return true
        }
        if (argText !== 'dark' && argText !== 'light') {
          pushSystemMessage('Usage: /theme [dark|light]')
          return true
        }
        setTheme(argText)
        await window.api.setTheme(argText)
        pushSystemMessage(`Theme set to ${argText}.`)
        return true
      }
      case '/clear': {
        if (conversationId) {
          await window.api.deleteMessagesAfter(conversationId, 0)
        }
        setMessages([])
        pushSystemMessage('Conversation cleared.')
        return true
      }
      case '/new': {
        newChat()
        activeConversationRef.current = null
        setMessages([])
        if (argText) {
          setInput(argText)
          pushSystemMessage('Started new chat. Prompt inserted in input.')
        } else {
          pushSystemMessage('Started new chat.')
        }
        return true
      }
      case '/exit': {
        newChat()
        activeConversationRef.current = null
        setMessages([])
        return true
      }
      case '/undo': {
        const index = messages.length - 1
        if (index < 1) {
          pushSystemMessage('Nothing to undo.')
          return true
        }
        const last = messages[index]
        const prev = messages[index - 1]
        if (last.role !== 'assistant' || prev.role !== 'user') {
          pushSystemMessage('Undo only supports the last user/assistant exchange.')
          return true
        }
        lastUndoneUserMessageRef.current = prev.content
        setMessages((curr) => curr.slice(0, -2))
        if (conversationId) {
          await window.api.deleteMessagesAfter(conversationId, prev.timestamp)
        }
        pushSystemMessage('Last exchange removed. Use /redo to resend.')
        return true
      }
      case '/redo': {
        const redoContent = lastUndoneUserMessageRef.current
        if (!redoContent) {
          pushSystemMessage('Nothing to redo.')
          return true
        }
        setInput(redoContent)
        pushSystemMessage('Redo restored the previous user message to input.')
        return true
      }
      case '/compact': {
        const trimmed = messages.filter((m) => m.role !== 'system').slice(-8)
        setMessages(trimmed)
        pushSystemMessage('Compacted to recent context.')
        return true
      }
      default:
        pushSystemMessage(`Unknown command: ${command}. Use /help.`)
        return true
    }
  }, [
    conversationId,
    messages,
    newChat,
    pushSystemMessage,
    login,
    logout,
    activeAgent,
    loadAgents,
    buildConversationMarkdown,
    effectiveModelLabel,
    conversationModel,
    loadConversations,
    theme,
    setTheme
  ])

  const removeContextToken = useCallback((token: string) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    setInput((prev) => prev.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), ' ').replace(/\s{2,}/g, ' ').trim())
  }, [])

  const resolveContextBlock = useCallback(async (refs: ContextRef[]) => {
    const lines: string[] = []
    for (const ref of refs) {
      if (ref.key === 'workspace') {
        const summary = await window.api.getWorkspaceSummary()
        lines.push(`[Workspace]\n${summary}`)
        continue
      }
      if (ref.key === 'git') {
        const gitContext = await window.api.getGitContext()
        lines.push(`[Git]\n${gitContext}`)
        continue
      }
      if (ref.key === 'file' && ref.value) {
        const result = await window.api.readContextFile(ref.value)
        const header = result.truncated
          ? `File: ${result.path} (truncated)`
          : `File: ${result.path}`
        lines.push(`${header}\n\`\`\`\n${result.content}\n\`\`\``)
      }
    }
    return lines.join('\n\n')
  }, [])

  const handleSend = async () => {
    if (!input.trim() || isGenerating || rateLimitRemainingSec > 0) return

    let content = input.trim()
    if (content.startsWith('/')) {
      const transformed = transformCodeSlashCommand(content)
      if (transformed) {
        content = transformed
      } else {
        const handled = await executeSlashCommand(content)
        if (handled) {
          setInput('')
          setShowSlashMenu(false)
          setSlashFilter('')
          setSelectedSlashIndex(0)
          return
        }
      }
    }

    if (input.trim().startsWith('/')) {
      setShowSlashMenu(false)
      setSlashFilter('')
      setSelectedSlashIndex(0)
    }

    const attachments =
      pendingAttachments.length > 0 ? [...pendingAttachments] : undefined
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined

    const cleanedContent = content
      .replace(/(?:^|\s)@(workspace|git)\b/gi, ' ')
      .replace(/(?:^|\s)@file:[^\s]+/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    if (contextRefs.length > 0) {
      try {
        const contextBlock = await resolveContextBlock(contextRefs)
        if (contextBlock) {
          content = `${contextBlock}\n\n${cleanedContent || 'Please use the attached context.'}`
        }
      } catch {
        addToast('Failed to resolve @context references', 'error')
      }
    }

    const userDisplayContent = input.trim()
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userDisplayContent,
      timestamp: Date.now(),
      attachments,
      images,
      isEdited: pendingEditedResendRef.current
    }
    pendingEditedResendRef.current = false

    setMessages((prev) => [...prev, userMessage])
    // Push to input history (skip duplicate of last entry, cap at 100)
    const sent = input.trim()
    const history = inputHistoryRef.current
    if (sent && history[0] !== sent) {
      inputHistoryRef.current = [sent, ...history].slice(0, 100)
    }
    historyIndexRef.current = -1
    historyDraftRef.current = ''
    setInput('')
    setPendingAttachments([])
    setPendingImages([])
    setIsGenerating(true)
    setGenerationStartedAt(Date.now())
    setGenerationElapsedSec(0)
    setStreamingContent('')
    streamingContentRef.current = ''
    const requestModel = effectiveModel === 'default' ? undefined : effectiveModel
    streamModelRef.current = requestModel ?? null

    let convId = activeConversationRef.current
    if (!convId) {
      convId = crypto.randomUUID()
      conversationCreated(convId)
      activeConversationRef.current = convId
    }

    try {

      await window.api.sendMessage(convId, content, {
        attachments,
        images,
        agentId: activeAgentId ?? undefined,
        model: requestModel,
        messageId: userMessage.id,
        projectId: activeProjectId ?? undefined
      })
    } catch (error) {
      console.error('Failed to send message:', error)
      setIsGenerating(false)
      setGenerationStartedAt(null)
      streamModelRef.current = null
      addToast('Failed to send message. Please try again.', 'error')
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Failed to send message. Please check your connection and try again.',
        timestamp: Date.now(),
        isError: true,
        errorType: 'network',
        retryable: true
      }
      setMessages((prev) => [...prev, errorMessage])
    }
  }

  const handleRetry = useCallback(async () => {
    if (isGenerating || messages.length < 1) return

    // Find the last user message
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return

    // Remove error messages from the end
    const trimmedMessages = [...messages]
    while (trimmedMessages.length > 0 && trimmedMessages[trimmedMessages.length - 1].isError) {
      const errMsg = trimmedMessages.pop()!
      await window.api.deleteMessage(errMsg.id).catch(() => {})
    }
    setMessages(trimmedMessages)

    setIsGenerating(true)
    setGenerationStartedAt(Date.now())
    setGenerationElapsedSec(0)
    setStreamingContent('')
    streamingContentRef.current = ''

    const convId = activeConversationRef.current
    if (!convId) return

    try {
      await window.api.sendMessage(convId, lastUser.content, {
        regenerate: true,
        model: effectiveModel === 'default' ? undefined : effectiveModel
      })
    } catch (error) {
      console.error('Retry failed:', error)
      setIsGenerating(false)
      setGenerationStartedAt(null)
      streamModelRef.current = null
      addToast('Retry failed. Please try again.', 'error')
    }
  }, [messages, isGenerating, addToast, effectiveModel])

  const handleSignIn = useCallback(() => {
    login()
  }, [login])

  const handleSetConversationModel = useCallback(async (model: string) => {
    if (!conversationId) return
    const value = model === 'default' ? null : model
    try {
      const result = await window.api.setConversationModel(conversationId, value)
      if (hasIpcError(result)) {
        throw new Error(result.error)
      }
      await loadConversations()
      addToast(`Model set to ${getModelLabel(model)}`, 'success')
    } catch {
      addToast('Failed to set conversation model', 'error')
    }
  }, [conversationId, loadConversations, addToast])

  const handleStop = async () => {
    try {
      await window.api.stopGeneration()
      // Save partial streamed content if any
      const partialContent = streamingContentRef.current
      if (partialContent) {
        const stoppedMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: partialContent,
          timestamp: Date.now(),
          model: streamModelRef.current,
          isStopped: true
        }
        setMessages((prev) => [...prev, stoppedMessage])
      }
      streamingContentRef.current = ''
      streamModelRef.current = null
      setStreamingContent('')
      setIsGenerating(false)
      setGenerationStartedAt(null)
      setGenerationElapsedSec(0)
    } catch {
      addToast('Failed to stop generation', 'error')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAtMenu) {
      const visibleContexts = AT_CONTEXT_OPTIONS.filter((opt) =>
        opt.token.slice(1).startsWith(atFilter.toLowerCase())
      )
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedAtIndex((prev) =>
          visibleContexts.length === 0 ? 0 : (prev + 1) % visibleContexts.length
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedAtIndex((prev) =>
          visibleContexts.length === 0 ? 0 : (prev - 1 + visibleContexts.length) % visibleContexts.length
        )
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && visibleContexts.length > 0) {
        e.preventDefault()
        const selected = visibleContexts[selectedAtIndex] ?? visibleContexts[0]
        const atMatch = input.match(/(^|\s)@([a-z]*)$/i)
        if (atMatch) {
          setInput((prev) => `${prev.slice(0, atMatch.index)}${atMatch[1]}${selected.token} `)
        } else {
          setInput((prev) => `${prev} ${selected.token} `.trimStart())
        }
        setShowAtMenu(false)
        setAtFilter('')
        setSelectedAtIndex(0)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowAtMenu(false)
        return
      }
    }

    if (showSlashMenu) {
      const visibleCommands = SLASH_COMMANDS.filter((cmd) =>
        cmd.name.slice(1).startsWith(slashFilter.toLowerCase())
      )
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSlashIndex((prev) =>
          visibleCommands.length === 0 ? 0 : (prev + 1) % visibleCommands.length
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSlashIndex((prev) =>
          visibleCommands.length === 0 ? 0 : (prev - 1 + visibleCommands.length) % visibleCommands.length
        )
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && visibleCommands.length > 0) {
        e.preventDefault()
        const selected = visibleCommands[selectedSlashIndex] ?? visibleCommands[0]
        setInput(`${selected.name} `)
        setShowSlashMenu(false)
        setSlashFilter('')
        setSelectedSlashIndex(0)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSlashMenu(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }

    // Alt+Up/Down — cycle through input history like a CLI
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const history = inputHistoryRef.current
      if (history.length === 0) return
      if (e.key === 'ArrowUp') {
        if (historyIndexRef.current === -1) {
          historyDraftRef.current = input
        }
        const nextIndex = Math.min(historyIndexRef.current + 1, history.length - 1)
        historyIndexRef.current = nextIndex
        setInput(history[nextIndex])
      } else {
        if (historyIndexRef.current === -1) return
        const nextIndex = historyIndexRef.current - 1
        historyIndexRef.current = nextIndex
        setInput(nextIndex === -1 ? historyDraftRef.current : history[nextIndex])
      }
    }
  }

  // Find the last assistant message index for regenerate button
  const lastAssistantIndex = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages.length - 1
    : -1

  const renderModelPicker = () => (
    <div className="px-4 pt-3">
      <div className="max-w-3xl mx-auto flex items-center justify-end">
        <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>Model</span>
          <select
            value={conversationModel ?? 'default'}
            onChange={(e) => handleSetConversationModel(e.target.value)}
            ref={modelPickerRef}
            className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
            aria-label="Conversation model"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {getModelLabel(m)}{getModelMultiplier(m) ? ` · ${getModelMultiplier(m)}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )

  const renderInput = () => (
    <div className="p-4 border-t border-gray-200 dark:border-gray-700/80">
      <div className="max-w-3xl mx-auto">
        {/* Pending attachments */}
        {(pendingAttachments.length > 0 || pendingImages.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingImages.map((img) => (
              <div
                key={img.id}
                className="relative group/img inline-flex"
              >
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="h-16 w-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                  aria-label="Remove image"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            {pendingAttachments.map((att) => (
              <span
                key={att.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300"
              >
                <Paperclip className="w-3 h-3" />
                {att.name}
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-0.5"
                  aria-label={`Remove ${att.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {contextRefs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {contextRefs.map((ref, idx) => (
              <span
                key={`${ref.token}-${idx}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300"
              >
                {ref.token}
                <button
                  onClick={() => removeContextToken(ref.token)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-0.5"
                  aria-label={`Remove ${ref.token}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {showSlashMenu && (
          <div className="mb-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            {SLASH_COMMANDS.filter((cmd) =>
              cmd.name.slice(1).startsWith(slashFilter.toLowerCase())
            ).slice(0, 8).map((cmd, idx) => (
              <button
                key={cmd.name}
                type="button"
                onClick={() => {
                  setInput(`${cmd.name} `)
                  setShowSlashMenu(false)
                  setSlashFilter('')
                  setSelectedSlashIndex(0)
                  inputRef.current?.focus()
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
                  idx === selectedSlashIndex
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <span className="font-mono">{cmd.name}</span>
                <span className="ml-3 text-gray-400">{cmd.description}</span>
              </button>
            ))}
          </div>
        )}

        {showAtMenu && (
          <div className="mb-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            {AT_CONTEXT_OPTIONS.filter((opt) =>
              opt.token.slice(1).startsWith(atFilter.toLowerCase())
            ).slice(0, 6).map((opt, idx) => (
              <button
                key={opt.token}
                type="button"
                onClick={() => {
                  const atMatch = input.match(/(^|\s)@([a-z]*)$/i)
                  if (atMatch) {
                    setInput((prev) => `${prev.slice(0, atMatch.index)}${atMatch[1]}${opt.token} `)
                  } else {
                    setInput((prev) => `${prev} ${opt.token} `.trimStart())
                  }
                  setShowAtMenu(false)
                  setAtFilter('')
                  setSelectedAtIndex(0)
                  inputRef.current?.focus()
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
                  idx === selectedAtIndex
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <span className="font-mono">{opt.token}</span>
                <span className="ml-3 text-gray-400">{opt.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleFilePick}
            disabled={isGenerating}
            className="px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Attach files"
            aria-label="Attach files"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <button
            onClick={toggleTerminal}
            className={`px-3 py-2.5 rounded-lg border transition-colors ${
              showTerminal
                ? 'border-gray-400 dark:border-gray-500 text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            title="Toggle terminal"
            aria-label="Toggle terminal"
            aria-pressed={showTerminal}
          >
            <TerminalSquare className="w-4 h-4" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              const next = e.target.value
              setInput(next)
              // Typing manually exits history-browsing mode
              historyIndexRef.current = -1
              historyDraftRef.current = ''
              const slashMatch = next.match(/^\/([a-z-]*)$/i)
              if (slashMatch) {
                setShowSlashMenu(true)
                setSlashFilter(slashMatch[1] ?? '')
                setSelectedSlashIndex(0)
              } else {
                setShowSlashMenu(false)
              }
              const atMatch = next.match(/(^|\s)@([a-z]*)$/i)
              if (atMatch) {
                setShowAtMenu(true)
                setAtFilter(atMatch[2] ?? '')
                setSelectedAtIndex(0)
              } else {
                setShowAtMenu(false)
              }
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDragOver={(e) => e.preventDefault()}
            placeholder={!authenticated ? 'Sign in to start chatting' : isOnline ? 'Type a message... (paste images with Ctrl+V)' : 'Offline — reconnect to send messages'}
            rows={1}
            disabled={!isOnline || !authenticated || rateLimitRemainingSec > 0}
            aria-label="Message input"
            className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {isGenerating ? (
            <button
              onClick={handleStop}
              className="px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
              aria-label="Stop generating"
            >
              <span className="flex items-center gap-1.5">
                <Square className="w-3.5 h-3.5" />
                Stop
              </span>
            </button>
          ) : (
            <button
              onClick={handleSend}
               disabled={!input.trim() || !isOnline || !authenticated || rateLimitRemainingSec > 0}
              className="px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Send message"
            >
              <span className="flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" />
                Send
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )

  if (!conversationId && messages.length === 0) {
    return (
      <div
        className={`flex-1 flex flex-col min-h-0 ${isDragging ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/5' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-medium text-gray-700 dark:text-gray-200 mb-2">
              {activeAgent ? `${activeAgent.icon} ${activeAgent.name}` : 'Copilot Desktop Hub'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {activeAgent
                ? `Start a conversation with ${activeAgent.name}`
                : 'Start a conversation with GitHub Copilot'}
            </p>
            {!authenticated && (
              <button
                type="button"
                onClick={() => login()}
                className="mb-4 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
              >
                Sign in with GitHub
              </button>
            )}
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
      className={`flex-1 flex flex-col min-h-0 ${isDragging ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/5' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="region"
      aria-label="Chat conversation"
    >
      {conversationId && renderModelPicker()}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-6" role="log" aria-live="polite" aria-label="Messages">
        <div className="max-w-3xl mx-auto space-y-8">
          {isLoadingMessages && (
            <>
              {[0, 1, 2].map((i) => (
                <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                  <div className="max-w-[80%] rounded-lg px-4 py-3 bg-gray-100 dark:bg-gray-800 animate-pulse">
                    <div className="h-3 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                    <div className="h-3 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
                  </div>
                </div>
              ))}
            </>
          )}
          {messages.map((msg, index) => (
            <MessageBubble
              key={msg.id}
              id={msg.id}
              role={msg.role}
              content={msg.content}
              isEdited={msg.isEdited}
              modelLabel={msg.role === 'assistant' ? getModelLabel(msg.model ?? effectiveModel) : undefined}
              attachments={msg.attachments}
              images={msg.images}
              isLastAssistant={index === lastAssistantIndex}
              isGenerating={isGenerating}
              isError={msg.isError}
              errorType={msg.errorType}
              retryable={msg.retryable}
              isStopped={msg.isStopped}
              onCopy={handleCopy}
              onRegenerate={
                index === lastAssistantIndex ? () => handleRegenerate() : undefined
              }
              onRegenerateWithModel={
                index === lastAssistantIndex ? (model) => handleRegenerate(model) : undefined
              }
              onEdit={
                msg.role === 'user' ? () => handleEdit(index) : undefined
              }
              onRetry={msg.isError && msg.retryable ? handleRetry : undefined}
              onSignIn={msg.isError && msg.errorType === 'auth' ? handleSignIn : undefined}
              onPickModel={msg.isError && msg.errorType === 'model_not_available' ? () => modelPickerRef.current?.focus() : undefined}
            />
          ))}
          {isGenerating && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[80%] bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                <MarkdownRenderer content={streamingContent} />
                <span className="animate-pulse text-gray-400">▊</span>
              </div>
            </div>
          )}
          {isGenerating && !streamingContent && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-500">
                <span className="animate-pulse">Generating... {generationElapsedSec}s</span>
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
      {rateLimitRemainingSec > 0 && (
        <div className="px-4 pb-2">
          <div className="max-w-3xl mx-auto text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Rate limited — you can send again in {rateLimitRemainingSec}s.
          </div>
        </div>
      )}
      {renderInput()}
    </div>
  )
}
