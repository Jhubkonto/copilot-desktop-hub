import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { SectionPane } from './components/SectionPane'
import { TitleBar } from './components/TitleBar'
import { ToolApproval } from './components/ToolApproval'
import { ToastContainer } from './components/Toast'
import { DeleteAgentDialog } from './components/DeleteAgentDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AndroidLogPanel } from './components/AndroidLogPanel'
import { BackgroundActivityBridges } from './components/BackgroundActivityBridges'
import { ActivityFeedModal } from './components/ActivityFeedModal'
import { useAppStore } from './store/app-store'

const AgentPanel = lazy(() =>
  import('./components/AgentPanel').then((m) => ({ default: m.AgentPanel }))
)
const AgentGeneratorModal = lazy(() =>
  import('./components/AgentGeneratorModal').then((m) => ({ default: m.AgentGeneratorModal }))
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
const ProjectGeneratorModal = lazy(() =>
  import('./components/ProjectGeneratorModal').then((m) => ({ default: m.ProjectGeneratorModal }))
)
const SkillPanel = lazy(() =>
  import('./components/SkillPanel').then((m) => ({ default: m.SkillPanel }))
)
const SkillGeneratorModal = lazy(() =>
  import('./components/SkillGeneratorModal').then((m) => ({ default: m.SkillGeneratorModal }))
)
const ScheduleGeneratorModal = lazy(() =>
  import('./components/ScheduleGeneratorModal').then((m) => ({ default: m.ScheduleGeneratorModal }))
)
const ArtifactPanel = lazy(() =>
  import('./components/ArtifactPanel').then((m) => ({ default: m.ArtifactPanel }))
)

export default function App() {
  const theme = useAppStore((s) => s.theme)
  const showAgentPanel = useAppStore((s) => s.showAgentPanel)
  const showAgentGenerator = useAppStore((s) => s.showAgentGenerator)
  const setShowAgentGenerator = useAppStore((s) => s.setShowAgentGenerator)
  const showOnboarding = useAppStore((s) => s.showOnboarding)
  const showSidebar = useAppStore((s) => s.showSidebar)
  const activeSectionPane = useAppStore((s) => s.activeSectionPane)
  const updateAvailable = useAppStore((s) => s.updateAvailable)
  const updateDownloaded = useAppStore((s) => s.updateDownloaded)
  const toasts = useAppStore((s) => s.toasts)
  const showActivityFeed = useAppStore((s) => s.showActivityFeed)

  const showNewProjectForm = useAppStore((s) => s.showNewProjectForm)
  const showProjectGenerator = useAppStore((s) => s.showProjectGenerator)
  const setShowProjectGenerator = useAppStore((s) => s.setShowProjectGenerator)
  const showSkillPanel = useAppStore((s) => s.showSkillPanel)
  const showSkillGenerator = useAppStore((s) => s.showSkillGenerator)
  const setShowSkillGenerator = useAppStore((s) => s.setShowSkillGenerator)
  const showSchedulerGenerator = useAppStore((s) => s.showSchedulerGenerator)
  const setShowSchedulerGenerator = useAppStore((s) => s.setShowSchedulerGenerator)
  const editingProjectId = useAppStore((s) => s.editingProjectId)
  const pendingDeleteAgent = useAppStore((s) => s.pendingDeleteAgent)
  const confirmDeleteAgent = useAppStore((s) => s.confirmDeleteAgent)
  const cancelDeleteAgent = useAppStore((s) => s.cancelDeleteAgent)
  const addToolApprovalRequest = useAppStore((s) => s.addToolApprovalRequest)
  const removeToolApprovalRequest = useAppStore((s) => s.removeToolApprovalRequest)
  const setUpdateAvailable = useAppStore((s) => s.setUpdateAvailable)
  const setUpdateDownloaded = useAppStore((s) => s.setUpdateDownloaded)
  const dismissToast = useAppStore((s) => s.dismissToast)
  const setShowOnboarding = useAppStore((s) => s.setShowOnboarding)
  const addToast = useAppStore((s) => s.addToast)
  const setCatalogModels = useAppStore((s) => s.setCatalogModels)
  const androidDebugLog = useAppStore((s) => s.androidDebugLog)
  const viewingArtifactId = useAppStore((s) => s.viewingArtifactId)

  const markConversationGenerating = useAppStore((s) => s.markConversationGenerating)
  const markConversationDoneGenerating = useAppStore((s) => s.markConversationDoneGenerating)
  const loadConversations = useAppStore((s) => s.loadConversations)
  const handleConversationCompleted = useAppStore((s) => s.handleConversationCompleted)
  const handleConversationIncompleted = useAppStore((s) => s.handleConversationIncompleted)

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
      .then(() => window.api.confirmRemoteEditStartup?.())
      .catch(() => {})
  }, [hydrate])

  // Listen for tool approval requests
  useEffect(() => {
    const unsubscribe = window.api.onToolApprovalRequest(
      (data: { requestId: string; tool: string; args: Record<string, unknown>; description: string }) => {
        addToolApprovalRequest(data)
      }
    )
    return () => { unsubscribe() }
  }, [addToolApprovalRequest])

  // Dismiss approval bar when phone approves/rejects remotely
  useEffect(() => {
    const unsubscribe = window.api.onToolApprovalResolved((requestId: string) => {
      removeToolApprovalRequest(requestId)
    })
    return () => { unsubscribe() }
  }, [removeToolApprovalRequest])

  // Show inline indicator for auto-approved tool calls
  useEffect(() => {
    if (typeof window.api.onToolAutoApproved !== 'function') return
    const unsubscribe = window.api.onToolAutoApproved(
      (data: { toolName: string; args: Record<string, unknown> }) => {
        addToast(`⚡ ${data.toolName} auto-approved`, 'info')
      }
    )
    return () => { unsubscribe() }
  }, [addToast])

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

  useEffect(() => {
    const unsubscribe = window.api.onCatalogUpdated((data) => {
      setCatalogModels(data.models)
      if (data.changeSummary) {
        addToast(data.changeSummary, 'info')
      }
    })
    return () => { unsubscribe() }
  }, [setCatalogModels, addToast])

  useEffect(() => {
    if (typeof window.api.onDebugLog !== 'function') return
    const unsubscribe = window.api.onDebugLog((entry) => {
      console.debug(entry.message)
    })
    return () => { unsubscribe() }
  }, [])

  // Track globally active conversations (e.g. Android-initiated chats with no open window)
  useEffect(() => {
    if (typeof window.api.onActivityGlobal !== 'function') return
    // Track which conversations we've already fetched during this generation so we
    // don't call loadConversations() on every streaming activity event.
    const seenGenerating = new Set<string>()
    const unsubscribe = window.api.onActivityGlobal((data) => {
      if (data.state === 'complete' || data.state === 'error') {
        seenGenerating.delete(data.conversationId)
        markConversationDoneGenerating(data.conversationId)
        void loadConversations()
      } else {
        markConversationGenerating(data.conversationId)
        if (!seenGenerating.has(data.conversationId)) {
          seenGenerating.add(data.conversationId)
          void loadConversations()
        }
      }
    })
    return () => { unsubscribe() }
  }, [markConversationGenerating, markConversationDoneGenerating, loadConversations])

  // Sync completion state pushed from Android via WebSocket
  useEffect(() => {
    const unsub1 = window.api.onConversationCompleted((data) => {
      handleConversationCompleted(data.conversationId)
    })
    const unsub2 = window.api.onConversationIncompleted((data) => {
      handleConversationIncompleted(data.conversationId)
    })
    return () => { unsub1(); unsub2() }
  }, [handleConversationCompleted, handleConversationIncompleted])

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
    <ErrorBoundary>
    <div className={`flex flex-col h-full w-full overflow-hidden ${theme === 'dark' ? 'dark' : ''}`} role="application">
      {/* Custom frameless titlebar */}
      <TitleBar />

      {/* Content row: sidebar + main */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {showSidebar && <Sidebar />}
        {activeSectionPane && <SectionPane section={activeSectionPane} />}
        <main className="flex-1 flex flex-col min-h-0 min-w-[380px] bg-white dark:bg-gray-900" role="main">

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

        {showAgentGenerator && (
          <AgentGeneratorModal onClose={() => setShowAgentGenerator(false)} />
        )}

        {(showNewProjectForm || editingProjectId) && <ProjectPanel />}

        {showProjectGenerator && (
          <ProjectGeneratorModal onClose={() => setShowProjectGenerator(false)} />
        )}

        {showSkillPanel && <SkillPanel />}

        {showSkillGenerator && (
          <SkillGeneratorModal onClose={() => setShowSkillGenerator(false)} />
        )}

        {showSchedulerGenerator && (
          <ScheduleGeneratorModal onClose={() => setShowSchedulerGenerator(false)} />
        )}

        <McpServerPanel />

        <SettingsPanel />

        {viewingArtifactId && <ArtifactPanel artifactId={viewingArtifactId} />}

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
      <AndroidLogPanel enabled={androidDebugLog} />
      <BackgroundActivityBridges />
      {showActivityFeed && <ActivityFeedModal />}
    </div>
    </ErrorBoundary>
  )
}
