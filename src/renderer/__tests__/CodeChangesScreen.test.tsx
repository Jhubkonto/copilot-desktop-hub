import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeChangesScreen } from '../components/CodeChangesScreen'
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

function renderTab(projectConfig: ProjectConfig = CONNECTED_PROJECT_CONFIG, onOpenGeneralSettings = vi.fn()) {
  return render(
    <CodeChangesScreen projectId="project-1" projectConfig={projectConfig} onOpenGeneralSettings={onOpenGeneralSettings} />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CodeChangesScreen gating', () => {
  it('shows an empty state with a General-tab link when rootDirectory is empty', async () => {
    setup()
    const onOpenGeneralSettings = vi.fn()
    renderTab({ ...DEFAULT_PROJECT_CONFIG, rootDirectory: '' }, onOpenGeneralSettings)

    expect(screen.getByText(/Set a root directory in General/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Go to General/i }))
    expect(onOpenGeneralSettings).toHaveBeenCalled()

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

describe('CodeChangesScreen delete flow', () => {
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

describe('CodeChangesScreen list and detail views', () => {
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
    // status: 'investigating' is a persisted "plan awaiting review" state, not a live "running
    // right now" signal (a completed plan intentionally stays in this status until the user
    // accepts it) — so the row shows the static "Planning" phase badge, not a spinner.
    expect(screen.getByText(/Planning/)).toBeInTheDocument()
    expect(screen.queryByText(/Working…/)).not.toBeInTheDocument()
    // Detail-only content is not shown alongside the list.
    expect(screen.queryByText(/Next step:/)).not.toBeInTheDocument()
  })

  it('shows a live "Working…" indicator in the list for a plan that is genuinely still running in the background, unlike a completed plan awaiting review', async () => {
    setup()
    const STILL_RUNNING_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-3',
      title: 'Long-running plan',
      status: 'investigating',
      investigation_markdown: null,
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([STILL_RUNNING_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Long-running plan')).toBeInTheDocument())
    expect(screen.getByText(/Working…/)).toBeInTheDocument()
  })

  it('opens a request detail view in a modal when its list row is clicked, keeping the list visible behind it', async () => {
    setup()
    mockApi.listErrorReports = vi.fn().mockResolvedValue([SAMPLE_REPORT, SECOND_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())

    await user.click(screen.getByText('Add retry logic'))

    await waitFor(() => expect(screen.getByText('Looked at the retry path.')).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // The list stays mounted behind the modal — both report titles are still in the document.
    expect(screen.getAllByText('Fix the flaky test').length).toBeGreaterThan(0)
  })

  it('shows the phase-derived primary guidance after navigating into a request', async () => {
    setup()
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    await user.click(screen.getByText('Fix the flaky test'))

    await waitFor(() => expect(screen.getByText(/Next step: Draft/)).toBeInTheDocument())
    expect(screen.getByText('Plan the files and approach for this change.')).toBeInTheDocument()
  })

  it('closes the detail modal via its close button', async () => {
    setup()
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    await user.click(screen.getByText('Fix the flaky test'))
    await waitFor(() => expect(screen.getByText(/Next step: Draft/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Close Fix the flaky test/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
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
    await user.click(screen.getByRole('button', { name: 'Send revision' }))

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

  it('offers a model picker inside the revise-plan form so a different model can be used for the retry', async () => {
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
    renderTab()

    await waitFor(() => expect(screen.getByText('Add retry logic')).toBeInTheDocument())
    await user.click(screen.getByText('Add retry logic'))

    await user.click(await screen.findByRole('button', { name: 'Revise plan' }))

    expect(screen.getByLabelText('Conversation model')).toBeInTheDocument()
    expect(screen.getByLabelText('What should the plan do differently?')).toBeInTheDocument()

    await user.type(screen.getByLabelText('What should the plan do differently?'), 'Try a different model')
    await user.click(screen.getByRole('button', { name: 'Send revision' }))

    await waitFor(() => expect(mockApi.startInvestigation).toHaveBeenCalledWith('report-6', 'Try a different model'))
    // Settings (including the selected model) are persisted before the revision run starts.
    expect(mockApi.setInvestigationSettings).toHaveBeenCalled()
  })

  it('lists CLI models alongside BYOK provider models in the revise picker, and switches backend when a CLI model is picked', async () => {
    setup()
    mockApi.listAvailableModels = vi.fn().mockResolvedValue([
      { sourceKey: 'openrouter', sourceLabel: 'OpenRouter', sourceType: 'provider', models: [{ id: 'nousresearch/hermes-4-70b', label: 'Hermes 4 70B' }] },
      { sourceKey: 'claude-cli', sourceLabel: 'Claude CLI', sourceType: 'cli', models: [{ id: 'claude-cli-default', label: 'Claude CLI (default)' }] },
    ])
    const AWAITING_REVIEW_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-6',
      title: 'Add retry logic',
      status: 'investigating',
      investigation_markdown: '---\nconfidence: high\nroot_cause: missing guard\naffected_files:\n  - "src/main/database.ts"\n---\n\n# Summary',
      investigation_affected_files: '["src/main/database.ts"]',
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([AWAITING_REVIEW_REPORT])
    renderTab()

    await waitFor(() => expect(screen.getByText('Add retry logic')).toBeInTheDocument())
    await user.click(screen.getByText('Add retry logic'))
    await user.click(await screen.findByRole('button', { name: 'Revise plan' }))

    await user.click(screen.getByRole('button', { name: 'Conversation model' }))
    expect(screen.getAllByText('Claude CLI').length).toBeGreaterThan(0)
    expect(screen.getAllByText('OpenRouter').length).toBeGreaterThan(0)

    await user.click(screen.getByText('Claude CLI (default)'))
    await user.type(screen.getByLabelText('What should the plan do differently?'), 'Use the CLI instead')
    await user.click(screen.getByRole('button', { name: 'Send revision' }))

    await waitFor(() => expect(mockApi.setInvestigationSettings).toHaveBeenCalledWith(
      expect.objectContaining({ backend: 'claude-cli', model: 'claude-cli-default' })
    ))
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
    await user.click(screen.getByRole('button', { name: 'Send revision' }))

    await waitFor(() => expect(mockApi.startInvestigation).toHaveBeenCalledWith('report-8', 'Try a different approach'))
  })

  it('offers Revise plan when a plan is rejected, instead of a dead end', async () => {
    setup()
    const REJECTED_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-10',
      title: 'Rejected plan report',
      status: 'rejected',
      investigation_markdown: '---\nconfidence: high\nroot_cause: missing guard\naffected_files:\n  - "src/example.ts"\n---\n\nPlan body',
      fix_status: 'none',
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([REJECTED_REPORT])
    mockApi.getVerificationRuns = vi.fn().mockResolvedValue([])
    renderTab()

    await waitFor(() => expect(screen.getByText('Rejected plan report')).toBeInTheDocument())
    await user.click(screen.getByText('Rejected plan report'))

    await waitFor(() => expect(screen.getByText(/Plan rejected/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Revise plan' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revise plan' }))
    await user.type(screen.getByLabelText('What should the plan do differently?'), 'Look elsewhere')
    await user.click(screen.getByRole('button', { name: 'Send revision' }))

    await waitFor(() => expect(mockApi.startInvestigation).toHaveBeenCalledWith('report-10', 'Look elsewhere'))
  })

  it('lets the user accept a rejected plan anyway, undoing the rejection', async () => {
    setup()
    const REJECTED_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-11',
      title: 'Rejected plan report',
      status: 'rejected',
      investigation_markdown: '---\nconfidence: high\nroot_cause: missing guard\naffected_files:\n  - "src/example.ts"\n---\n\nPlan body',
      investigation_affected_files: '["src/example.ts"]',
      fix_status: 'none',
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([REJECTED_REPORT])
    mockApi.getVerificationRuns = vi.fn().mockResolvedValue([])
    mockApi.setRemoteEditReportStatus = vi.fn().mockResolvedValue({ ...REJECTED_REPORT, status: 'investigated' })
    renderTab()

    await waitFor(() => expect(screen.getByText('Rejected plan report')).toBeInTheDocument())
    await user.click(screen.getByText('Rejected plan report'))

    await waitFor(() => expect(screen.getByText(/Plan rejected/)).toBeInTheDocument())
    const acceptAnywayButton = screen.getByRole('button', { name: 'Accept anyway' })
    expect(acceptAnywayButton).not.toBeDisabled()

    await user.click(acceptAnywayButton)

    await waitFor(() => expect(mockApi.setRemoteEditReportStatus).toHaveBeenCalledWith('report-11', 'investigated'))
  })

  it('surfaces Generate staged patch and Back to review next to the Next step banner once a plan is accepted', async () => {
    setup()
    const ACCEPTED_REPORT = {
      ...SAMPLE_REPORT,
      id: 'report-12',
      title: 'Accepted plan report',
      status: 'investigated',
      investigation_markdown: '---\nconfidence: high\nroot_cause: missing guard\naffected_files:\n  - "src/example.ts"\n---\n\nPlan body',
      investigation_affected_files: '["src/example.ts"]',
      fix_status: 'none',
    }
    mockApi.listErrorReports = vi.fn().mockResolvedValue([ACCEPTED_REPORT])
    mockApi.getVerificationRuns = vi.fn().mockResolvedValue([])
    mockApi.setRemoteEditReportStatus = vi.fn().mockResolvedValue({ ...ACCEPTED_REPORT, status: 'rejected' })
    renderTab()

    await waitFor(() => expect(screen.getByText('Accepted plan report')).toBeInTheDocument())
    await user.click(screen.getByText('Accepted plan report'))

    const nextStepBanner = (await screen.findByText(/Next step: Patch ready/)).closest('div')
    expect(nextStepBanner).not.toBeNull()
    const generateButton = screen.getByRole('button', { name: 'Generate staged patch' })
    const backButton = screen.getByRole('button', { name: 'Back to review' })
    expect(nextStepBanner).toContainElement(generateButton)
    expect(nextStepBanner).toContainElement(backButton)

    await user.click(backButton)

    await waitFor(() => expect(mockApi.setRemoteEditReportStatus).toHaveBeenCalledWith('report-12', 'rejected'))
  })

  it('renders phase badges as non-interactive indicators', async () => {
    setup()
    renderTab()

    await waitFor(() => expect(screen.getByText('Fix the flaky test')).toBeInTheDocument())
    await user.click(screen.getByText('Fix the flaky test'))

    await waitFor(() => expect(screen.getByText(/Next step: Draft/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Patch ready' })).not.toBeInTheDocument()
  })
})
