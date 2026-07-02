import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectCodeChangesTab } from '../components/project-settings/ProjectCodeChangesTab'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import { DEFAULT_PROJECT_CONFIG, type ProjectConfig } from '../store/types'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn(),
}))

vi.mock('../store/app-store', () => ({
  useAppStore,
}))

let mockApi: MockApi
let mockStore: ReturnType<typeof createMockAppStore>
const user = userEvent.setup()

const CONNECTED_PROJECT_CONFIG: ProjectConfig = {
  ...DEFAULT_PROJECT_CONFIG,
  rootDirectory: 'C:\\workspace',
  workspaceInfo: {
    rootDirectory: 'C:\\workspace',
    exists: true,
    isLikelyCodingWorkspace: true,
    codingMarkers: [],
    isGitRepo: true,
    repoRoot: 'C:\\workspace',
    branch: 'main',
    dirty: false,
    scannedAt: Date.now(),
  },
}

const SAMPLE_REPORT = {
  id: 'report-1',
  title: 'Fix the flaky test',
  description: 'Investigate and patch.',
  status: 'open',
  request_type: 'bugfix',
  request_origin: 'legacy-bug-report',
  workspace_root: null,
  project_id: 'project-1',
  fix_status: 'none',
  fix_staged_files: null,
  fix_error: null,
  fix_completed_at: null,
  investigation_markdown: null,
  created_at: 1000,
  updated_at: 1000,
}

function setup(overrides: Record<string, unknown> = {}) {
  mockApi = setupMockApi()
  mockApi.listErrorReports = vi.fn().mockResolvedValue([SAMPLE_REPORT])
  mockStore = createMockAppStore({
    catalogModels: [],
    ...overrides,
  })
  setupStoreMock(useAppStore, mockStore)
}

function renderTab(projectConfig: ProjectConfig = CONNECTED_PROJECT_CONFIG, onGoToGeneralTab = vi.fn()) {
  return render(
    <ProjectCodeChangesTab projectId="project-1" projectConfig={projectConfig} onGoToGeneralTab={onGoToGeneralTab} />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProjectCodeChangesTab gating', () => {
  it('shows an empty state with a General-tab link when rootDirectory is empty', async () => {
    setup()
    const onGoToGeneralTab = vi.fn()
    renderTab({ ...DEFAULT_PROJECT_CONFIG, rootDirectory: '' }, onGoToGeneralTab)

    expect(screen.getByText(/Set a root directory in General/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Go to General/i }))
    expect(onGoToGeneralTab).toHaveBeenCalled()

    // Nothing else (list view, new request button) is rendered.
    expect(screen.queryByText('New request')).not.toBeInTheDocument()
  })

  it('shows a warning banner and disables New request when the workspace directory is missing', async () => {
    setup()
    renderTab({
      ...CONNECTED_PROJECT_CONFIG,
      workspaceInfo: { ...CONNECTED_PROJECT_CONFIG.workspaceInfo!, exists: false },
    })

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    expect(screen.getByText('Workspace directory not found on disk')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New request' })).toBeDisabled()
  })

  it('scopes report loading to the given projectId', async () => {
    setup()
    renderTab()

    await waitFor(() => expect(mockApi.listErrorReports).toHaveBeenCalledWith(25, 'project-1'))
  })
})

describe('ProjectCodeChangesTab delete flow', () => {
  it('deletes a report and shows a success toast when the IPC call succeeds', async () => {
    setup()
    mockApi.deleteErrorReport = vi.fn().mockResolvedValue(true)
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete Fix the flaky test' }))

    const confirmButton = await screen.findByRole('button', { name: /delete request/i })
    await user.click(confirmButton)

    await waitFor(() => expect(mockApi.deleteErrorReport).toHaveBeenCalledWith('report-1'))
    await waitFor(() => expect(mockStore.addToast).toHaveBeenCalledWith('Change request deleted', 'success'))
  })

  it('keeps the report and shows an error toast when the IPC call fails', async () => {
    setup()
    mockApi.deleteErrorReport = vi.fn().mockResolvedValue({ error: 'Database is locked' })
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete Fix the flaky test' }))

    const confirmButton = await screen.findByRole('button', { name: /delete request/i })
    await user.click(confirmButton)

    await waitFor(() => expect(mockApi.deleteErrorReport).toHaveBeenCalledWith('report-1'))
    await waitFor(() => expect(mockStore.addToast).toHaveBeenCalledWith('Database is locked', 'error'))
    expect(screen.getByText('Fix the flaky test')).toBeInTheDocument()
  })
})

describe('ProjectCodeChangesTab list and detail views', () => {
  const SECOND_REPORT = {
    ...SAMPLE_REPORT,
    id: 'report-2',
    title: 'Add retry logic',
    status: 'investigating',
    investigation_markdown: 'Looked at the retry path.',
  }

  it('lands on the list view by default, showing a phase badge for each report', async () => {
    setup()
    mockApi.listErrorReports = vi.fn().mockResolvedValue([SAMPLE_REPORT, SECOND_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    expect(screen.getByText(/Draft/)).toBeInTheDocument()
    expect(screen.getByText('Add retry logic')).toBeInTheDocument()
    // A report with status 'investigating' is actively running, so the row shows a live
    // "Working…" indicator instead of the static "Planning" phase label.
    expect(screen.getByText(/Working…/)).toBeInTheDocument()
    // Detail-only content is not shown alongside the list.
    expect(screen.queryByText(/Next step:/)).not.toBeInTheDocument()
  })

  it('navigates to a request detail view when its list row is clicked, hiding the list', async () => {
    setup()
    mockApi.listErrorReports = vi.fn().mockResolvedValue([SAMPLE_REPORT, SECOND_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())

    await user.click(screen.getByText('Add retry logic'))

    await waitFor(() => expect(screen.getByText('Looked at the retry path.')).toBeInTheDocument())
    expect(screen.queryByText('Fix the flaky test')).not.toBeInTheDocument()
  })

  it('shows the phase-derived primary guidance after navigating into a request', async () => {
    setup()
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    await user.click(screen.getByText('Fix the flaky test'))

    await waitFor(() => expect(screen.getByText(/Next step: Draft/)).toBeInTheDocument())
    expect(screen.getByText('Plan the files and approach for this change.')).toBeInTheDocument()
  })

  it('returns to the list view via the back button', async () => {
    setup()
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    await user.click(screen.getByText('Fix the flaky test'))
    await waitFor(() => expect(screen.getByText(/Next step: Draft/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /← Code Changes/ }))

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    expect(screen.queryByText(/Next step:/)).not.toBeInTheDocument()
  })

  it('shows the investigation output for a request already under investigation', async () => {
    setup()
    mockApi.listErrorReports = vi.fn().mockResolvedValue([SECOND_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Add retry logic')).toBeInTheDocument())
    await user.click(screen.getByText('Add retry logic'))

    await waitFor(() => expect(screen.getByText('Looked at the retry path.')).toBeInTheDocument())
  })

  it('offers a Retry action and keeps planning settings visible after a failed plan, instead of a dead end', async () => {
    setup()
    const FAILED_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-3',
      title: 'Android bug report',
      status: 'open',
      investigation_markdown: '# Planning failed\n\nNo provider configured. Add an API key in Settings.',
      investigation_root_cause: 'investigation_failed',
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([FAILED_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Android bug report')).toBeInTheDocument())
    await user.click(screen.getByText('Android bug report'))

    await waitFor(() => expect(screen.getByText('Planning failed')).toBeInTheDocument())
    expect(screen.getByText('No provider configured. Add an API key in Settings.')).toBeInTheDocument()
    expect(screen.getByText('Planning settings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows a live "Planning..." state and starting placeholder immediately after clicking Plan, before any activity event arrives', async () => {
    setup()
    let resolveStart: (() => void) | undefined
    mockApi.startInvestigation = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveStart = () => resolve({ reportId: 'report-1' }) }),
    )
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    await user.click(screen.getByText('Fix the flaky test'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Plan' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Planning...' })).toBeInTheDocument())
    expect(screen.getByText('Starting...')).toBeInTheDocument()
    // Settings are hidden while a run is actively in flight.
    expect(screen.queryByText('Planning settings')).not.toBeInTheDocument()

    resolveStart?.()
  })

  it('detects a request still planning on the backend after reopening the tab, without a local run in progress', async () => {
    setup()
    const RESUMED_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-4',
      title: 'Long-running plan',
      status: 'investigating',
      investigation_markdown: null,
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([RESUMED_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Long-running plan')).toBeInTheDocument())
    await user.click(screen.getByText('Long-running plan'))

    await waitFor(() => expect(screen.getByText(/still running in the background/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Planning...' })).toBeDisabled()
  })

  it('offers a Revise plan action and shows the persisted failure reason when patch generation fails against an unusable plan', async () => {
    setup()
    const NEEDS_ATTENTION_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-5',
      title: 'Android bug report',
      status: 'investigated',
      investigation_markdown: '---\nconfidence: unknown\nroot_cause: unknown\naffected_files: []\n---\n',
      fix_status: 'failed',
      fix_error: 'No affected files found in investigation report — accept the investigation first',
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([NEEDS_ATTENTION_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Android bug report')).toBeInTheDocument())
    await user.click(screen.getByText('Android bug report'))

    await waitFor(() => expect(screen.getByText(/Next step: Needs attention/)).toBeInTheDocument())
    // The persisted fix_error survives even though no live fixStatus event fired this session.
    expect(screen.getByText(/No affected files found in investigation report/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revise plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate patch' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revise plan' }))
    await user.type(screen.getByLabelText('What should the plan do differently?'), 'Look elsewhere')
    await user.click(screen.getByRole('button', { name: 'Revise plan' }))

    await waitFor(() => expect(mockApi.startInvestigation).toHaveBeenCalledWith('report-5', 'Look elsewhere'))
  })

  it('surfaces Accept/Reject/Revise for a plan awaiting review, and lets the user accept it', async () => {
    setup()
    const AWAITING_REVIEW_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-6',
      title: 'Add retry logic',
      status: 'investigating',
      investigation_markdown: '---\nconfidence: high\nroot_cause: missing guard\naffected_files:\n  - "src/main/database.ts"\n---\n\n# Summary',
      investigation_affected_files: '["src/main/database.ts"]',
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([AWAITING_REVIEW_REPORT])
    mockApi.setRemoteEditReportStatus = vi.fn().mockResolvedValue({ ...AWAITING_REVIEW_REPORT, status: 'investigated' })
    renderTab()

    await waitFor(() => expect(screen.getByText('Add retry logic')).toBeInTheDocument())
    await user.click(screen.getByText('Add retry logic'))

    const acceptButton = await screen.findByRole('button', { name: 'Accept' })
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revise plan' })).toBeInTheDocument()
    expect(acceptButton).not.toBeDisabled()

    await user.click(acceptButton)

    await waitFor(() => expect(mockApi.setRemoteEditReportStatus).toHaveBeenCalledWith('report-6', 'investigated'))
  })

  it('blocks Accept and warns when a completed plan has no affected files', async () => {
    setup()
    const EMPTY_PLAN_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-7',
      title: 'Android bug report',
      status: 'investigating',
      investigation_markdown: '---\nconfidence: unknown\nroot_cause: unknown\naffected_files: []\n---\n',
      investigation_affected_files: '[]',
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([EMPTY_PLAN_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Android bug report')).toBeInTheDocument())
    await user.click(screen.getByText('Android bug report'))

    await waitFor(() => expect(screen.getByText("This plan didn't identify any files to change")).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).not.toBeDisabled()
  })

  it('offers Undo and Revise plan when verification fails after an applied patch, instead of a dead end', async () => {
    setup()
    const VERIFY_FAILED_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-8',
      title: 'Android bug report',
      status: 'investigated',
      investigation_markdown: '---\nconfidence: unknown\nroot_cause: unknown\naffected_files: []\n---\n',
      fix_status: 'applied',
      fix_staged_files: JSON.stringify([{ relativePath: 'src/example.ts', stagingPath: '', backupPath: '/tmp/backup.ts', diffLineCount: 1, reviewed: true }]),
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([VERIFY_FAILED_REPORT])
    mockApi.getVerificationRuns = vi.fn().mockResolvedValue([{
      id: 'verify-1',
      reportId: 'report-8',
      status: 'failed',
      steps: [],
      startedAt: 1,
      completedAt: 2,
      retryCount: 0,
      error: 'typecheck failed',
    }])
    renderTab()

    await waitFor(() => expect(screen.getByText('Android bug report')).toBeInTheDocument())
    await user.click(screen.getByText('Android bug report'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo this change' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Revise plan' })).toBeInTheDocument()
    expect(screen.getByText('typecheck failed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revise plan' }))
    await user.type(screen.getByLabelText('What should the plan do differently?'), 'Try a different approach')
    await user.click(screen.getByRole('button', { name: 'Revise plan' }))

    await waitFor(() => expect(mockApi.startInvestigation).toHaveBeenCalledWith('report-8', 'Try a different approach'))
  })

  it('lets the user navigate back to an earlier phase by clicking its badge in the stepper', async () => {
    setup()
    const MULTI_PHASE_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-9',
      title: 'Add retry logic',
      status: 'investigated',
      investigation_markdown: '---\nconfidence: high\nroot_cause: missing guard\naffected_files:\n  - "src/example.ts"\n---\n\nPlan body',
      fix_status: 'applied',
      fix_staged_files: JSON.stringify([{ relativePath: 'src/example.ts', stagingPath: '', backupPath: '/tmp/backup.ts', diffLineCount: 1, reviewed: true }]),
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([MULTI_PHASE_REPORT])
    mockApi.getVerificationRuns = vi.fn().mockResolvedValue([])
    renderTab()

    await waitFor(() => expect(screen.getByText('Add retry logic')).toBeInTheDocument())
    await user.click(screen.getByText('Add retry logic'))

    // Both the patch-ready and applied phase sections are visible at once, distinctly.
    await waitFor(() => expect(screen.getByText(/Patch ready · applied/)).toBeInTheDocument())
    expect(screen.getAllByText('Applied').length).toBeGreaterThan(0)

    // Collapse the "Patch ready" section, then click its badge in the stepper to re-expand it.
    await user.click(screen.getByText(/Patch ready · applied/))
    expect(screen.queryByText('Staged patch')).not.toBeInTheDocument()

    const patchReadyBadge = screen.getByRole('button', { name: 'Patch ready' })
    await user.click(patchReadyBadge)

    await waitFor(() => expect(screen.getByText('Staged patch')).toBeInTheDocument())
  })

  it('does not make not-yet-reached phase badges clickable', async () => {
    setup()
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    await user.click(screen.getByText('Fix the flaky test'))

    await waitFor(() => expect(screen.getByText(/Next step: Draft/)).toBeInTheDocument())
    const patchReadyBadge = screen.getByRole('button', { name: 'Patch ready' })
    expect(patchReadyBadge).toBeDisabled()
  })
})
