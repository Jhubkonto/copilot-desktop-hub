import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingModal } from '../../renderer/components/OnboardingModal'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi
const user = userEvent.setup()

beforeEach(() => {
  mockApi = setupMockApi()
  mockApi.authStatus = vi.fn().mockResolvedValue({ authenticated: false, user: null })
  mockApi.cliStatus = vi.fn().mockResolvedValue({ installed: false, version: null })
})

describe('OnboardingModal — Welcome Step', () => {
  it('renders welcome screen with Get Started button', () => {
    render(<OnboardingModal onComplete={vi.fn()} />)

    expect(screen.getByText('Welcome to Copilot Desktop Hub')).toBeInTheDocument()
    expect(screen.getByText('Get Started')).toBeInTheDocument()
  })

  it('navigates to auth step on Get Started click', async () => {
    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    expect(screen.getByRole('heading', { name: 'Sign in with GitHub' })).toBeInTheDocument()
  })
})

describe('OnboardingModal — Auth Step', () => {
  it('shows sign-in button when not authenticated', async () => {
    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument()
    expect(screen.getByText('Skip for now')).toBeInTheDocument()
  })

  it('shows authenticated state when already signed in', async () => {
    mockApi.authStatus = vi.fn().mockResolvedValue({
      authenticated: true,
      user: { login: 'testuser', avatar_url: 'https://example.com/avatar.png' }
    })

    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    await waitFor(() => {
      expect(screen.getByText(/Signed in as/)).toBeInTheDocument()
      expect(screen.getByText('testuser')).toBeInTheDocument()
    })
    // Button changes from "Skip for now" to "Continue"
    expect(screen.getByText('Continue')).toBeInTheDocument()
  })

  it('calls authLogin when sign-in button clicked', async () => {
    mockApi.authLogin = vi.fn().mockResolvedValue({
      success: true,
      user: { login: 'newuser', avatar_url: '' }
    })

    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByRole('button', { name: 'Sign in with GitHub' }))

    expect(mockApi.authLogin).toHaveBeenCalledTimes(1)
  })

  it('shows waiting state during login', async () => {
    // Make authLogin hang so we can check the loading state
    let resolveLogin: (v: unknown) => void
    mockApi.authLogin = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveLogin = resolve })
    )

    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByRole('button', { name: 'Sign in with GitHub' }))

    expect(screen.getByText('Waiting for browser...')).toBeInTheDocument()

    // Resolve to clean up
    resolveLogin!({ success: true, user: { login: 'test', avatar_url: '' } })
  })

  it('back button returns to welcome step', async () => {
    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    expect(screen.getByRole('heading', { name: 'Sign in with GitHub' })).toBeInTheDocument()

    await user.click(screen.getByText('Back'))
    expect(screen.getByText('Welcome to Copilot Desktop Hub')).toBeInTheDocument()
  })

  it('skip button navigates to CLI step', async () => {
    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByText('Skip for now'))

    expect(screen.getByText('Copilot CLI Check')).toBeInTheDocument()
  })
})

describe('OnboardingModal — CLI Step', () => {
  it('shows CLI detected when installed', async () => {
    mockApi.cliStatus = vi.fn().mockResolvedValue({ installed: true, version: '1.2.3' })

    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByText('Skip for now'))

    await waitFor(() => {
      expect(screen.getByText(/Copilot CLI detected/)).toBeInTheDocument()
      expect(screen.getByText(/v1.2.3/)).toBeInTheDocument()
    })
  })

  it('shows CLI not found warning when not installed', async () => {
    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByText('Skip for now'))

    await waitFor(() => {
      expect(screen.getByText(/Copilot CLI not found/)).toBeInTheDocument()
    })
  })

  it('back button returns to auth step', async () => {
    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByText('Skip for now'))
    await user.click(screen.getByText('Back'))

    expect(screen.getByRole('heading', { name: 'Sign in with GitHub' })).toBeInTheDocument()
  })

  it('continue button navigates to done step', async () => {
    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByText('Skip for now'))
    await user.click(screen.getByText('Continue'))

    expect(screen.getByText("You're all set!")).toBeInTheDocument()
  })
})

describe('OnboardingModal — Done Step', () => {
  it('shows completion message with feature list', async () => {
    render(<OnboardingModal onComplete={vi.fn()} />)

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByText('Skip for now'))
    await user.click(screen.getByText('Continue'))

    expect(screen.getByText("You're all set!")).toBeInTheDocument()
    expect(screen.getByText(/Start chatting with Copilot/)).toBeInTheDocument()
    expect(screen.getByText(/Create custom agents/)).toBeInTheDocument()
  })

  it('finish button saves onboarding_complete and calls onComplete', async () => {
    const onComplete = vi.fn()
    render(<OnboardingModal onComplete={onComplete} />)

    await user.click(screen.getByText('Get Started'))
    await user.click(screen.getByText('Skip for now'))
    await user.click(screen.getByText('Continue'))
    await user.click(screen.getByText('Start Using Copilot Desktop Hub'))

    expect(mockApi.setSetting).toHaveBeenCalledWith('onboarding_complete', 'true')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('progress dots show correct active step', async () => {
    const { container } = render(<OnboardingModal onComplete={vi.fn()} />)

    // On welcome step, first dot should be active (dark gray primary)
    const dots = container.querySelectorAll('.rounded-full')
    expect(dots[0].className).toContain('bg-gray-900')
    expect(dots[1].className).not.toContain('bg-gray-900')
  })
})
