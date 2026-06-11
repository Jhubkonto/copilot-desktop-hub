import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../database', () => ({ getDatabase: vi.fn() }))

const { safeHandleMock, isAvailableClaude, isAvailableCodex, getCliModelsMock, isProviderConfiguredMock } = vi.hoisted(() => ({
  safeHandleMock: vi.fn(),
  isAvailableClaude: vi.fn(),
  isAvailableCodex: vi.fn(),
  getCliModelsMock: vi.fn(),
  isProviderConfiguredMock: vi.fn(),
}))

vi.mock('../safe-handle', () => ({ safeHandle: safeHandleMock }))
vi.mock('../cli-adapters/claude', () => ({ ClaudeAdapter: { isAvailable: isAvailableClaude } }))
vi.mock('../cli-adapters/codex', () => ({ CodexAdapter: { isAvailable: isAvailableCodex } }))
vi.mock('../cli-detection', () => ({ getCliModels: getCliModelsMock }))
vi.mock('../providers', () => ({
  PROVIDERS: [
    { name: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-6', 'claude-opus-4-8'] },
    { name: 'openai',    label: 'OpenAI',    models: ['gpt-5.5', 'gpt-5.4'] },
    { name: 'azure',     label: 'Azure OpenAI', models: ['gpt-4o'] },
  ],
  isProviderConfigured: isProviderConfiguredMock,
}))

import { getAvailableModelGroups, registerModelAvailabilityHandlers } from '../model-availability'

afterEach(() => {
  isAvailableClaude.mockReset()
  isAvailableCodex.mockReset()
  getCliModelsMock.mockReset()
  isProviderConfiguredMock.mockReset()
  safeHandleMock.mockReset()
})

describe('getAvailableModelGroups', () => {
  beforeEach(() => {
    isAvailableClaude.mockReturnValue(false)
    isAvailableCodex.mockReturnValue(false)
    isProviderConfiguredMock.mockReturnValue(false)
  })

  it('returns empty array when nothing is configured', () => {
    expect(getAvailableModelGroups()).toEqual([])
  })

  it('returns one CLI group for Claude CLI only', () => {
    isAvailableClaude.mockReturnValue(true)
    getCliModelsMock.mockReturnValue([{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])
    const groups = getAvailableModelGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].sourceKey).toBe('claude-cli')
    expect(groups[0].sourceType).toBe('cli')
    expect(groups[0].sourceLabel).toBe('Claude CLI')
  })

  it('returns one CLI group for Codex CLI only', () => {
    isAvailableCodex.mockReturnValue(true)
    getCliModelsMock.mockReturnValue([{ id: 'gpt-5.5', label: 'GPT-5.5' }])
    const groups = getAvailableModelGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].sourceKey).toBe('codex-cli')
    expect(groups[0].sourceType).toBe('cli')
  })

  it('returns two CLI groups when both CLIs available, claude first', () => {
    isAvailableClaude.mockReturnValue(true)
    isAvailableCodex.mockReturnValue(true)
    getCliModelsMock.mockImplementation((backend: string) =>
      backend === 'claude-cli'
        ? [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }]
        : [{ id: 'gpt-5.5', label: 'GPT-5.5' }]
    )
    const groups = getAvailableModelGroups()
    expect(groups).toHaveLength(2)
    expect(groups[0].sourceKey).toBe('claude-cli')
    expect(groups[1].sourceKey).toBe('codex-cli')
  })

  it('returns one provider group when a single provider is configured', () => {
    isProviderConfiguredMock.mockImplementation((name: string) => name === 'anthropic')
    const groups = getAvailableModelGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].sourceKey).toBe('anthropic')
    expect(groups[0].sourceType).toBe('provider')
    expect(groups[0].sourceLabel).toBe('Anthropic')
  })

  it('prefixes azure model IDs with azure:', () => {
    isProviderConfiguredMock.mockImplementation((name: string) => name === 'azure')
    const groups = getAvailableModelGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].models[0].id).toBe('azure:gpt-4o')
  })

  it('returns CLI groups before provider groups', () => {
    isAvailableClaude.mockReturnValue(true)
    isAvailableCodex.mockReturnValue(true)
    isProviderConfiguredMock.mockImplementation((name: string) => name === 'anthropic' || name === 'openai')
    getCliModelsMock.mockReturnValue([{ id: 'model-x', label: 'Model X' }])
    const groups = getAvailableModelGroups()
    expect(groups).toHaveLength(4)
    expect(groups[0].sourceKey).toBe('claude-cli')
    expect(groups[1].sourceKey).toBe('codex-cli')
    expect(groups[2].sourceKey).toBe('anthropic')
    expect(groups[3].sourceKey).toBe('openai')
  })

  it('excludes CLI groups with no models', () => {
    isAvailableClaude.mockReturnValue(true)
    getCliModelsMock.mockReturnValue([])
    expect(getAvailableModelGroups()).toEqual([])
  })
})

describe('registerModelAvailabilityHandlers', () => {
  it('registers the model:list-available IPC channel', () => {
    registerModelAvailabilityHandlers()
    expect(safeHandleMock).toHaveBeenCalledWith('model:list-available', expect.any(Function))
  })
})
