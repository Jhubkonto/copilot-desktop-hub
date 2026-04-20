import { useState, useEffect } from 'react'
import { Sparkles, Shield, CheckCircle, MessageSquare, Bot, Plug, Wrench } from 'lucide-react'

interface OnboardingProps {
  onComplete: () => void
}

type Step = 'welcome' | 'auth' | 'done'

export function OnboardingModal({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome')
  const [authState, setAuthState] = useState<{
    authenticated: boolean
    user: { login: string; avatar_url: string } | null
  }>({ authenticated: false, user: null })
  const [loggingIn, setLoggingIn] = useState(false)

  useEffect(() => {
    window.api.authStatus().then(setAuthState)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Welcome setup">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-5">
          {(['welcome', 'auth', 'done'] as Step[]).map((s) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s === step ? 'bg-gray-900 dark:bg-gray-100' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            />
          ))}
        </div>

        <div className="p-8">
          {step === 'welcome' && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Sparkles className="w-12 h-12 text-gray-400" />
              </div>
              <h1 className="text-xl font-medium text-gray-800 dark:text-gray-100">
                Welcome to Copilot Desktop Hub
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                A native desktop experience for GitHub Copilot with custom agents, MCP servers,
                and powerful tools.
              </p>
              <button
                onClick={() => setStep('auth')}
                className="w-full mt-4 px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
              >
                Get Started
              </button>
            </div>
          )}

          {step === 'auth' && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Shield className="w-12 h-12 text-gray-400" />
              </div>
              <h2 className="text-lg font-medium text-gray-800 dark:text-gray-100">
                Sign in with GitHub
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Connect your GitHub account to use Copilot. You can also use BYOK API keys
                later in Settings.
              </p>

              {authState.authenticated ? (
                <div className="flex items-center justify-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                  <CheckCircle className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  <span className="text-sm text-gray-700 dark:text-gray-200">
                    Signed in as <strong>{authState.user?.login}</strong>
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleLogin}
                  disabled={loggingIn}
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {loggingIn ? 'Waiting for browser...' : 'Sign in with GitHub'}
                </button>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setStep('welcome')}
                  className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('done')}
                  className="flex-1 text-xs px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                >
                  {authState.authenticated ? 'Continue' : 'Skip for now'}
                </button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle className="w-12 h-12 text-gray-400" />
              </div>
              <h2 className="text-lg font-medium text-gray-800 dark:text-gray-100">
                You're all set!
              </h2>
              <div className="text-left space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <p>Here are some things you can do:</p>
                <ul className="space-y-1.5 ml-1">
                  <li className="flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5 text-gray-400 shrink-0" /> Start chatting with Copilot</li>
                  <li className="flex items-center gap-2"><Bot className="w-3.5 h-3.5 text-gray-400 shrink-0" /> Create custom agents with unique personalities</li>
                  <li className="flex items-center gap-2"><Plug className="w-3.5 h-3.5 text-gray-400 shrink-0" /> Connect MCP servers for extended capabilities</li>
                  <li className="flex items-center gap-2"><Wrench className="w-3.5 h-3.5 text-gray-400 shrink-0" /> Use built-in tools (file editing, terminal, web fetch)</li>
                  <li className="flex items-center gap-2"><span className="w-3.5 text-center text-gray-400 shrink-0 text-xs">⌨</span> Press <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono">
                    {window.api.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Shift+H
                  </kbd> to toggle the app</li>
                </ul>
              </div>
              <button
                onClick={handleFinish}
                className="w-full mt-2 px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
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
