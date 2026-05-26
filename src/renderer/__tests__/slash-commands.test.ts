import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SLASH_COMMANDS,
  executeSlashCommand,
  transformCodeSlashCommand,
  type SlashCommandContext
} from '../../renderer/slash-commands'

const clipboardWriteText = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: {
      getVersion: vi.fn().mockResolvedValue('0.1.0'),
      getWorkingDirectory: vi.fn().mockResolvedValue('C:\\workspace'),
      setWorkingDirectory: vi.fn().mockResolvedValue(true),
      updateAgent: vi.fn().mockResolvedValue(true),
      setConversationModel: vi.fn().mockResolvedValue(true),
      setTheme: vi.fn().mockResolvedValue(true),
      saveTextFile: vi.fn().mockResolvedValue('C:\\conversation.md'),
      createGist: vi.fn().mockResolvedValue('https://gist.github.com/example')
    },
    configurable: true,
    writable: true
  })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteText },
    configurable: true
  })
  clipboardWriteText.mockReset()
})

function createContext(): SlashCommandContext {
  return {
    conversationId: 'conv-1',
    messages: [],
    activeAgent: null,
    effectiveModelLabel: 'GPT-4o',
    conversationModel: null,
    theme: 'light',
    pushSystemMessage: vi.fn(),
    newChat: vi.fn(),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    setInput: vi.fn(),
    setTheme: vi.fn(),
    loadAgents: vi.fn().mockResolvedValue(undefined),
    loadConversations: vi.fn().mockResolvedValue(undefined),
    buildConversationMarkdown: vi.fn().mockReturnValue('# Conversation Export'),
    deleteMessagesAfter: vi.fn().mockResolvedValue(undefined),
    lastUndoneUserMessageRef: { current: null },
    setMessages: vi.fn()
  }
}

describe('slash-commands', () => {
  it('sc-1: SLASH_COMMANDS includes /help, /clear, /explain, /context', () => {
    const names = SLASH_COMMANDS.map((cmd) => cmd.name)
    expect(names).toEqual(expect.arrayContaining(['/help', '/clear', '/explain', '/context']))
  })

  it('sc-2: transformCodeSlashCommand returns null for non-code commands', () => {
    expect(transformCodeSlashCommand('/help')).toBeNull()
  })

  it("sc-3: transformCodeSlashCommand('/explain hello') returns a prompt containing 'Explain'", () => {
    expect(transformCodeSlashCommand('/explain hello')).toContain('Explain')
  })

  it('sc-4: transformCodeSlashCommand(\'/fix\') with no args returns a prompt', () => {
    expect(transformCodeSlashCommand('/fix')).toContain('Fix')
  })

  it('sc-5: executeSlashCommand returns false for empty input', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('', ctx)).resolves.toBe(false)
  })

  it('sc-6: executeSlashCommand(\'/help\') calls pushSystemMessage and returns true', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/help', ctx)).resolves.toBe(true)
    expect(ctx.pushSystemMessage).toHaveBeenCalled()
  })

  it('sc-7: executeSlashCommand(\'/theme dark\') calls setTheme and returns true', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/theme dark', ctx)).resolves.toBe(true)
    expect(ctx.setTheme).toHaveBeenCalledWith('dark')
  })

  it('sc-8: executeSlashCommand(\'/unknown-command\') returns false', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/unknown-command', ctx)).resolves.toBe(false)
  })
})
