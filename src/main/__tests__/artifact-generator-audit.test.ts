import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const recordProjectAuditChange = vi.fn()
  const sent: Array<{ channel: string; payload: unknown }> = []
  return { recordProjectAuditChange, sent }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/nexy-artifacts') },
}))

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 42 })),
}))

vi.mock('../project-audit', () => ({
  recordProjectAuditChange: state.recordProjectAuditChange,
}))

vi.mock('../chat-provider-dispatch', () => ({
  dispatchToProvider: vi.fn(async () => [
    '<<<FILE: docs/output.md>>>',
    '# Generated artifact',
    '<<<END_FILE>>>',
  ].join('\n')),
}))

vi.mock('../providers', () => ({
  DEFAULT_PROVIDER_MODEL: 'gpt-5-mini',
  PROVIDERS: [{ name: 'openai', models: ['gpt-5-mini'] }],
  getProviderForAgent: vi.fn(() => ({ provider: 'openai', model: 'gpt-5-mini' })),
  getApiKey: vi.fn(() => 'sk-test'),
  getProviderCredential: vi.fn(() => 'sk-test'),
  isProviderConfigured: vi.fn(() => true),
  getOpenRouterModels: vi.fn(() => []),
}))

vi.mock('../cli-detection', () => ({
  getCliModels: vi.fn(() => []),
}))

vi.mock('../cli-adapters/claude', () => ({
  ClaudeAdapter: { isAvailable: vi.fn(() => false) },
}))

vi.mock('../cli-adapters/codex', () => ({
  CodexAdapter: { isAvailable: vi.fn(() => false) },
}))

vi.mock('../cli-adapters/registry', () => ({
  getAdapter: vi.fn(() => null),
}))

vi.mock('../database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      get: (...args: unknown[]) => {
        if (sql.includes("SELECT value FROM settings WHERE key = 'artifact_storage_root'")) return { value: '/tmp/nexy-artifacts' }
        if (sql.includes('SELECT id FROM artifacts WHERE project_id = ? AND title = ?')) return undefined
        if (sql.includes('SELECT MAX(version_number) AS v FROM artifact_versions WHERE artifact_id = ?')) return { v: null }
        if (sql.includes('SELECT id FROM artifact_generator_runs WHERE id = ?')) return { id: 'run-1' }
        void args
        return undefined
      },
      all: () => [],
      run: vi.fn(),
    }),
    transaction: (fn: () => void) => () => fn(),
  }),
}))

describe('artifact generator audit', () => {
  beforeEach(() => {
    state.recordProjectAuditChange.mockReset()
    state.sent.length = 0
  })

  it('records project-scoped generated files into the audit log', async () => {
    const { runArtifactGeneration } = await import('../artifact-generator')
    const win = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => {
          state.sent.push({ channel, payload })
        },
      },
    } as never

    await runArtifactGeneration(win, 'run-1', {
      title: 'Spec packet',
      kind: 'document',
      scope: { type: 'project', projectId: 'proj-1' },
      intendedUse: 'Review',
      outputFiles: [{ path: 'docs/output.md', mediaType: 'text/markdown', role: 'primary' }],
      sourceContext: {
        useProjectInstructions: false,
        useProjectWiki: false,
        useConversationContext: false,
        referencedFiles: [],
      },
      acceptanceCriteria: [],
      exportFormats: ['markdown'],
    })

    expect(state.recordProjectAuditChange).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'artifact-generator:run-1',
      projectId: 'proj-1',
      title: 'Spec packet',
      source: 'manual-apply',
      relativePath: 'docs/output.md',
      status: 'created',
      lastOperation: 'create',
    }))
    expect(state.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: 'artifact-generator:file-event',
        payload: expect.objectContaining({ file: 'docs/output.md', status: 'done' }),
      }),
    ]))
  })
})
