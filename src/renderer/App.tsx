import { useEffect, lazy, Suspense } from 'react'
import { Settings } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { ToolApproval } from './components/ToolApproval'
import { ToastContainer } from './components/Toast'
import { useAppStore } from './store/app-store'

const AgentPanel = lazy(() =>
  import('./components/AgentPanel').then((m) => ({ default: m.AgentPanel }))
)
const TerminalPanel = lazy(() =>
  import('./components/TerminalPanel').then((m) => ({ default: m.TerminalPanel }))
)
const McpServerPanel = lazy(() =>
  import('./components/McpServerPanel').then((m) => ({ default: m.McpServerPanel }))
)
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((m) => ({ default: m.SettingsPanel }))
)
const OnboardingModal = lazy(() =>
  import('./components/OnboardingModal').then((m) => ({ default: m.OnboardingModal }))
)

export default function App() {
  const theme = useAppStore((s) => s.theme)
  const showTerminal = useAppStore((s) => s.showTerminal)
  const showAgentPanel = useAppStore((s) => s.showAgentPanel)
  const showSettings = useAppStore((s) => s.showSettings)
  const showOnboarding = useAppStore((s) => s.showOnboarding)
  const updateAvailable = useAppStore((s) => s.updateAvailable)
  const updateDownloaded = useAppStore((s) => s.updateDownloaded)
  const deviceCode = useAppStore((s) => s.deviceCode)
  const toasts = useAppStore((s) => s.toasts)
  const agents = useAppStore((s) => s.agents)
  const activeAgentId = useAppStore((s) => s.activeAgentId)

  const hydrate = useAppStore((s) => s.hydrate)
  const setDeviceCode = useAppStore((s) => s.setDeviceCode)
  const addToolApprovalRequest = useAppStore((s) => s.addToolApprovalRequest)
  const setUpdateAvailable = useAppStore((s) => s.setUpdateAvailable)
  const setUpdateDownloaded = useAppStore((s) => s.setUpdateDownloaded)
  const dismissToast = useAppStore((s) => s.dismissToast)
  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const setShowOnboarding = useAppStore((s) => s.setShowOnboarding)

  // Hydrate store on mount
  useEffect(() => {
    hydrate()
  }, [hydrate])

  // Listen for device code during auth
  useEffect(() => {
    const unsubscribe = window.api.onDeviceCode(
      (data: { userCode: string; verificationUri: string }) => {
        setDeviceCode(data)
      }
    )
    return () => { unsubscribe() }
  }, [setDeviceCode])

  // Listen for tool approval requests
  useEffect(() => {
    const unsubscribe = window.api.onToolApprovalRequest(
      (data: { requestId: string; tool: string; args: Record<string, unknown>; description: string }) => {
        addToolApprovalRequest(data)
      }
    )
    return () => { unsubscribe() }
  }, [addToolApprovalRequest])

  // Listen for auto-update events
  useEffect(() => {
    const unsub1 = window.api.onUpdateAvailable((info: { version: string }) => {
      setUpdateAvailable(info)
    })
    const unsub2 = window.api.onUpdateDownloaded(() => {
      setUpdateDownloaded(true)
    })
    return () => { unsub1(); unsub2() }
  }, [setUpdateAvailable, setUpdateDownloaded])

  const activeAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) ?? null : null

  return (
    <div className={`flex h-screen w-screen ${theme === 'dark' ? 'dark' : ''}`} role="application">
      <Sidebar />
      <main className="flex-1 flex flex-col bg-white dark:bg-gray-900" role="main">
        <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700/80" role="banner">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Copilot Desktop Hub
            </h1>
            {activeAgent && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700" aria-label={`Active agent: ${activeAgent.name}`}>
                {activeAgent.icon} {activeAgent.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Settings"
              aria-label="Open settings"
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </button>
          </div>
        </header>

        {/* Update notification banner */}
        {updateAvailable && !updateDownloaded && (
          <div className="mx-4 mt-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-between" role="alert">
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Update v{updateAvailable.version} is available
            </p>
            <button
              onClick={() => window.api.downloadUpdate()}
              className="text-xs px-2 py-1 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
            >
              Download
            </button>
          </div>
        )}
        {updateDownloaded && (
          <div className="mx-4 mt-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-between" role="alert">
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Update downloaded — restart to install
            </p>
            <button
              onClick={() => window.api.installUpdate()}
              className="text-xs px-2 py-1 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
            >
              Restart
            </button>
          </div>
        )}

        <ChatWindow />

        {showTerminal && (
          <Suspense fallback={null}>
            <TerminalPanel
              visible={showTerminal}
              onClose={() => useAppStore.getState().toggleTerminal()}
            />
          </Suspense>
        )}
      </main>

      <Suspense fallback={null}>
        {showAgentPanel && (
          <AgentPanel />
        )}

        <McpServerPanel />

        <SettingsPanel />

        {showOnboarding && (
          <OnboardingModal
            onComplete={() => {
              window.api.setSetting('onboarding_complete', 'true')
              setShowOnboarding(false)
            }}
          />
        )}
      </Suspense>

      <ToolApproval />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {deviceCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="GitHub device code">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 max-w-sm text-center">
            <h2 className="text-lg font-semibold mb-2">Enter this code on GitHub</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Copy the code below and enter it at GitHub to authorize.
            </p>
            <div
              className="text-3xl font-mono font-bold tracking-widest bg-gray-100 dark:bg-gray-700 rounded-lg py-3 px-4 mb-4 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              onClick={() => navigator.clipboard.writeText(deviceCode.userCode)}
              title="Click to copy"
            >
              {deviceCode.userCode}
            </div>
            <p className="text-xs text-gray-400 mb-4">Click the code to copy it</p>
            <a
              href={deviceCode.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Open GitHub →
            </a>
            <p className="mt-4 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-gray-400 dark:border-gray-500 border-t-transparent rounded-full animate-spin" />
              Waiting for authorization…
            </p>
            <button
              onClick={() => setDeviceCode(null)}
              className="block w-full mt-3 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
