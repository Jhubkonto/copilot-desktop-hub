import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'
import { SectionPane } from './components/SectionPane'
import { TitleBar } from './components/TitleBar'
import { ToolApproval } from './components/ToolApproval'
import { ToastContainer } from './components/Toast'
import { DeleteAgentDialog } from './components/DeleteAgentDialog'
import { BugReportModal } from './components/BugReportModal'
import { ErrorBoundary } from './components/ErrorBoundary'
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
const ProjectGeneratorModal = lazy(() =>
  import('./components/ProjectGeneratorModal').then((m) => ({ default: m.ProjectGeneratorModal }))
)
const SkillPanel = lazy(() =>
  import('./components/SkillPanel').then((m) => ({ default: m.SkillPanel }))
)
const SkillGeneratorModal = lazy(() =>
  import('./components/SkillGeneratorModal').then((m) => ({ default: m.SkillGeneratorModal }))
)
const SelfHealPanel = lazy(() =>
  import('./components/SelfHealPanel').then((m) => ({ default: m.SelfHealPanel }))
)
const ArtifactsPanel = lazy(() =>
  import('./components/ArtifactsPanel').then((m) => ({ default: m.ArtifactsPanel }))
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
  const toasts = useAppStore((s) => s.toasts)

  const showNewProjectForm = useAppStore((s) => s.showNewProjectForm)
  const showProjectGenerator = useAppStore((s) => s.showProjectGenerator)
  const setShowProjectGenerator = useAppStore((s) => s.setShowProjectGenerator)
  const showSkillPanel = useAppStore((s) => s.showSkillPanel)
  const showSkillGenerator = useAppStore((s) => s.showSkillGenerator)
  const setShowSkillGenerator = useAppStore((s) => s.setShowSkillGenerator)
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
  const bugReportDraft = useAppStore((s) => s.bugReportDraft)
  const pendingErrorCount = useAppStore((s) => s.pendingErrorCount)
  const openBugReport = useAppStore((s) => s.openBugReport)
  const closeBugReport = useAppStore((s) => s.closeBugReport)
  const setShowSelfHealPanel = useAppStore((s) => s.setShowSelfHealPanel)
  const setPendingSelfHealReportId = useAppStore((s) => s.setPendingSelfHealReportId)
  const incrementPendingErrorCount = useAppStore((s) => s.incrementPendingErrorCount)

  const hydrate = useAppStore((s) => s.hydrate)

  const [agentPanelWidth, setAgentPanelWidth] = useState(440)

  const handleAgentPanelResize = useCallback(
    (size: number) => {
      setAgentPanelWidth(Math.max(280, Math.min(700, size)))
    },
    []
  )

  const createCrashSelfHealReport = useCallback(async (draft: { title: string; description: string }) => {
    let screenshotDataUrl: string | null = null
    try {
      const screenshot = await window.api.captureWindowScreenshot()
      if (screenshot && typeof screenshot === 'object' && 'dataUrl' in screenshot) {
        screenshotDataUrl = screenshot.dataUrl
      }
    } catch {
      screenshotDataUrl = null
    }

    const result = await window.api.captureErrorReport({
      title: draft.title,
      description: draft.description,
      includeLog: true,
      includeScreenshot: screenshotDataUrl !== null,
      screenshotDataUrl,
    })
    return result.reportId
  }, [])

  const openCrashSelfHealReport = useCallback((reportId: string) => {
    setPendingSelfHealReportId(reportId)
    setShowSelfHealPanel(true)
    addToast(`Bug report captured (${reportId.slice(0, 8)}) - now in Self-Heal`, 'success')
  }, [addToast, setPendingSelfHealReportId, setShowSelfHealPanel])

  // Hydrate store on mount
  useEffect(() => {
    hydrate()
      .then(() => window.api.confirmSelfHealStartup?.())
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
    if (typeof window.api.onErrorLogEntry !== 'function') return
    const unsubscribe = window.api.onErrorLogEntry((entry) => {
      if (entry.level === 'error') incrementPendingErrorCount()
    })
    return () => { unsubscribe() }
  }, [incrementPendingErrorCount])

  useEffect(() => {
    if (typeof window.api.onDebugLog !== 'function') return
    const unsubscribe = window.api.onDebugLog((entry) => {
      console.debug(entry.message)
    })
    return () => { unsubscribe() }
  }, [])

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
    <ErrorBoundary
      onReportBug={openBugReport}
      onCreateSelfHealReport={createCrashSelfHealReport}
      onOpenSelfHealReport={openCrashSelfHealReport}
    >
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

        {(showNewProjectForm || editingProjectId) && <ProjectPanel />}

        {showProjectGenerator && (
          <ProjectGeneratorModal onClose={() => setShowProjectGenerator(false)} />
        )}

        {showSkillPanel && <SkillPanel />}

        {showSkillGenerator && (
          <SkillGeneratorModal onClose={() => setShowSkillGenerator(false)} />
        )}

        <McpServerPanel />

        <SettingsPanel />

        <SelfHealPanel />

        <ArtifactsPanel />

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

      {pendingErrorCount > 0 && !bugReportDraft && (
        <button
          type="button"
          className="fixed bottom-4 left-4 z-40 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 shadow-lg hover:bg-red-50 dark:border-red-900/60 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-red-950/30"
          onClick={() => openBugReport()}
        >
          Report bug ({pendingErrorCount})
        </button>
      )}

      {bugReportDraft && (
        <BugReportModal
          draft={bugReportDraft}
          onClose={closeBugReport}
          onSubmitted={(reportId) => {
            closeBugReport()
            addToast(`Bug report captured (${reportId.slice(0, 8)}) — now in Self-Heal`, 'success', {
              label: 'View',
              onClick: () => {
                setPendingSelfHealReportId(reportId)
                setShowSelfHealPanel(true)
              },
            })
          }}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
    </ErrorBoundary>
  )
}
