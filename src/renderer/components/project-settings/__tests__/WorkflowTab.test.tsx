import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowTab } from '../WorkflowTab'
import { createMockAppStore, setupStoreMock } from '../../../../test/mocks/store'
import { setupMockApi } from '../../../../test/mocks/api'
import { DEFAULT_PROJECT_CONFIG } from '../../../../shared/types'
import type { ManualWorkflowRunDetail, ManualWorkflowRunSummary } from '../../../../shared/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../../store/app-store', () => ({ useAppStore }))

let mockStore: ReturnType<typeof createMockAppStore>
let mockApi: ReturnType<typeof setupMockApi>
let onStartWorkflowStep: ReturnType<typeof vi.fn<(agentId: string | null, prompt: string) => Promise<void>>>
let onToast: ReturnType<typeof vi.fn<(message: string, type: 'success' | 'error' | 'info') => void>>

const PROJECT_CONFIG = { ...DEFAULT_PROJECT_CONFIG, workflowMode: 'manual-delegation' as const }

function runSummary(overrides: Partial<ManualWorkflowRunSummary> = {}): ManualWorkflowRunSummary {
  return {
    id: 'run-1',
    projectId: 'proj-1',
    title: 'Ship the feature',
    goalSummary: 'Get it shipped',
    model: null,
    status: 'active',
    stepCounts: { total: 2, notStarted: 2, started: 0, done: 0 },
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function runDetail(overrides: Partial<ManualWorkflowRunDetail> = {}): ManualWorkflowRunDetail {
  return {
    ...runSummary(),
    assumptions: ['Team has staging access'],
    steps: [
      {
        id: 'step-1', dbId: 'db-1', runId: 'run-1', stepIndex: 0,
        title: 'Plan the work', summary: 'Break it down', prompt: 'Plan it', expectedOutput: 'A plan',
        agentId: 'agent-1', agentName: 'Planner', dependsOnStepIds: undefined,
        status: 'done', startedAt: 1000, completedAt: 1500,
      },
      {
        id: 'step-2', dbId: 'db-2', runId: 'run-1', stepIndex: 1,
        title: 'Implement', summary: 'Write the code', prompt: 'Implement it', expectedOutput: 'Working code',
        agentId: 'agent-2', agentName: 'Builder', dependsOnStepIds: ['step-1'],
        status: 'not_started', startedAt: null, completedAt: null,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi = setupMockApi()
  mockApi.listManualWorkflowRuns.mockResolvedValue([])
  onStartWorkflowStep = vi.fn<(agentId: string | null, prompt: string) => Promise<void>>().mockResolvedValue(undefined)
  onToast = vi.fn<(message: string, type: 'success' | 'error' | 'info') => void>()
  mockStore = createMockAppStore({
    authState: { authenticated: true, mode: 'byok', user: null, cliInstalled: false, clis: { claude: false, codex: false } },
  })
  setupStoreMock(useAppStore, mockStore)
})

function renderTab() {
  return render(
    <WorkflowTab
      projectId="proj-1"
      members={[]}
      projectConfig={PROJECT_CONFIG}
      onStartWorkflowStep={onStartWorkflowStep}
      onToast={onToast}
    />,
  )
}

describe('WorkflowTab', () => {
  it('explains the manual-delegation purpose and drops the old "isn\'t saved" caveat', async () => {
    renderTab()
    await waitFor(() => expect(mockApi.listManualWorkflowRuns).toHaveBeenCalledWith('proj-1'))

    expect(screen.getByText('Manual delegation execution plan')).toBeInTheDocument()
    expect(screen.queryByText(/isn't saved/i)).not.toBeInTheDocument()
  })

  it('shows the chat generator directly when there are no existing runs', async () => {
    renderTab()
    await waitFor(() => expect(mockApi.listManualWorkflowRuns).toHaveBeenCalled())

    expect(screen.getByPlaceholderText(/describe the project goal/i)).toBeInTheDocument()
  })

  it('shows a resumable runs list on mount when runs already exist', async () => {
    mockApi.listManualWorkflowRuns.mockResolvedValue([runSummary()])
    renderTab()

    await waitFor(() => {
      expect(screen.getByText('Ship the feature')).toBeInTheDocument()
    })
    expect(screen.getByText(/0\/2 steps done/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start a new workflow/i })).toBeInTheDocument()
  })

  it('"Start a new workflow" switches to the chat/workspace view', async () => {
    mockApi.listManualWorkflowRuns.mockResolvedValue([runSummary()])
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /start a new workflow/i }))

    expect(screen.getByPlaceholderText(/describe the project goal/i)).toBeInTheDocument()
  })

  it('opening a run groups steps into Ready and Completed correctly', async () => {
    mockApi.listManualWorkflowRuns.mockResolvedValue([runSummary()])
    mockApi.getManualWorkflowRun.mockResolvedValue(runDetail())
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Ship the feature'))

    await waitFor(() => expect(mockApi.getManualWorkflowRun).toHaveBeenCalledWith('run-1'))
    await waitFor(() => expect(screen.getByText('Ready now')).toBeInTheDocument())
    expect(screen.getByText(/2\. Implement/)).toBeInTheDocument()
    expect(screen.getByText(/Completed \(1\)/)).toBeInTheDocument()
    expect(screen.queryByText(/1\. Plan the work/)).not.toBeInTheDocument()
  })

  it('shows a "Waiting on" step separately from "Ready now" steps', async () => {
    const detail = runDetail({
      steps: [
        {
          id: 'step-1', dbId: 'db-1', runId: 'run-1', stepIndex: 0,
          title: 'Plan the work', summary: '', prompt: 'Plan it', expectedOutput: '',
          dependsOnStepIds: undefined, status: 'not_started', startedAt: null, completedAt: null,
        },
        {
          id: 'step-2', dbId: 'db-2', runId: 'run-1', stepIndex: 1,
          title: 'Implement', summary: '', prompt: 'Implement it', expectedOutput: '',
          dependsOnStepIds: ['step-1'], status: 'not_started', startedAt: null, completedAt: null,
        },
      ],
    })
    mockApi.listManualWorkflowRuns.mockResolvedValue([runSummary()])
    mockApi.getManualWorkflowRun.mockResolvedValue(detail)
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Ship the feature'))

    await waitFor(() => expect(screen.getByText('Ready now')).toBeInTheDocument())
    expect(screen.getByText('Waiting on earlier steps')).toBeInTheDocument()
    expect(screen.getByText(/Waiting on: Plan the work/)).toBeInTheDocument()
  })

  it('"Start in chat" calls onStartWorkflowStep then marks the step started', async () => {
    const detail = runDetail()
    mockApi.listManualWorkflowRuns.mockResolvedValue([runSummary()])
    mockApi.getManualWorkflowRun.mockResolvedValue(detail)
    mockApi.updateManualWorkflowRunStepStatus.mockResolvedValue({
      ...detail,
      steps: detail.steps.map((s) => (s.id === 'step-2' ? { ...s, status: 'started', startedAt: 2000 } : s)),
    })
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))
    await waitFor(() => expect(screen.getByText(/2\. Implement/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /start in chat/i }))

    expect(onStartWorkflowStep).toHaveBeenCalledWith('agent-2', 'Implement it')
    await waitFor(() => {
      expect(mockApi.updateManualWorkflowRunStepStatus).toHaveBeenCalledWith('run-1', 'db-2', 'started')
    })
    await waitFor(() => expect(screen.getByText('Started')).toBeInTheDocument())
  })

  it('"Mark done" moves a step into Completed', async () => {
    const detail = runDetail()
    mockApi.listManualWorkflowRuns.mockResolvedValue([runSummary()])
    mockApi.getManualWorkflowRun.mockResolvedValue(detail)
    mockApi.updateManualWorkflowRunStepStatus.mockResolvedValue({
      ...detail,
      status: 'completed',
      steps: detail.steps.map((s) => (s.id === 'step-2' ? { ...s, status: 'done', completedAt: 3000 } : s)),
    })
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))
    await waitFor(() => expect(screen.getByText(/2\. Implement/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /mark done/i }))

    await waitFor(() => {
      expect(mockApi.updateManualWorkflowRunStepStatus).toHaveBeenCalledWith('run-1', 'db-2', 'done')
    })
    await waitFor(() => expect(screen.getByText(/Completed \(2\)/)).toBeInTheDocument())
    expect(screen.getByText(/Plan completed/)).toBeInTheDocument()
  })

  it('"Discard" removes the run from the list', async () => {
    mockApi.listManualWorkflowRuns.mockResolvedValue([runSummary()])
    mockApi.discardManualWorkflowRun.mockResolvedValue(true)
    window.confirm = vi.fn(() => true)
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /discard workflow plan/i }))

    await waitFor(() => expect(mockApi.discardManualWorkflowRun).toHaveBeenCalledWith('run-1'))
    await waitFor(() => expect(screen.queryByText('Ship the feature')).not.toBeInTheDocument())
  })
})
