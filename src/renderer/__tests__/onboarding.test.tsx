import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingModal } from '../../renderer/components/OnboardingModal'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { useAppStore } from '../../renderer/store/app-store'

let mockApi: MockApi
const user = userEvent.setup()
const initialState = useAppStore.getState()

beforeEach(() => {
  mockApi = setupMockApi()
  useAppStore.setState(initialState, true)
})

describe('OnboardingModal', () => {
  it('renders welcome screen with Get Started button', async () => {
    await act(async () => { render(<OnboardingModal onComplete={vi.fn()} />) })

    expect(screen.getByText('Welcome to Nexy')).toBeInTheDocument()
    expect(screen.getByText('Get Started')).toBeInTheDocument()
  })

  it('navigates to provider setup on Get Started click', async () => {
    await act(async () => { render(<OnboardingModal onComplete={vi.fn()} />) })

    await user.click(screen.getByText('Get Started'))

    expect(screen.getByRole('heading', { name: 'Choose your setup' })).toBeInTheDocument()
    expect(screen.getByText(/Add an API key/)).toBeInTheDocument()
  })

  it('shows CLI not-detected warning when CLI not available', async () => {
    mockApi.authStatus.mockResolvedValue({ authenticated: false, mode: 'none', user: null, cliInstalled: false, clis: { claude: false, codex: false } })

    await act(async () => { render(<OnboardingModal onComplete={vi.fn()} />) })
    await act(async () => { await user.click(screen.getByText('Get Started')) })

    expect(screen.getByText(/No local AI CLI detected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Re-check/ })).toBeInTheDocument()
    expect(screen.getByText(/npm install -g @openai\/codex/)).toBeInTheDocument()
    expect(screen.getByText(/codex login/)).toBeInTheDocument()
    expect(screen.getByText(/npm install -g @anthropic-ai\/claude-code/)).toBeInTheDocument()
  })

  it('shows Use Claude CLI button when CLI is installed', async () => {
    mockApi.authStatus.mockResolvedValue({ authenticated: false, mode: 'none', user: null, cliInstalled: true, clis: { claude: true, codex: false } })

    await act(async () => { render(<OnboardingModal onComplete={vi.fn()} />) })
    await act(async () => { await user.click(screen.getByText('Get Started')) })

    expect(screen.getByText(/Use Claude CLI/)).toBeInTheDocument()
    expect(screen.queryByText(/No local AI CLI detected/)).not.toBeInTheDocument()
  })

  it('shows Use Codex CLI button when Codex CLI is installed', async () => {
    mockApi.authStatus.mockResolvedValue({ authenticated: false, mode: 'none', user: null, cliInstalled: true, clis: { claude: false, codex: true } })

    await act(async () => { render(<OnboardingModal onComplete={vi.fn()} />) })
    await act(async () => { await user.click(screen.getByText('Get Started')) })

    expect(screen.getByText(/Use Codex CLI/)).toBeInTheDocument()
    expect(screen.queryByText(/No local AI CLI detected/)).not.toBeInTheDocument()
  })

  it('enables BYOK mode via store loginByok', async () => {
    mockApi.authLoginByok.mockResolvedValue({ success: true })

    await act(async () => { render(<OnboardingModal onComplete={vi.fn()} />) })

    await user.click(screen.getByText('Get Started'))
    await act(async () => { await user.click(screen.getByRole('button', { name: /Add an API key/ })) })

    expect(mockApi.authLoginByok).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/BYOK mode enabled/)).toBeInTheDocument()
    expect(useAppStore.getState().showSettings).toBe(true)
  })

  it('back button returns to welcome step', async () => {
    await act(async () => { render(<OnboardingModal onComplete={vi.fn()} />) })

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByText('← Back'))

    expect(screen.getByText('Welcome to Nexy')).toBeInTheDocument()
  })

  it('finish button saves onboarding_complete and calls onComplete', async () => {
    const onComplete = vi.fn()
    mockApi.authLoginByok.mockResolvedValue({ success: true })

    await act(async () => { render(<OnboardingModal onComplete={onComplete} />) })

    await user.click(screen.getByText('Get Started'))
    await act(async () => { await user.click(screen.getByRole('button', { name: /Add an API key/ })) })
    await user.click(screen.getByText('Start Using Nexy'))

    expect(mockApi.setSetting).toHaveBeenCalledWith('onboarding_complete', 'true')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
