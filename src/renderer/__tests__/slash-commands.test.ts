import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SLASH_COMMANDS,
  executeSlashCommand,
  transformCodeSlashCommand,
  buildUsageBar,
  formatContextUsage,
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

// ── /usage visual bar ─────────────────────────────────────────────────────────

describe('buildUsageBar', () => {
  it('m10-1: returns all filled blocks when used >= limit', () => {
    const bar = buildUsageBar(100, 100)
    expect(bar).toContain('100%')
    expect(bar).not.toContain('░')
  })

  it('m10-2: returns all empty blocks when used is 0', () => {
    const bar = buildUsageBar(0, 100)
    expect(bar).toContain('0%')
    expect(bar).not.toContain('█')
  })

  it('m10-3: returns ~50% bar when half used', () => {
    const bar = buildUsageBar(50, 100, 20)
    expect(bar).toContain('50%')
    expect(bar).toContain('██████████')
    expect(bar).toContain('░░░░░░░░░░')
  })

  it('m10-4: clamps bar at 100% when used > limit', () => {
    const bar = buildUsageBar(200, 100)
    expect(bar).toContain('100%')
  })
})

describe('formatContextUsage', () => {
  it('m10-5: includes model name and token count in output', () => {
    const out = formatContextUsage(4000, 'gpt-4o')
    expect(out).toContain('gpt-4o')
    expect(out).toMatch(/4[,.]?000/)
  })

  it('m10-6: uses 128k limit for unknown model', () => {
    const out = formatContextUsage(1000, 'unknown-model')
    expect(out).toContain('128k')
  })
})

describe('/usage slash command (M.10)', () => {
  it('m10-7: /usage outputs a visual bar and message counts', async () => {
    const ctx = createContext()
    ctx.messages = [
      { id: '1', role: 'user', content: 'Hello world', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Hi there', timestamp: 2 },
    ]
    await executeSlashCommand('/usage', ctx)
    const msg = (ctx.pushSystemMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(msg).toContain('Session usage')
    expect(msg).toContain('1 user' )
    expect(msg).toMatch(/\[.*\]/)  // usage bar brackets
    expect(msg).toContain('%')
  })
})
