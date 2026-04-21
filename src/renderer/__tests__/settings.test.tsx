import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from '../../renderer/components/SettingsPanel'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore
}))

let mockApi: MockApi
let mockStore: ReturnType<typeof createMockAppStore>
const user = userEvent.setup()

const PROVIDERS = [
  { name: 'copilot', label: 'GitHub Copilot', models: ['default'], configured: true },
  { name: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'], configured: false },
  { name: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-20250514'], configured: true },
  { name: 'azure', label: 'Azure OpenAI', models: ['gpt-4o'], configured: false }
]

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.getSettings = vi.fn().mockResolvedValue({
    autoStart: 'false',
    default_model: 'default',
    temperature: '0.7',
    max_tokens: '4096'
  })
  mockApi.listProviders = vi.fn().mockResolvedValue(PROVIDERS)
  mockApi.getAzureEndpoint = vi.fn().mockResolvedValue(null)

  mockStore = createMockAppStore({
    showSettings: true,
    theme: 'dark'
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('SettingsPanel — General Tab', () => {
  it('set-r-1: theme toggle switches between light and dark', async () => {
    render(<SettingsPanel />)

    const themeBtn = screen.getByText('Light')
    await user.click(themeBtn)
    expect(mockStore.toggleTheme).toHaveBeenCalledTimes(1)
  })

  it('shows light mode button text when in light theme', () => {
    mockStore = createMockAppStore({ showSettings: true, theme: 'light' })
    setupStoreMock(useAppStore, mockStore)

    render(<SettingsPanel />)
    expect(screen.getByText('Dark')).toBeInTheDocument()
  })

  it('set-r-2: auto-start toggle calls setAutoStart', async () => {
    render(<SettingsPanel />)

    const autoStartBtn = screen.getByText('Start on login').closest('div')!.parentElement!.querySelector('button')!
    await user.click(autoStartBtn)

    expect(mockApi.setSetting).toHaveBeenCalledWith('autoStart', 'true')
    expect(mockApi.setAutoStart).toHaveBeenCalledWith(true)
  })

  it('set-r-9: "Configure" MCP button opens MCP panel', async () => {
    render(<SettingsPanel />)

    await user.click(screen.getByText('Configure'))
    expect(mockStore.setShowSettings).toHaveBeenCalledWith(false)
    expect(mockStore.setShowMcpPanel).toHaveBeenCalledWith(true)
  })

  it('set-r-10: close button calls setShowSettings(false)', async () => {
    render(<SettingsPanel />)

    await user.click(screen.getByLabelText('Close settings'))
    expect(mockStore.setShowSettings).toHaveBeenCalledWith(false)
  })

  it('shows active model details in general tab', () => {
    render(<SettingsPanel />)
    expect(screen.getByText('Active model')).toBeInTheDocument()
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0)
    expect(screen.getByText('GitHub Copilot')).toBeInTheDocument()
  })

  it('saves advanced settings values', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('Save advanced settings'))

    expect(mockApi.setSetting).toHaveBeenCalledWith('default_model', 'default')
    expect(mockApi.setSetting).toHaveBeenCalledWith('temperature', '0.7')
    expect(mockApi.setSetting).toHaveBeenCalledWith('max_tokens', '4096')
  })
})

describe('SettingsPanel — Providers Tab', () => {
  it('set-r-3: provider tabs render for each provider', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => {
      expect(screen.getByText('GitHub Copilot')).toBeInTheDocument()
      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
      expect(screen.getByText('Azure OpenAI')).toBeInTheDocument()
    })
  })

  it('shows configured badge for providers with keys', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => {
      expect(screen.getByText('✓ Configured')).toBeInTheDocument()
      expect(screen.getByText('Default')).toBeInTheDocument()
    })
  })

  it('set-r-4 + set-r-5: API key input accepts text and save calls setProviderKey', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => expect(screen.getByText('OpenAI')).toBeInTheDocument())

    const setKeyButtons = screen.getAllByText('Set Key')
    await user.click(setKeyButtons[0])

    const keyInput = screen.getByPlaceholderText(/Enter OpenAI API key/)
    await user.type(keyInput, 'sk-test123')

    await user.click(screen.getByText('Save Key'))
    expect(mockApi.setProviderKey).toHaveBeenCalledWith('openai', 'sk-test123')
  })

  it('set-r-6: test key calls testProviderKey and shows result', async () => {
    mockApi.testProviderKey = vi.fn().mockResolvedValue({ valid: true })

    render(<SettingsPanel />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => expect(screen.getByText('OpenAI')).toBeInTheDocument())

    const setKeyButtons = screen.getAllByText('Set Key')
    await user.click(setKeyButtons[0])

    const keyInput = screen.getByPlaceholderText(/Enter OpenAI API key/)
    await user.type(keyInput, 'sk-test-valid')

    await user.click(screen.getByText('Test'))

    await waitFor(() => {
      expect(screen.getByText('✓ API key is valid')).toBeInTheDocument()
    })
    expect(mockApi.testProviderKey).toHaveBeenCalledWith('openai', 'sk-test-valid', undefined)
  })

  it('shows error for invalid test result', async () => {
    mockApi.testProviderKey = vi.fn().mockResolvedValue({ valid: false, error: 'Invalid key' })

    render(<SettingsPanel />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => expect(screen.getByText('OpenAI')).toBeInTheDocument())

    const setKeyButtons = screen.getAllByText('Set Key')
    await user.click(setKeyButtons[0])

    const keyInput = screen.getByPlaceholderText(/Enter OpenAI API key/)
    await user.type(keyInput, 'sk-bad')
    await user.click(screen.getByText('Test'))

    await waitFor(() => {
      expect(screen.getByText('✗ Invalid key')).toBeInTheDocument()
    })
  })

  it('set-r-7: remove key calls removeProviderKey', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => expect(screen.getByText('Anthropic')).toBeInTheDocument())

    await user.click(screen.getByText('Remove'))
    expect(mockApi.removeProviderKey).toHaveBeenCalledWith('anthropic')
  })

  it('set-r-8: Azure endpoint field only shown for Azure', async () => {
    render(<SettingsPanel />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => expect(screen.getByText('Azure OpenAI')).toBeInTheDocument())

    expect(screen.queryByPlaceholderText(/Azure endpoint/)).not.toBeInTheDocument()

    const setKeyButtons = screen.getAllByText('Set Key')
    await user.click(setKeyButtons[setKeyButtons.length - 1])

    expect(screen.getByPlaceholderText(/Azure endpoint/)).toBeInTheDocument()
  })

  it('does not render when not visible', () => {
    mockStore = createMockAppStore({ showSettings: false })
    setupStoreMock(useAppStore, mockStore)

    const { container } = render(<SettingsPanel />)
    expect(container.innerHTML).toBe('')
  })
})
