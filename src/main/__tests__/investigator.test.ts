import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { sendProviderWithToolsMock, getProviderForAgentMock } = vi.hoisted(() => ({
  sendProviderWithToolsMock: vi.fn(),
  getProviderForAgentMock: vi.fn(() => ({ provider: 'openai', model: 'gpt-5-mini' })),
}))

vi.mock('../providers', () => ({
  getProviderForAgent: getProviderForAgentMock,
  getApiKey: vi.fn(() => 'sk-test'),
  sendProviderWithTools: sendProviderWithToolsMock,
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
}))

vi.mock('../model-catalog', () => ({
  getCachedCatalog: vi.fn(() => []),
}))

let db: Database.Database

vi.mock('../database', () => ({
  getDatabase: () => db,
}))

function createDatabase() {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  initializeBaseSchema(database)
  runMigrations(database)
  return database
}

describe('remote-edit investigator', () => {
  beforeEach(() => {
    vi.resetModules()
    sendProviderWithToolsMock.mockReset()
    getProviderForAgentMock.mockReset()
    getProviderForAgentMock.mockReturnValue({ provider: 'openai', model: 'gpt-5-mini' })
    db = createDatabase()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('build_workspace_path', ?)").run(process.cwd())
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('remote_edit_backend', 'byok')").run()
    db.prepare(
      `INSERT INTO error_reports (
        id, title, description, screenshot_path, log_snapshot, status,
        app_version, platform, os_version, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, 'open', '0.9.0-test', 'test', 'test', 1, 1)`,
    ).run('report-1', 'Synthetic failure', 'Something failed', '[{"message":"boom"}]')
  })

  afterEach(() => {
    db.close()
  })

  it('runs a synthetic investigation and persists structured markdown', async () => {
    sendProviderWithToolsMock
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/main/database.ts' } }],
        model: 'gpt-5-mini',
      })
      .mockResolvedValue({
        content: [
          '---',
          'confidence: high',
          'root_cause: missing guard',
          'affected_files:',
          '  - "src/main/database.ts"',
          '---',
          '',
          '# Summary',
          'The report points at a missing guard.',
        ].join('\n'),
        toolCalls: [],
        model: 'gpt-5-mini',
      })
    const { runInvestigation } = await import('../remote-edit/investigator')
    const chunks: string[] = []
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      {
        onChunk: (chunk) => chunks.push(chunk),
        onActivity: vi.fn(),
      },
    )

    const row = db.prepare('SELECT status, investigation_markdown, investigation_root_cause FROM error_reports WHERE id = ?').get('report-1') as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({
      reportId: 'report-1',
      status: 'done',
      confidence: 'high',
      rootCause: 'missing guard',
      affectedFiles: ['src/main/database.ts'],
    }))
    expect(chunks.join('')).toContain('# Summary')
    // status stays 'investigating' — a completed plan still needs an explicit human Accept
    // (remote-edit:set-report-status) before it's treated as approved and a patch can be
    // generated from it. It does not auto-advance to 'investigated'.
    expect(row).toEqual(expect.objectContaining({
      status: 'investigating',
      investigation_root_cause: 'missing guard',
    }))
    expect(String(row.investigation_markdown)).toContain('confidence: high')
  }, 15000)

  it('prefers a later, more complete yaml-fenced block over a leading placeholder front-matter block', async () => {
    sendProviderWithToolsMock
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'package.json' } }],
        model: 'hermes-4-70b',
      })
      .mockResolvedValue({
        content: [
          '---',
          'confidence: unknown',
          'root_cause: unknown',
          'affected_files: []',
          '---',
          '',
          'The `grep` tool is not available in this environment. Proceeding with alternative methods.',
          '',
          '## Investigation Report',
          '',
          '```yaml',
          'confidence: high',
          'root_cause: native dependency rebuild failure in better-sqlite3',
          'affected_files:',
          '  - package.json',
          '```',
          '',
          '### Summary',
          'Native module rebuild failure.',
        ].join('\n'),
        toolCalls: [],
        model: 'hermes-4-70b',
      })
    const { runInvestigation } = await import('../remote-edit/investigator')
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    expect(result).toEqual(expect.objectContaining({
      status: 'done',
      confidence: 'high',
      rootCause: 'native dependency rebuild failure in better-sqlite3',
      affectedFiles: ['package.json'],
    }))
    expect(result.markdown).toContain('confidence: unknown')
    expect(result.markdown).toContain('confidence: high')
  })

  it('prefers a later --- block over an earlier placeholder --- block', async () => {
    sendProviderWithToolsMock
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/main/database.ts' } }],
        model: 'hermes-4-70b',
      })
      .mockResolvedValue({
        content: [
          '---',
          'confidence: unknown',
          'root_cause: unknown',
          'affected_files: []',
          '---',
          '',
          'Some prose here before the real analysis.',
          '',
          '---',
          'confidence: medium',
          'root_cause: stale cache invalidation',
          'affected_files:',
          '  - src/main/database.ts',
          '---',
          '',
          '# Summary',
        ].join('\n'),
        toolCalls: [],
        model: 'hermes-4-70b',
      })
    const { runInvestigation } = await import('../remote-edit/investigator')
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    expect(result).toEqual(expect.objectContaining({
      confidence: 'medium',
      rootCause: 'stale cache invalidation',
      affectedFiles: ['src/main/database.ts'],
    }))
  })

  it('falls back to the only available block even if it is a placeholder', async () => {
    sendProviderWithToolsMock.mockResolvedValue({
      content: ['---', 'confidence: unknown', 'root_cause: unknown', 'affected_files: []', '---', '', '# Summary', 'No further detail.'].join('\n'),
      toolCalls: [],
      model: 'gpt-5-mini',
    })
    const { runInvestigation } = await import('../remote-edit/investigator')
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    expect(result).toEqual(expect.objectContaining({ confidence: 'unknown', rootCause: 'unknown', affectedFiles: [] }))
  })

  it('strips affected_files entries that were never confirmed by a successful tool call', async () => {
    sendProviderWithToolsMock
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/cli.ts' } }],
        model: 'hermes-4-70b',
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-2', name: 'read_file', arguments: { path: 'package.json' } }],
        model: 'hermes-4-70b',
      })
      .mockResolvedValue({
        content: [
          '---',
          'confidence: high',
          'root_cause: guessed root cause',
          'affected_files: ["src/cli.ts", "src/model.ts", "package.json"]',
          '---',
          '',
          '# Summary',
        ].join('\n'),
        toolCalls: [],
        model: 'hermes-4-70b',
      })
    const { runInvestigation } = await import('../remote-edit/investigator')
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    expect(result.affectedFiles).toEqual(['package.json'])
  })

  it('wraps the markdown when no front matter block is found anywhere', async () => {
    sendProviderWithToolsMock.mockResolvedValue({ content: '# Just prose, no yaml at all.', toolCalls: [], model: 'gpt-5-mini' })
    const { runInvestigation } = await import('../remote-edit/investigator')
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    expect(result.confidence).toBe('unknown')
    expect(result.markdown).toContain('# Just prose, no yaml at all.')
  })

  it('includes anti-fabrication and front-matter-format guidance in the system prompt sent to the provider', async () => {
    sendProviderWithToolsMock.mockResolvedValue({
      content: ['---', 'confidence: high', 'root_cause: x', 'affected_files: []', '---', '', '# Summary'].join('\n'),
      toolCalls: [],
      model: 'gpt-5-mini',
    })
    const { runInvestigation } = await import('../remote-edit/investigator')
    await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    const messages = sendProviderWithToolsMock.mock.calls[0][3] as { role: string; content: string }[]
    const systemMessage = messages.find((m) => m.role === 'system')
    expect(systemMessage?.content).toContain('Never invent files, error messages, stack traces')
    expect(systemMessage?.content).toContain('do not duplicate it later')
    expect(systemMessage?.content).toContain('must include a short verbatim quote')
    expect(systemMessage?.content).toContain('do not describe unrelated runtime/console errors')
    expect(systemMessage?.content).toContain('must contain ONLY the three keys confidence, root_cause, and affected_files')
    expect(systemMessage?.content).toContain('Never guess a file path for read_file')
    expect(systemMessage?.content).toContain('is not evidence of anything about the bug')
    // The bugfix path keeps the original bug-diagnosis phrasing (unlike the non-bugfix path,
    // which swaps these for plan-oriented wording — see the request-type branching test below).
    expect(systemMessage?.content).toContain('Markdown investigation report with YAML front matter')
    expect(systemMessage?.content).toContain('Summary, Evidence, and Recommended Next Steps are Markdown sections')
  })

  it('includes revision notes in the prompt when revising a plan', async () => {
    sendProviderWithToolsMock.mockResolvedValue({
      content: ['---', 'confidence: high', 'root_cause: x', 'affected_files: []', '---', '', '# Summary'].join('\n'),
      toolCalls: [],
      model: 'gpt-5-mini',
    })
    const { runInvestigation } = await import('../remote-edit/investigator')
    await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
      'Look in src/android instead of the desktop code',
    )
    const messages = sendProviderWithToolsMock.mock.calls[0][3] as { role: string; content: string }[]
    const userMessage = messages.find((m) => m.role === 'user')
    expect(userMessage?.content).toContain('The previous plan was reviewed and needs revision')
    expect(userMessage?.content).toContain('Look in src/android instead of the desktop code')
  })

  it('does not mention revision guidance in the prompt for a fresh plan', async () => {
    sendProviderWithToolsMock.mockResolvedValue({
      content: ['---', 'confidence: high', 'root_cause: x', 'affected_files: []', '---', '', '# Summary'].join('\n'),
      toolCalls: [],
      model: 'gpt-5-mini',
    })
    const { runInvestigation } = await import('../remote-edit/investigator')
    await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    const messages = sendProviderWithToolsMock.mock.calls[0][3] as { role: string; content: string }[]
    const userMessage = messages.find((m) => m.role === 'user')
    expect(userMessage?.content).not.toContain('previous plan was reviewed')
  })

  it('uses plan-this-change language instead of bug-diagnosis language for a non-bugfix request type', async () => {
    db.prepare("UPDATE error_reports SET request_type = 'refactor' WHERE id = 'report-1'").run()
    sendProviderWithToolsMock.mockResolvedValue({
      content: ['---', 'confidence: high', 'root_cause: x', 'affected_files: []', '---', '', '# Summary'].join('\n'),
      toolCalls: [],
      model: 'gpt-5-mini',
    })
    const { runInvestigation } = await import('../remote-edit/investigator')
    await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    const messages = sendProviderWithToolsMock.mock.calls[0][3] as { role: string; content: string }[]
    const systemMessage = messages.find((m) => m.role === 'system')
    const userMessage = messages.find((m) => m.role === 'user')
    expect(systemMessage?.content).toContain('Plan this change request')
    expect(systemMessage?.content).not.toContain('Investigate the captured bug')
    expect(systemMessage?.content).not.toContain('is not evidence of anything about the bug')
    // Regression: the front-matter key itself used to always be root_cause, which implies
    // something is broken — misleading for a plain, non-bugfix change request — even after the
    // surrounding prose was branched. Non-bugfix requests now ask for `approach` instead.
    expect(systemMessage?.content).not.toContain('confidence, root_cause, and affected_files')
    expect(systemMessage?.content).toContain('confidence, approach, and affected_files')
    // Regression: buildPrompt used to hardcode "investigation report" and "Recommended Next
    // Steps" for every request type, so a plan for a non-bugfix change still read like a bug
    // triage writeup even after the task-verb/root-cause branching was fixed.
    expect(systemMessage?.content).not.toContain('investigation report')
    expect(systemMessage?.content).toContain('Markdown plan with YAML front matter')
    expect(systemMessage?.content).toContain('Summary, Evidence, and Plan are Markdown sections')
    expect(userMessage?.content).toContain('Plan this change request.')
    expect(userMessage?.content).not.toContain('Investigate this bug report.')
    expect(userMessage?.content).toContain('a one-sentence summary of the planned approach')
    expect(userMessage?.content).toContain('confidence, approach (a one-sentence summary')
    expect(userMessage?.content).not.toContain('Recommended Next Steps')
    expect(userMessage?.content).toContain('the concrete steps you propose to make this change')
  })

  it('parses the approach: key (not root_cause:) from a non-bugfix plan into the same rootCause field', async () => {
    db.prepare("UPDATE error_reports SET request_type = 'refactor' WHERE id = 'report-1'").run()
    sendProviderWithToolsMock
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'package.json' } }],
        model: 'gpt-5-mini',
      })
      .mockResolvedValue({
        content: [
          '---',
          'confidence: high',
          'approach: Add a dedicated tests/ directory at the repo root and move loose spec files into it.',
          'affected_files:',
          '  - package.json',
          '---',
          '',
          '# Summary',
          'Consolidate scattered test files.',
        ].join('\n'),
        toolCalls: [],
        model: 'gpt-5-mini',
      })
    const { runInvestigation } = await import('../remote-edit/investigator')
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    expect(result).toEqual(expect.objectContaining({
      status: 'done',
      confidence: 'high',
      rootCause: 'Add a dedicated tests/ directory at the repo root and move loose spec files into it.',
      affectedFiles: ['package.json'],
    }))
    // The raw markdown shown to the user reflects what the model actually wrote — approach:, not
    // a relabeled root_cause: — since the UI renders this text verbatim.
    expect(result.markdown).toContain('approach: Add a dedicated tests/ directory')
    expect(result.markdown).not.toContain('root_cause:')
  })

  it('proactively uses the prompted tool-calling path for an OpenRouter model with no tool-call catalog support, instead of sending native tools it will silently ignore', async () => {
    // Regression test: some OpenRouter models (e.g. Hermes/Nous-family) accept a `tools` payload
    // without erroring but never populate a structured tool-call response — they emit their own
    // pretrained pseudo-tool-call text instead, which the native path can't parse, silently
    // producing an investigation with no evidence gathered. The fix is to detect this up front
    // (via resolveToolsSupported) and route straight to the prompted (JSON-in-text) tool-calling
    // path rather than only reacting to a specific rejection error that doesn't always occur.
    getProviderForAgentMock.mockReturnValue({ provider: 'openrouter', model: 'nousresearch/hermes-4-70b' })
    sendProviderWithToolsMock.mockResolvedValue({
      content: ['---', 'confidence: high', 'root_cause: x', 'affected_files: []', '---', '', '# Summary'].join('\n'),
      toolCalls: [],
      model: 'nousresearch/hermes-4-70b',
    })
    const { runInvestigation } = await import('../remote-edit/investigator')
    await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )
    // sendProviderWithTools is always called under the hood (native and prompted paths both use
    // it), but the prompted path always passes an empty tools array and toolChoice 'none' since
    // it encodes tool availability as system-prompt text instead of a native `tools` payload.
    const [, , , , calledTools, calledToolChoice] = sendProviderWithToolsMock.mock.calls[0]
    expect(calledTools).toEqual([])
    expect(calledToolChoice).toBe('none')
    const messages = sendProviderWithToolsMock.mock.calls[0][3] as { role: string; content: string }[]
    const systemMessage = messages.find((m) => m.role === 'system')
    expect(systemMessage?.content).toContain('You do not have native function-calling')
  })

  it('falls back to prompted tool-calling when the provider rejects native tool use, completing a multi-turn investigation', async () => {
    sendProviderWithToolsMock
      .mockRejectedValueOnce(new Error('No endpoints found that support tool use. Try disabling "read_file".'))
      .mockResolvedValueOnce({
        content: '```json\n{ "tool_calls": [ { "name": "read_file", "arguments": { "path": "package.json" } } ] }\n```',
        toolCalls: [],
        model: 'hermes-4-70b',
      })
      .mockResolvedValueOnce({
        content: [
          '---',
          'confidence: medium',
          'root_cause: dependency mismatch',
          'affected_files:',
          '  - "package.json"',
          '---',
          '',
          '# Summary',
          'Found the issue after reading package.json.',
        ].join('\n'),
        toolCalls: [],
        model: 'hermes-4-70b',
      })
    const { runInvestigation } = await import('../remote-edit/investigator')
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'done',
      confidence: 'medium',
      rootCause: 'dependency mismatch',
    }))
    expect(sendProviderWithToolsMock).toHaveBeenCalledTimes(3)
    // First call: native, throws (caught -> falls into prompted mode for this turn).
    // Second call: prompted mode's own call to sendProviderWithTools, tools always [].
    expect(sendProviderWithToolsMock.mock.calls[1][4]).toEqual([])
    expect(sendProviderWithToolsMock.mock.calls[1][5]).toBe('none')
  })

  it('degrades to a text-only answer when prompted tool-calling never yields a valid tool-call block', async () => {
    sendProviderWithToolsMock
      .mockRejectedValueOnce(new Error('No endpoints found that support tool use. Try disabling "read_file".'))
      .mockResolvedValue({
        content: [
          '---',
          'confidence: low',
          'root_cause: unknown',
          'affected_files: []',
          '---',
          '',
          '# Summary',
          'Could not use tools, answering from the log alone.',
        ].join('\n'),
        toolCalls: [],
        model: 'hermes-4-70b',
      })
    const { runInvestigation } = await import('../remote-edit/investigator')
    const result = await runInvestigation(
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as never,
      'report-1',
      { onChunk: vi.fn(), onActivity: vi.fn() },
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'done',
      confidence: 'low',
      rootCause: 'unknown',
    }))
  })
})
