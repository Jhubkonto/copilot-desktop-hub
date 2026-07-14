import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from '../../renderer/components/SettingsPanel'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({ useAppStore }))

let mockApi: MockApi
let mockStore: ReturnType<typeof createMockAppStore>
const user = userEvent.setup()

const PROVIDERS = [
  { name: 'openai', label: 'OpenAI', models: ['gpt-5-mini', 'gpt-4o'], configured: true },
  { name: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-20250514'], configured: true },
  { name: 'azure', label: 'Azure OpenAI', models: ['azure:gpt-4o'], configured: false },
]

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.getSettings = vi.fn().mockResolvedValue({
    autoStart: 'false',
    default_model: 'gpt-5-mini',
    temperature: '0.7',
    max_tokens: '4096',
  })
  mockApi.listProviders = vi.fn().mockResolvedValue(PROVIDERS)
  mockApi.getAzureEndpoint = vi.fn().mockResolvedValue(null)

  mockStore = createMockAppStore({
    showSettings: true,
    theme: 'dark',
    globalDefaultModel: 'gpt-5-mini',
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('SettingsPanel', () => {
  it('shows active model details in general tab', async () => {
    render(<SettingsPanel />)

    expect(screen.getByText('Active model')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('OpenAI')).toBeInTheDocument())
  })

  it('opens the providers tab with BYOK providers', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => {
      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
      expect(screen.getByText('Azure OpenAI')).toBeInTheDocument()
    })
  })

  it('saves advanced settings values', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('Save advanced settings'))

    expect(mockApi.setSetting).toHaveBeenCalledWith('default_model', 'gpt-5-mini')
    expect(mockApi.setSetting).toHaveBeenCalledWith('temperature', '0.7')
    expect(mockApi.setSetting).toHaveBeenCalledWith('max_tokens', '4096')
  })

  it('starts a dedicated code-change conversation from a failed desktop build', async () => {
    mockApi.buildGetRecords = vi.fn().mockResolvedValue([
      {
        id: 'build-failed-1',
        workspacePath: 'C:\\project',
        commitSha: 'abc1234',
        branch: 'main',
        version: '0.9.0',
        versionCode: null,
        platform: 'win32',
        command: 'typecheck',
        status: 'failed',
        exitCode: 2,
        artifactPaths: [],
        artifactChecksums: {},
        logTail: 'src/app.ts(1,1): error TS1005: expected',
        startedAt: 1000,
        finishedAt: 3000,
      },
    ])
    mockStore = createMockAppStore({
      showSettings: true,
      theme: 'dark',
      globalDefaultModel: 'gpt-5-mini',
      projectConfigs: { 'project-1': { rootDirectory: 'C:\\project' } } as unknown as ReturnType<typeof createMockAppStore>['projectConfigs'],
    })
    setupStoreMock(useAppStore, mockStore)

    render(<SettingsPanel />)
    await user.click(screen.getByText('Developer'))
    await user.click(await screen.findByText('Create code change'))

    await waitFor(() => {
      expect(mockStore.newChat).toHaveBeenCalledWith({ projectId: 'project-1' })
      expect(mockStore.setPendingComposerPrefill).toHaveBeenCalledWith(
        expect.stringContaining('/code-change Build failed: typecheck'),
      )
    })
    expect(mockStore.setShowSettings).toHaveBeenCalledWith(false)
  })

  it('shows a toast instead of navigating when the build workspace is not linked to a project', async () => {
    mockApi.buildGetRecords = vi.fn().mockResolvedValue([
      {
        id: 'build-failed-1',
        workspacePath: 'C:\\unlinked',
        commitSha: 'abc1234',
        branch: 'main',
        version: '0.9.0',
        versionCode: null,
        platform: 'win32',
        command: 'typecheck',
        status: 'failed',
        exitCode: 2,
        artifactPaths: [],
        artifactChecksums: {},
        logTail: 'src/app.ts(1,1): error TS1005: expected',
        startedAt: 1000,
        finishedAt: 3000,
      },
    ])

    render(<SettingsPanel />)
    await user.click(screen.getByText('Developer'))
    await user.click(await screen.findByText('Create code change'))

    await waitFor(() => {
      expect(mockStore.addToast).toHaveBeenCalledWith(
        expect.stringContaining("isn't linked to a known project"),
        'error',
      )
    })
    expect(mockStore.setPendingComposerPrefill).not.toHaveBeenCalled()
  })
})
