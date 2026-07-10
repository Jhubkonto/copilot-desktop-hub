import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AutomatedWorkflowTab } from '../AutomatedWorkflowTab'
import { createMockAppStore, setupStoreMock } from '../../../../test/mocks/store'
import { setupMockApi } from '../../../../test/mocks/api'
import { DEFAULT_PROJECT_CONFIG } from '../../../../shared/types'
import type { AutomatedWorkflowRunDetail, AutomatedWorkflowRunStep, AutomatedWorkflowRunSummary } from '../../../../shared/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../../store/app-store', () => ({ useAppStore }))

let mockStore: ReturnType<typeof createMockAppStore>
let mockApi: ReturnType<typeof setupMockApi>
let onOpenConversation: ReturnType<typeof vi.fn<(conversationId: string) => void>>
let onToast: ReturnType<typeof vi.fn<(message: string, type: 'success' | 'error' | 'info') => void>>

const PROJECT_CONFIG = { ...DEFAULT_PROJECT_CONFIG, workflowMode: 'automated-delegation' as const }

function runSummary(overrides: Partial<AutomatedWorkflowRunSummary> = {}): AutomatedWorkflowRunSummary {
  return {
    id: 'run-1',
    projectId: 'proj-1',
    title: 'Ship the feature',
    goalSummary: 'Get it shipped',
    model: null,
    status: 'pending',
    confirmationMode: 'gated',
    currentStepId: null,
    lastError: null,
    stepCounts: { total: 2, pending: 2, running: 0, awaitingConfirmation: 0, done: 0, failed: 0, skipped: 0 },
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function baseStep(overrides: Partial<AutomatedWorkflowRunStep> = {}): AutomatedWorkflowRunStep {
  return {
    id: 'step-1', dbId: 'db-1', runId: 'run-1', stepIndex: 0,
    title: 'Plan the work', summary: 'Break it down', prompt: 'Plan it', expectedOutput: 'A plan',
    agentId: 'agent-1', agentName: 'Planner', dependsOnStepIds: undefined,
    status: 'pending', attempt: 0, output: '', error: null, conversationId: null, startedAt: null, completedAt: null,
    ...overrides,
  }
}

function runDetail(overrides: Partial<AutomatedWorkflowRunDetail> = {}): AutomatedWorkflowRunDetail {
  return {
    ...runSummary(),
    assumptions: ['Team has staging access'],
    steps: [
      baseStep(),
      baseStep({ id: 'step-2', dbId: 'db-2', stepIndex: 1, title: 'Implement', summary: 'Write the code', prompt: 'Implement it', expectedOutput: 'Working code', agentId: 'agent-2', agentName: 'Builder', dependsOnStepIds: ['step-1'] }),
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi = setupMockApi()
  mockApi.listAutomatedWorkflowRuns.mockResolvedValue([])
  onOpenConversation = vi.fn<(conversationId: string) => void>()
  onToast = vi.fn<(message: string, type: 'success' | 'error' | 'info') => void>()
  mockStore = createMockAppStore({
    authState: { authenticated: true, mode: 'byok', user: null, cliInstalled: false, clis: { claude: false, codex: false } },
  })
  setupStoreMock(useAppStore, mockStore)
})

function renderTab() {
  return render(
    <AutomatedWorkflowTab
      projectId="proj-1"
      members={[]}
      projectConfig={PROJECT_CONFIG}
      onOpenConversation={onOpenConversation}
      onToast={onToast}
    />,
  )
}

describe('AutomatedWorkflowTab', () => {
  it('explains the automated-delegation purpose', async () => {
    renderTab()
    await waitFor(() => expect(mockApi.listAutomatedWorkflowRuns).toHaveBeenCalledWith('proj-1'))

    expect(screen.getByText('Automated delegation execution plan')).toBeInTheDocument()
  })

  it('shows the chat generator directly when there are no existing runs', async () => {
    renderTab()
    await waitFor(() => expect(mockApi.listAutomatedWorkflowRuns).toHaveBeenCalled())

    expect(screen.getByPlaceholderText(/describe the project goal/i)).toBeInTheDocument()
  })

  it('shows a resumable runs list on mount when runs already exist', async () => {
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary()])
    renderTab()

    await waitFor(() => {
      expect(screen.getByText('Ship the feature')).toBeInTheDocument()
    })
    expect(screen.getByText(/0\/2 steps done/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start a new workflow/i })).toBeInTheDocument()
  })

  it('a pending run shows a "Start workflow" button and the confirmation-mode toggle', async () => {
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary()])
    mockApi.getAutomatedWorkflowRun.mockResolvedValue(runDetail())
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))

    await waitFor(() => expect(screen.getByRole('button', { name: /start workflow/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /confirm each step/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run automatically/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /start workflow/i }))
    expect(mockApi.startAutomatedWorkflowRun).toHaveBeenCalledWith('run-1')
  })

  it('switching to "Run automatically" calls setAutomatedWorkflowConfirmationMode', async () => {
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary()])
    mockApi.getAutomatedWorkflowRun.mockResolvedValue(runDetail())
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))
    await waitFor(() => expect(screen.getByRole('button', { name: /run automatically/i })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /run automatically/i }))
    expect(mockApi.setAutomatedWorkflowConfirmationMode).toHaveBeenCalledWith('run-1', 'auto')
  })

  it('shows "Waiting on" for a pending step blocked by an unfinished dependency', async () => {
    const detail = runDetail()
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary()])
    mockApi.getAutomatedWorkflowRun.mockResolvedValue(detail)
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))

    await waitFor(() => expect(screen.getByText(/2\. Implement/)).toBeInTheDocument())
    expect(screen.getByText(/Waiting on: Plan the work/)).toBeInTheDocument()
  })

  it('a running step streams live output and offers no manual action', async () => {
    const detail = runDetail({
      status: 'running',
      steps: [baseStep({ status: 'running' }), baseStep({ id: 'step-2', dbId: 'db-2', stepIndex: 1, status: 'pending', dependsOnStepIds: ['step-1'] })],
    })
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary({ status: 'running' })])
    mockApi.getAutomatedWorkflowRun.mockResolvedValue(detail)
    let emitStream!: (data: { runId: string; stepDbId: string; chunk: string }) => void
    mockApi.onAutomatedWorkflowStepStream.mockImplementation((callback: (data: { runId: string; stepDbId: string; chunk: string }) => void) => {
      emitStream = callback
      return () => {}
    })
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))
    await waitFor(() => expect(screen.getByText(/1\. Plan the work/)).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /abort run/i })).toBeInTheDocument()

    emitStream({ runId: 'run-1', stepDbId: 'db-1', chunk: 'Thinking about the plan…' })
    await waitFor(() => expect(screen.getByText(/Thinking about the plan…/)).toBeInTheDocument())
  })

  it('an awaiting_confirmation step shows an editable output and an Approve button', async () => {
    const detail = runDetail({
      status: 'awaiting_confirmation',
      steps: [
        baseStep({ status: 'awaiting_confirmation', output: 'Here is the plan.', conversationId: 'conv-1' }),
        baseStep({ id: 'step-2', dbId: 'db-2', stepIndex: 1, status: 'pending', dependsOnStepIds: ['step-1'] }),
      ],
    })
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary({ status: 'awaiting_confirmation' })])
    mockApi.getAutomatedWorkflowRun.mockResolvedValue(detail)
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))

    await waitFor(() => expect(screen.getByDisplayValue('Here is the plan.')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /approve & continue/i }))
    expect(mockApi.confirmAutomatedWorkflowStep).toHaveBeenCalledWith('run-1', 'db-1', undefined)

    await userEvent.click(screen.getByRole('button', { name: /open conversation/i }))
    expect(onOpenConversation).toHaveBeenCalledWith('conv-1')
  })

  it('approving with edited output passes the edited text', async () => {
    const detail = runDetail({
      status: 'awaiting_confirmation',
      steps: [baseStep({ status: 'awaiting_confirmation', output: 'Original output' })],
    })
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary({ status: 'awaiting_confirmation' })])
    mockApi.getAutomatedWorkflowRun.mockResolvedValue(detail)
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))
    await waitFor(() => expect(screen.getByDisplayValue('Original output')).toBeInTheDocument())

    const textarea = screen.getByDisplayValue('Original output')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Edited output')
    await userEvent.click(screen.getByRole('button', { name: /approve & continue/i }))

    expect(mockApi.confirmAutomatedWorkflowStep).toHaveBeenCalledWith('run-1', 'db-1', 'Edited output')
  })

  it('a failed step shows the error and Retry/Skip actions', async () => {
    const detail = runDetail({
      status: 'failed',
      lastError: 'No provider configured',
      steps: [baseStep({ status: 'failed', error: 'No provider configured' })],
    })
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary({ status: 'failed' })])
    mockApi.getAutomatedWorkflowRun.mockResolvedValue(detail)
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))

    await waitFor(() => expect(screen.getAllByText('No provider configured').length).toBeGreaterThan(0))
    await userEvent.click(screen.getByRole('button', { name: /^retry$/i }))
    expect(mockApi.retryAutomatedWorkflowStep).toHaveBeenCalledWith('run-1', 'db-1')

    await userEvent.click(screen.getByRole('button', { name: /^skip$/i }))
    expect(mockApi.skipAutomatedWorkflowStep).toHaveBeenCalledWith('run-1', 'db-1')
  })

  it('a done step renders collapsed with its output behind a disclosure', async () => {
    const detail = runDetail({
      status: 'done',
      steps: [
        baseStep({ status: 'done', output: 'Plan output here' }),
        baseStep({ id: 'step-2', dbId: 'db-2', stepIndex: 1, status: 'done', output: 'Build output here', dependsOnStepIds: ['step-1'] }),
      ],
    })
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary({ status: 'done' })])
    mockApi.getAutomatedWorkflowRun.mockResolvedValue(detail)
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Ship the feature'))

    await waitFor(() => expect(screen.getByText(/Plan completed/)).toBeInTheDocument())
    // <details> content is present in the DOM (RTL's text queries don't respect the native
    // open/closed disclosure state) — assert the disclosure structure exists instead.
    expect(screen.getByText('Plan output here').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/1\. Plan the work/)).toBeInTheDocument()
  })

  it('"Discard" removes the run from the list', async () => {
    mockApi.listAutomatedWorkflowRuns.mockResolvedValue([runSummary()])
    mockApi.discardAutomatedWorkflowRun.mockResolvedValue(true)
    window.confirm = vi.fn(() => true)
    renderTab()
    await waitFor(() => expect(screen.getByText('Ship the feature')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /discard workflow plan/i }))

    await waitFor(() => expect(mockApi.discardAutomatedWorkflowRun).toHaveBeenCalledWith('run-1'))
    await waitFor(() => expect(screen.queryByText('Ship the feature')).not.toBeInTheDocument())
  })
})
