import { useEffect, useState } from 'react'
import { Sparkles, CheckCircle, MessageSquare, Bot, Plug, Wrench, Key, Terminal, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store/app-store'

interface OnboardingProps {
  onComplete: () => void
}

type Step = 'welcome' | 'providers' | 'done'
type SetupMode = 'byok' | 'claude-cli' | 'codex-cli' | null

export function OnboardingModal({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome')
  const [setupMode, setSetupMode] = useState<SetupMode>(null)
  const [installedClis, setInstalledClis] = useState({ claude: false, codex: false })
  const [rechecking, setRechecking] = useState(false)
  const loginByok = useAppStore((s) => s.loginByok)
  const checkAuth = useAppStore((s) => s.checkAuth)
  const setShowSettings = useAppStore((s) => s.setShowSettings)

  useEffect(() => {
    void window.api.authStatus().then((result) => {
      setInstalledClis(result.clis ?? { claude: result.cliInstalled ?? false, codex: false })
    })
  }, [])

  const handleByok = async () => {
    await loginByok()
    await checkAuth()
    setShowSettings(true)
    setSetupMode('byok')
    setStep('done')
  }

  const handleUseCli = (mode: 'claude-cli' | 'codex-cli') => {
    setSetupMode(mode)
    setStep('done')
  }

  const handleRecheck = async () => {
    setRechecking(true)
    try {
      const result = await window.api.authStatus()
      setInstalledClis(result.clis ?? { claude: result.cliInstalled ?? false, codex: false })
      await checkAuth()
    } finally {
      setRechecking(false)
    }
  }

  const handleFinish = async () => {
    await window.api.setSetting('onboarding_complete', 'true')
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Welcome setup">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex justify-center gap-2 pt-5">
          {(['welcome', 'providers', 'done'] as Step[]).map((s) => (
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
                Welcome to Nexy
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                A native desktop workspace for chat, custom agents, MCP servers, and built-in tools.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Let's get you set up with an AI backend.
              </p>
              <button
                onClick={() => setStep('providers')}
                className="w-full mt-4 px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
              >
                Get Started
              </button>
            </div>
          )}

          {step === 'providers' && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-lg font-medium text-gray-800 dark:text-gray-100">
                  Choose your setup
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  How would you like to use the app?
                </p>
              </div>

              {installedClis.claude && (
                <button
                  onClick={() => handleUseCli('claude-cli')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-left hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                >
                  <Terminal className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      Use Claude CLI <span className="text-xs font-normal text-green-600 dark:text-green-400">(detected)</span>
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">No API key needed — uses your local CLI session</p>
                  </div>
                </button>
              )}

              {installedClis.codex && (
                <button
                  onClick={() => handleUseCli('codex-cli')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-left hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                >
                  <Terminal className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      Use Codex CLI <span className="text-xs font-normal text-green-600 dark:text-green-400">(detected)</span>
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">No API key needed — uses your local Codex login</p>
                  </div>
                </button>
              )}

              {!installedClis.claude && !installedClis.codex && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">No local AI CLI detected</p>
                    <button
                      onClick={handleRecheck}
                      disabled={rechecking}
                      className="ml-auto text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 flex items-center gap-1 disabled:opacity-50"
                      title="Re-check for installed CLIs"
                    >
                      <RefreshCw className={`w-3 h-3 ${rechecking ? 'animate-spin' : ''}`} />
                      Re-check
                    </button>
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mb-1">Install Codex CLI, then sign in:</p>
                    <pre className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 rounded px-2 py-1 font-mono overflow-x-auto">npm install -g @openai/codex{'\n'}codex login</pre>
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mb-1">Or install Claude CLI:</p>
                    <pre className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 rounded px-2 py-1 font-mono overflow-x-auto">npm install -g @anthropic-ai/claude-code</pre>
                  </div>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    After installing and signing in, click Re-check.
                  </p>
                </div>
              )}

              <button
                onClick={() => void handleByok()}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <Key className="w-5 h-5 text-gray-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Add an API key</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Opens Settings → API Providers so you can paste a provider key</p>
                </div>
              </button>

              <button
                onClick={() => setStep('welcome')}
                className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-center"
              >
                ← Back
              </button>
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
              {(setupMode === 'claude-cli' || setupMode === 'codex-cli') && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-left">
                  <Terminal className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-green-700 dark:text-green-300">
                    Ready to chat via {setupMode === 'codex-cli' ? 'Codex CLI' : 'Claude CLI'}. You can also create agents with custom system prompts using the <strong>+</strong> in the sidebar.
                  </p>
                </div>
              )}
              {setupMode === 'byok' && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-left">
                  <Key className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    BYOK mode enabled. Settings is open so you can add a provider key in <strong>API Providers</strong>.
                  </p>
                </div>
              )}
              <div className="text-left space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <p>Here are some things you can do:</p>
                <ul className="space-y-1.5 ml-1">
                  <li className="flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5 text-gray-400 shrink-0" /> Start chatting with your configured backend</li>
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
                Start Using Nexy
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
