import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RemoteEditPanel } from '../components/RemoteEditPanel'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn(),
}))

vi.mock('../store/app-store', () => ({
  useAppStore,
}))

let mockApi: MockApi
let mockStore: ReturnType<typeof createMockAppStore>
const user = userEvent.setup()

const SAMPLE_REPORT = {
  id: 'report-1',
  title: 'Fix the flaky test',
  description: 'Investigate and patch.',
  status: 'open',
  request_type: 'bugfix',
  request_origin: 'legacy-bug-report',
  workspace_root: null,
  project_id: null,
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
    showRemoteEditPanel: true,
    catalogModels: [],
    ...overrides,
  })
  setupStoreMock(useAppStore, mockStore)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RemoteEditPanel delete flow', () => {
  it('deletes a report and shows a success toast when the IPC call succeeds', async () => {
    setup()
    mockApi.deleteErrorReport = vi.fn().mockResolvedValue(true)
    render(<RemoteEditPanel />)

    await waitFor(() => expect(screen.getAllByText('Fix the flaky test').length).toBeGreaterThan(0))

    await user.click(screen.getByRole('button', { name: 'Delete Fix the flaky test' }))

    const confirmButton = await screen.findByRole('button', { name: /delete request/i })
    await user.click(confirmButton)

    await waitFor(() => expect(mockApi.deleteErrorReport).toHaveBeenCalledWith('report-1'))
    await waitFor(() => expect(mockStore.addToast).toHaveBeenCalledWith('Change request deleted', 'success'))
  })

  it('keeps the report and shows an error toast when the IPC call fails', async () => {
    setup()
    mockApi.deleteErrorReport = vi.fn().mockResolvedValue({ error: 'Database is locked' })
    render(<RemoteEditPanel />)

    await waitFor(() => expect(screen.getAllByText('Fix the flaky test').length).toBeGreaterThan(0))

    await user.click(screen.getByRole('button', { name: 'Delete Fix the flaky test' }))

    const confirmButton = await screen.findByRole('button', { name: /delete request/i })
    await user.click(confirmButton)

    await waitFor(() => expect(mockApi.deleteErrorReport).toHaveBeenCalledWith('report-1'))
    await waitFor(() => expect(mockStore.addToast).toHaveBeenCalledWith('Database is locked', 'error'))
    expect(screen.getAllByText('Fix the flaky test').length).toBeGreaterThan(0)
  })
})

describe('RemoteEditPanel list and detail views', () => {
  const SECOND_REPORT = {
    ...SAMPLE_REPORT,
    id: 'report-2',
    title: 'Add retry logic',
    status: 'investigating',
    investigation_markdown: 'Looked at the retry path.',
  }

  it('shows a phase badge for each report in the list', async () => {
    setup()
    mockApi.listErrorReports = vi.fn().mockResolvedValue([SAMPLE_REPORT, SECOND_REPORT])
    render(<RemoteEditPanel />)

    await waitFor(() => expect(screen.getAllByText('Fix the flaky test').length).toBeGreaterThan(0))
    expect(screen.getAllByText(/Draft/).length).toBeGreaterThan(0)
    expect(screen.getByText('Add retry logic')).toBeInTheDocument()
    expect(screen.getAllByText(/Investigating/).length).toBeGreaterThan(0)
  })

  it('selects a report and shows its detail when its list row is clicked', async () => {
    setup()
    mockApi.listErrorReports = vi.fn().mockResolvedValue([SAMPLE_REPORT, SECOND_REPORT])
    render(<RemoteEditPanel />)

    await waitFor(() => expect(screen.getAllByText('Fix the flaky test').length).toBeGreaterThan(0))
    expect(screen.getByText('Investigate and patch.')).toBeInTheDocument()

    await user.click(screen.getByText('Add retry logic'))

    await waitFor(() => expect(screen.getAllByText('Add retry logic').length).toBeGreaterThan(0))
  })

  it('shows the phase-derived primary guidance for the selected report', async () => {
    setup()
    render(<RemoteEditPanel />)

    await waitFor(() => expect(screen.getAllByText('Fix the flaky test').length).toBeGreaterThan(0))
    expect(screen.getByText(/Next step: Draft/)).toBeInTheDocument()
    expect(screen.getByText('Run an investigation to identify the files and approach.')).toBeInTheDocument()
  })

  it('toggles the investigation section via progressive disclosure', async () => {
    setup()
    mockApi.listErrorReports = vi.fn().mockResolvedValue([SECOND_REPORT])
    render(<RemoteEditPanel />)

    await waitFor(() => expect(screen.getAllByText('Add retry logic').length).toBeGreaterThan(0))

    const toggle = await screen.findByRole('button', { name: /hide investigation/i })
    expect(screen.getByText('Looked at the retry path.')).toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByRole('button', { name: /show investigation/i })).toBeInTheDocument()
    expect(screen.queryByText('Looked at the retry path.')).not.toBeInTheDocument()
  })
})
