import { useEffect, useState } from 'react'
import { useAppStore } from '../store/app-store'
import { Button } from './ui/primitives'
import { NexyIcon, type NexyIconName } from './ui/icons'

interface OnboardingProps {
  onComplete: () => void
}

type Step = 'welcome' | 'providers' | 'done'
type SetupMode = 'byok' | 'claude-cli' | 'codex-cli' | null

const featureRecords: Array<{ icon: NexyIconName; label: string }> = [
  { icon: 'chat', label: 'Start chatting with your configured backend' },
  { icon: 'agent', label: 'Create custom agents with unique personalities' },
  { icon: 'external', label: 'Connect MCP servers for extended capabilities' },
  { icon: 'tool', label: 'Use built-in tools (file editing, terminal, web fetch)' },
  { icon: 'check', label: 'Project Git: inspect branches, diffs, staging, commits, and remotes' },
  { icon: 'spark', label: 'Project Generator: scaffold projects, roles, and milestones from a guided prompt (sidebar)' },
  { icon: 'artifact', label: 'Artifacts: save, browse, and export reusable docs, code, prompts, and plans (sidebar)' },
]

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
      <div className="nexy-onboarding-frame w-full max-w-md overflow-hidden border-2 border-nexy-border bg-nexy-raised shadow-nexy">
        <div className="flex justify-center gap-2 pt-5">
          {(['welcome', 'providers', 'done'] as Step[]).map((s) => (
            <div
              key={s}
              className={`h-2 w-2 border border-nexy-border ${
                s === step ? 'bg-nexy-accent' : 'bg-nexy-recessed'
              }`}
            />
          ))}
        </div>

        <div className="p-8">
          {step === 'welcome' && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <NexyIcon name="spark" size={48} className="text-nexy-accent" />
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
              <Button variant="primary" onClick={() => setStep('providers')} className="w-full mt-4 justify-center text-sm">
                Get Started
              </Button>
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
                  className="w-full flex items-center gap-3 px-4 py-3 border-2 border-nexy-success bg-nexy-success/10 text-left hover:brightness-95"
                >
                  <NexyIcon name="prompt" size={20} className="text-nexy-success" />
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
                  className="w-full flex items-center gap-3 px-4 py-3 border-2 border-nexy-success bg-nexy-success/10 text-left hover:brightness-95"
                >
                  <NexyIcon name="prompt" size={20} className="text-nexy-success" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      Use Codex CLI <span className="text-xs font-normal text-green-600 dark:text-green-400">(detected)</span>
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">No API key needed — uses your local Codex login</p>
                  </div>
                </button>
              )}

              {!installedClis.claude && !installedClis.codex && (
                <div className="border-2 border-nexy-warning bg-nexy-warning/10 px-4 py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <NexyIcon name="warning" size={16} className="text-nexy-warning" />
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">No local AI CLI detected</p>
                    <button
                      onClick={handleRecheck}
                      disabled={rechecking}
                      className="ml-auto text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 flex items-center gap-1 disabled:opacity-50"
                      title="Re-check for installed CLIs"
                    >
                      <NexyIcon name={rechecking ? 'busy' : 'refresh'} size={12} />
                      Re-check
                    </button>
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mb-1">Install Codex CLI, then sign in:</p>
                    <pre className="text-xs border border-nexy-warning bg-nexy-recessed px-2 py-1 font-mono overflow-x-auto">npm install -g @openai/codex{'\n'}codex login</pre>
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mb-1">Or install Claude CLI:</p>
                    <pre className="text-xs border border-nexy-warning bg-nexy-recessed px-2 py-1 font-mono overflow-x-auto">npm install -g @anthropic-ai/claude-code</pre>
                  </div>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    After installing and signing in, click Re-check.
                  </p>
                </div>
              )}

              <button
                onClick={() => void handleByok()}
                className="w-full flex items-center gap-3 px-4 py-3 border-2 border-nexy-border bg-nexy-recessed text-left hover:bg-nexy-surface"
              >
                <NexyIcon name="key" size={20} className="text-nexy-muted" />
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
                <NexyIcon name="check" size={48} className="text-nexy-success" />
              </div>
              <h2 className="text-lg font-medium text-gray-800 dark:text-gray-100">
                You're all set!
              </h2>
              {(setupMode === 'claude-cli' || setupMode === 'codex-cli') && (
                <div className="flex items-start gap-2 p-3 bg-nexy-success/10 border-2 border-nexy-success text-left">
                  <NexyIcon name="prompt" size={16} className="text-nexy-success mt-0.5" />
                  <p className="text-xs text-green-700 dark:text-green-300">
                    Ready to chat via {setupMode === 'codex-cli' ? 'Codex CLI' : 'Claude CLI'}. You can also create agents with custom system prompts using the <strong>+</strong> in the sidebar.
                  </p>
                </div>
              )}
              {setupMode === 'byok' && (
                <div className="flex items-start gap-2 p-3 bg-nexy-info/10 border-2 border-nexy-info text-left">
                  <NexyIcon name="key" size={16} className="text-nexy-info mt-0.5" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    BYOK mode enabled. Settings is open so you can add a provider key in <strong>API Providers</strong>.
                  </p>
                </div>
              )}
              <div className="text-left space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <p>Here are some things you can do:</p>
                <ul className="space-y-1.5 ml-1">
                  {featureRecords.map((record) => (
                    <li key={record.label} className="flex items-center gap-2">
                      <NexyIcon name={record.icon} size={14} className="text-nexy-muted" />
                      {record.label}
                    </li>
                  ))}
                  <li className="flex items-center gap-2"><span className="w-3.5 text-center text-nexy-muted shrink-0 text-xs">⌨</span> Press <kbd className="px-1 py-0.5 border border-nexy-border bg-nexy-recessed text-xs font-mono">
                    {window.api.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Shift+H
                  </kbd> to toggle the app</li>
                </ul>
              </div>
              <Button variant="primary" onClick={handleFinish} className="w-full mt-2 justify-center text-sm">
                Start Using Nexy
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
