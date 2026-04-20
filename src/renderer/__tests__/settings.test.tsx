import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from '../../renderer/components/SettingsPanel'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi
const user = userEvent.setup()

const PROVIDERS = [
  { name: 'copilot', label: 'GitHub Copilot', models: ['default'], configured: true },
  { name: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'], configured: false },
  { name: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-20250514'], configured: true },
  { name: 'azure', label: 'Azure OpenAI', models: ['gpt-4o'], configured: false }
]

const defaultProps = {
  visible: true,
  onClose: vi.fn(),
  theme: 'dark' as const,
  toggleTheme: vi.fn(),
  onOpenMcp: vi.fn()
}

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.getSettings = vi.fn().mockResolvedValue({ autoStart: 'false' })
  mockApi.listProviders = vi.fn().mockResolvedValue(PROVIDERS)
  mockApi.getAzureEndpoint = vi.fn().mockResolvedValue(null)
})

describe('SettingsPanel — General Tab', () => {
  it('set-r-1: theme toggle switches between light and dark', async () => {
    const toggleTheme = vi.fn()
    render(<SettingsPanel {...defaultProps} toggleTheme={toggleTheme} />)

    const themeBtn = screen.getByText('☀️ Light')
    await user.click(themeBtn)
    expect(toggleTheme).toHaveBeenCalledTimes(1)
  })

  it('shows light mode button text when in light theme', () => {
    render(<SettingsPanel {...defaultProps} theme="light" />)
    expect(screen.getByText('🌙 Dark')).toBeInTheDocument()
  })

  it('set-r-2: auto-start toggle calls setAutoStart', async () => {
    render(<SettingsPanel {...defaultProps} />)

    // Click the auto-start toggle button
    const autoStartBtn = screen.getByText('Start on login').closest('div')!.parentElement!.querySelector('button')!
    await user.click(autoStartBtn)

    expect(mockApi.setSetting).toHaveBeenCalledWith('autoStart', 'true')
    expect(mockApi.setAutoStart).toHaveBeenCalledWith(true)
  })

  it('set-r-9: "Configure" MCP button calls onOpenMcp', async () => {
    const onOpenMcp = vi.fn()
    render(<SettingsPanel {...defaultProps} onOpenMcp={onOpenMcp} />)

    await user.click(screen.getByText('🔌 Configure'))
    expect(onOpenMcp).toHaveBeenCalledTimes(1)
  })

  it('set-r-10: close button calls onClose', async () => {
    const onClose = vi.fn()
    render(<SettingsPanel {...defaultProps} onClose={onClose} />)

    await user.click(screen.getByLabelText('Close settings'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('SettingsPanel — Providers Tab', () => {
  it('set-r-3: provider tabs render for each provider', async () => {
    render(<SettingsPanel {...defaultProps} />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => {
      expect(screen.getByText('GitHub Copilot')).toBeInTheDocument()
      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
      expect(screen.getByText('Azure OpenAI')).toBeInTheDocument()
    })
  })

  it('shows configured badge for providers with keys', async () => {
    render(<SettingsPanel {...defaultProps} />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => {
      expect(screen.getByText('✓ Configured')).toBeInTheDocument()
      expect(screen.getByText('Default')).toBeInTheDocument()
    })
  })

  it('set-r-4 + set-r-5: API key input accepts text and save calls setProviderKey', async () => {
    render(<SettingsPanel {...defaultProps} />)
    await user.click(screen.getByText('API Providers'))

    // Wait for providers to render
    await waitFor(() => expect(screen.getByText('OpenAI')).toBeInTheDocument())

    // Click "Set Key" on OpenAI
    const setKeyButtons = screen.getAllByText('Set Key')
    await user.click(setKeyButtons[0]) // OpenAI is first non-copilot provider

    // Type API key
    const keyInput = screen.getByPlaceholderText(/Enter OpenAI API key/)
    await user.type(keyInput, 'sk-test123')

    // Save
    await user.click(screen.getByText('Save Key'))
    expect(mockApi.setProviderKey).toHaveBeenCalledWith('openai', 'sk-test123')
  })

  it('set-r-6: test key calls testProviderKey and shows result', async () => {
    mockApi.testProviderKey = vi.fn().mockResolvedValue({ valid: true })

    render(<SettingsPanel {...defaultProps} />)
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

    render(<SettingsPanel {...defaultProps} />)
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
    render(<SettingsPanel {...defaultProps} />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => expect(screen.getByText('Anthropic')).toBeInTheDocument())

    // Anthropic is configured, should have a Remove button
    await user.click(screen.getByText('Remove'))
    expect(mockApi.removeProviderKey).toHaveBeenCalledWith('anthropic')
  })

  it('set-r-8: Azure endpoint field only shown for Azure', async () => {
    render(<SettingsPanel {...defaultProps} />)
    await user.click(screen.getByText('API Providers'))

    await waitFor(() => expect(screen.getByText('Azure OpenAI')).toBeInTheDocument())

    // Before clicking Set Key on Azure, no endpoint field
    expect(screen.queryByPlaceholderText(/Azure endpoint/)).not.toBeInTheDocument()

    // Click Set Key on Azure (last Set Key button)
    const setKeyButtons = screen.getAllByText('Set Key')
    await user.click(setKeyButtons[setKeyButtons.length - 1])

    // Now Azure endpoint field should be visible
    expect(screen.getByPlaceholderText(/Azure endpoint/)).toBeInTheDocument()
  })

  it('does not render when not visible', () => {
    const { container } = render(<SettingsPanel {...defaultProps} visible={false} />)
    expect(container.innerHTML).toBe('')
  })
})
