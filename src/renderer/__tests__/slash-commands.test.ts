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
    chatProjectId: null,
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
    setMessages: vi.fn(),
    markComplete: vi.fn().mockResolvedValue(undefined),
    markIncomplete: vi.fn().mockResolvedValue(undefined),
    runSlashGeneration: vi.fn().mockResolvedValue({ artifactId: 'art-1', versionId: 'ver-1' }),
    attachArtifactMessage: vi.fn().mockResolvedValue(undefined),
    startCodeChange: vi.fn().mockResolvedValue({ reportId: 'report-1' }),
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

  it('sc-6: executeSlashCommand(\'/help\') calls pushSystemMessage and returns \'handled\'', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/help', ctx)).resolves.toBe('handled')
    expect(ctx.pushSystemMessage).toHaveBeenCalled()
  })

  it('sc-7: executeSlashCommand(\'/theme dark\') calls setTheme and returns \'handled\'', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/theme dark', ctx)).resolves.toBe('handled')
    expect(ctx.setTheme).toHaveBeenCalledWith('dark')
  })

  it('sc-8: executeSlashCommand(\'/unknown-command\') returns false', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/unknown-command', ctx)).resolves.toBe(false)
  })

  it('sc-9: a custom command returns \'expanded\' and sets the input to its prompt (not cleared)', async () => {
    const ctx = createContext()
    ctx.activeAgent = { customCommands: [{ name: '/standup', description: 'Daily standup', prompt: 'Summarize what we did today.' }] } as SlashCommandContext['activeAgent']
    await expect(executeSlashCommand('/standup', ctx)).resolves.toBe('expanded')
    expect(ctx.setInput).toHaveBeenCalledWith('Summarize what we did today.')
    expect(ctx.setInput).toHaveBeenCalledTimes(1)
  })

  it('sc-10: /complete calls markComplete and pushes a confirmation', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/complete', ctx)).resolves.toBe('handled')
    expect(ctx.markComplete).toHaveBeenCalled()
    expect(ctx.pushSystemMessage).toHaveBeenCalledWith(expect.stringContaining('complete'))
  })

  it('sc-11: /incomplete calls markIncomplete and pushes a confirmation', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/incomplete', ctx)).resolves.toBe('handled')
    expect(ctx.markIncomplete).toHaveBeenCalled()
  })

  it('sc-12: /debrief runs generation against the conversation model and attaches the result', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/debrief', ctx)).resolves.toBe('handled')
    expect(ctx.runSlashGeneration).toHaveBeenCalledWith('debrief', { model: undefined })
    expect(ctx.attachArtifactMessage).toHaveBeenCalledWith('art-1', 'ver-1')
  })

  it('sc-13: /quiz surfaces an error via pushSystemMessage without attaching anything', async () => {
    const ctx = createContext()
    ctx.runSlashGeneration = vi.fn().mockResolvedValue({ error: 'No debrief found' })
    await expect(executeSlashCommand('/quiz', ctx)).resolves.toBe('handled')
    expect(ctx.pushSystemMessage).toHaveBeenCalledWith(expect.stringContaining('No debrief found'))
    expect(ctx.attachArtifactMessage).not.toHaveBeenCalled()
  })

  it('sc-14: /code-change with no description shows usage and does not create a request', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/code-change', ctx)).resolves.toBe('handled')
    expect(ctx.startCodeChange).not.toHaveBeenCalled()
    expect(ctx.pushSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Usage'))
  })

  it('sc-15: /code-change <description> creates the request', async () => {
    const ctx = createContext()
    await expect(executeSlashCommand('/code-change fix the login bug', ctx)).resolves.toBe('handled')
    expect(ctx.startCodeChange).toHaveBeenCalledWith({ description: 'fix the login bug' })
  })

  it('sc-16: /code-change surfaces an error via pushSystemMessage on failure', async () => {
    const ctx = createContext()
    ctx.startCodeChange = vi.fn().mockResolvedValue({ error: 'requires this conversation to be in a project' })
    await expect(executeSlashCommand('/code-change fix it', ctx)).resolves.toBe('handled')
    expect(ctx.pushSystemMessage).toHaveBeenCalledWith(expect.stringContaining('requires this conversation to be in a project'))
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
