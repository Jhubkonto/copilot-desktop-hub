import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { SectionPane } from './components/SectionPane'
import { TitleBar } from './components/TitleBar'
import { ToolApproval } from './components/ToolApproval'
import { ToastContainer } from './components/Toast'
import { DeleteAgentDialog } from './components/DeleteAgentDialog'
import { DeviceCodeModal } from './components/DeviceCodeModal'
import { useAppStore } from './store/app-store'

const AgentPanel = lazy(() =>
  import('./components/AgentPanel').then((m) => ({ default: m.AgentPanel }))
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
const ProjectPanel = lazy(() =>
  import('./components/ProjectPanel').then((m) => ({ default: m.ProjectPanel }))
)

export default function App() {
  const theme = useAppStore((s) => s.theme)
  const showAgentPanel = useAppStore((s) => s.showAgentPanel)
  const showSettings = useAppStore((s) => s.showSettings)
  const showOnboarding = useAppStore((s) => s.showOnboarding)
  const showSidebar = useAppStore((s) => s.showSidebar)
  const activeSectionPane = useAppStore((s) => s.activeSectionPane)
  const updateAvailable = useAppStore((s) => s.updateAvailable)
  const updateDownloaded = useAppStore((s) => s.updateDownloaded)
  const deviceCode = useAppStore((s) => s.deviceCode)
  const toasts = useAppStore((s) => s.toasts)

  const showNewProjectForm = useAppStore((s) => s.showNewProjectForm)
  const editingProjectId = useAppStore((s) => s.editingProjectId)
  const pendingDeleteAgent = useAppStore((s) => s.pendingDeleteAgent)
  const confirmDeleteAgent = useAppStore((s) => s.confirmDeleteAgent)
  const cancelDeleteAgent = useAppStore((s) => s.cancelDeleteAgent)
  const setDeviceCode = useAppStore((s) => s.setDeviceCode)
  const addToolApprovalRequest = useAppStore((s) => s.addToolApprovalRequest)
  const setUpdateAvailable = useAppStore((s) => s.setUpdateAvailable)
  const setUpdateDownloaded = useAppStore((s) => s.setUpdateDownloaded)
  const dismissToast = useAppStore((s) => s.dismissToast)
  const setShowOnboarding = useAppStore((s) => s.setShowOnboarding)

  const hydrate = useAppStore((s) => s.hydrate)

  const [agentPanelWidth, setAgentPanelWidth] = useState(440)

  const handleAgentPanelResize = useCallback(
    (size: number) => {
      setAgentPanelWidth(Math.max(280, Math.min(700, size)))
    },
    []
  )

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

  // Zoom: Ctrl+scroll and Ctrl+Plus/Minus/0
  useEffect(() => {
    let lastZoom = 0
    const ZOOM_DEBOUNCE = 80

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastZoom < ZOOM_DEBOUNCE) return
      lastZoom = now
      if (e.deltaY < 0) window.api.zoomIn()
      else window.api.zoomOut()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); window.api.zoomIn() }
      else if (e.key === '-') { e.preventDefault(); window.api.zoomOut() }
      else if (e.key === '0') { e.preventDefault(); window.api.resetZoom() }
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div className={`flex flex-col h-full w-full overflow-hidden ${theme === 'dark' ? 'dark' : ''}`} role="application">
      {/* Custom frameless titlebar */}
      <TitleBar />

      {/* Content row: sidebar + main */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {showSidebar && <Sidebar />}
        {activeSectionPane && <SectionPane section={activeSectionPane} />}
        <main className="flex-1 flex flex-col min-h-0 min-w-0 bg-white dark:bg-gray-900" role="main">

          {/* Update notification banners */}
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
        </main>
      </div>

      <Suspense fallback={null}>
        {showAgentPanel && (
          <AgentPanel width={agentPanelWidth} onResize={handleAgentPanelResize} />
        )}

        {(showNewProjectForm || editingProjectId) && <ProjectPanel />}

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

      {pendingDeleteAgent && (
        <DeleteAgentDialog
          impact={pendingDeleteAgent}
          onConfirm={confirmDeleteAgent}
          onCancel={cancelDeleteAgent}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {deviceCode && (
        <DeviceCodeModal
          userCode={deviceCode.userCode}
          verificationUri={deviceCode.verificationUri}
          onCancel={() => setDeviceCode(null)}
        />
      )}
    </div>
  )
}
