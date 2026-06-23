import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'

const { sendProviderWithToolsMock } = vi.hoisted(() => ({
  sendProviderWithToolsMock: vi.fn(),
}))

vi.mock('../providers', () => ({
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-5-mini' })),
  getApiKey: vi.fn(() => 'sk-test'),
  sendProviderWithTools: sendProviderWithToolsMock,
}))

vi.mock('../ws-server', () => ({
  broadcastToMobile: vi.fn(),
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
    expect(row).toEqual(expect.objectContaining({
      status: 'investigated',
      investigation_root_cause: 'missing guard',
    }))
    expect(String(row.investigation_markdown)).toContain('confidence: high')
  })

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
