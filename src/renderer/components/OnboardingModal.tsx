import { useState, useEffect } from 'react'

interface OnboardingProps {
  onComplete: () => void
}

type Step = 'welcome' | 'auth' | 'cli' | 'done'

export function OnboardingModal({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome')
  const [authState, setAuthState] = useState<{
    authenticated: boolean
    user: { login: string; avatar_url: string } | null
  }>({ authenticated: false, user: null })
  const [cliState, setCliState] = useState<{
    installed: boolean
    version: string | null
  } | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  useEffect(() => {
    window.api.authStatus().then(setAuthState)
    window.api.cliStatus().then(setCliState)
  }, [])

  const handleLogin = async () => {
    setLoggingIn(true)
    const result = await window.api.authLogin()
    if (result.success) {
      setAuthState({ authenticated: true, user: result.user ?? null })
    }
    setLoggingIn(false)
  }

  const handleFinish = async () => {
    await window.api.setSetting('onboarding_complete', 'true')
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-5">
          {(['welcome', 'auth', 'cli', 'done'] as Step[]).map((s) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s === step ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            />
          ))}
        </div>

        <div className="p-8">
          {step === 'welcome' && (
            <div className="text-center space-y-4">
              <div className="text-5xl">🚀</div>
              <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
                Welcome to Copilot Desktop Hub
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                A native desktop experience for GitHub Copilot with custom agents, MCP servers,
                and powerful tools.
              </p>
              <button
                onClick={() => setStep('auth')}
                className="w-full mt-4 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Get Started
              </button>
            </div>
          )}

          {step === 'auth' && (
            <div className="text-center space-y-4">
              <div className="text-5xl">🔐</div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
                Sign in with GitHub
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Connect your GitHub account to use Copilot. You can also use BYOK API keys
                later in Settings.
              </p>

              {authState.authenticated ? (
                <div className="flex items-center justify-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <span className="text-green-600 text-lg">✓</span>
                  <span className="text-sm text-green-700 dark:text-green-300">
                    Signed in as <strong>{authState.user?.login}</strong>
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleLogin}
                  disabled={loggingIn}
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {loggingIn ? 'Waiting for browser...' : '🔑 Sign in with GitHub'}
                </button>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep('welcome')}
                  className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('cli')}
                  className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium"
                >
                  {authState.authenticated ? 'Continue' : 'Skip for now'}
                </button>
              </div>
            </div>
          )}

          {step === 'cli' && (
            <div className="text-center space-y-4">
              <div className="text-5xl">🖥️</div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
                Copilot CLI Check
              </h2>

              {cliState?.installed ? (
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-700 dark:text-green-300">
                    ✓ Copilot CLI detected
                    {cliState.version && (
                      <span className="text-xs opacity-75"> (v{cliState.version})</span>
                    )}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      ⚠ Copilot CLI not found
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">
                    The Copilot SDK requires the CLI. Install it with:
                  </p>
                  <code className="block text-xs px-3 py-2 rounded bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300">
                    npm install -g @githubnext/github-copilot-cli
                  </code>
                  <p className="text-xs text-gray-400">
                    You can still use BYOK providers (OpenAI, Anthropic) without the CLI.
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep('auth')}
                  className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('done')}
                  className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center space-y-4">
              <div className="text-5xl">✨</div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
                You're all set!
              </h2>
              <div className="text-left space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <p>Here are some things you can do:</p>
                <ul className="space-y-1.5 ml-1">
                  <li>💬 Start chatting with Copilot</li>
                  <li>🤖 Create custom agents with unique personalities</li>
                  <li>🔌 Connect MCP servers for extended capabilities</li>
                  <li>🛠️ Use built-in tools (file editing, terminal, web fetch)</li>
                  <li>⌨️ Press <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono">
                    {process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Shift+H
                  </kbd> to toggle the app</li>
                </ul>
              </div>
              <button
                onClick={handleFinish}
                className="w-full mt-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Start Using Copilot Desktop Hub
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
