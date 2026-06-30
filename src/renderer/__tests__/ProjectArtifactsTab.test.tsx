import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectArtifactsTab } from '../components/project-settings/ProjectArtifactsTab'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import { setupMockApi } from '../../test/mocks/api'
import type { ArtifactRow } from '../../shared/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

vi.mock('../components/ArtifactGeneratorModal', () => ({
  ArtifactGeneratorModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="generator-modal">
      <button onClick={onClose}>Close generator</button>
    </div>
  ),
}))

const PROJECT_ARTIFACT: ArtifactRow = {
  id: 'art-p1',
  projectId: 'proj-1',
  title: 'Project Doc',
  kind: 'document',
  description: 'A project document',
  storageRoot: '/tmp/artifacts',
  currentVersionId: 'v1',
  status: 'ready',
  createdAt: 1000,
  updatedAt: 1000,
  currentVersion: {
    id: 'v1',
    artifactId: 'art-p1',
    versionNumber: 1,
    title: 'Project Doc',
    notes: null,
    specJson: null,
    manifestJson: '{}',
    sourceConversationId: null,
    sourceMessageId: null,
    createdByAgentIds: null,
    createdAt: 1000,
    files: [],
  },
}

let mockStore: ReturnType<typeof createMockAppStore>
let mockApi: ReturnType<typeof setupMockApi>

beforeEach(() => {
  vi.clearAllMocks()
  mockApi = setupMockApi()
  mockApi.artifactList.mockResolvedValue([PROJECT_ARTIFACT])
  mockStore = createMockAppStore({
    pendingArtifactGeneration: null,
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('ProjectArtifactsTab', () => {
  it('calls artifactList with the projectId on mount', async () => {
    render(<ProjectArtifactsTab projectId="proj-1" />)
    await waitFor(() => {
      expect(mockApi.artifactList).toHaveBeenCalledWith('proj-1')
    })
  })

  it('renders search input and artifact count', async () => {
    render(<ProjectArtifactsTab projectId="proj-1" />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search artifacts/i)).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('1 artifact')).toBeInTheDocument()
    })
  })

  it('renders artifact rows', async () => {
    render(<ProjectArtifactsTab projectId="proj-1" />)
    await waitFor(() => {
      expect(screen.getByText('Project Doc')).toBeInTheDocument()
    })
  })

  it('shows empty message when no artifacts', async () => {
    mockApi.artifactList.mockResolvedValue([])
    render(<ProjectArtifactsTab projectId="proj-1" />)
    await waitFor(() => {
      expect(screen.getByText(/no artifacts for this project yet/i)).toBeInTheDocument()
    })
  })

  it('filters artifacts by search query', async () => {
    const other: ArtifactRow = { ...PROJECT_ARTIFACT, id: 'art-p2', title: 'Other File' }
    mockApi.artifactList.mockResolvedValue([PROJECT_ARTIFACT, other])
    render(<ProjectArtifactsTab projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('Project Doc')).toBeInTheDocument()
      expect(screen.getByText('Other File')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByPlaceholderText(/search artifacts/i), 'Project')

    await waitFor(() => {
      expect(screen.getByText('Project Doc')).toBeInTheDocument()
      expect(screen.queryByText('Other File')).not.toBeInTheDocument()
    })
  })

  it('calls openArtifactPanel when a row is clicked', async () => {
    render(<ProjectArtifactsTab projectId="proj-1" />)
    await waitFor(() => {
      expect(screen.getByText('Project Doc')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('Project Doc'))
    expect(mockStore.openArtifactPanel).toHaveBeenCalledWith('art-p1')
  })

  it('calls artifactDelete when delete icon is clicked', async () => {
    render(<ProjectArtifactsTab projectId="proj-1" />)
    await waitFor(() => {
      expect(screen.getByText('Project Doc')).toBeInTheDocument()
    })
    const deleteBtn = screen.getByRole('button', { name: /delete project doc/i })
    await userEvent.click(deleteBtn)
    await waitFor(() => {
      expect(mockApi.artifactDelete).toHaveBeenCalledWith('art-p1')
    })
  })

  it('opens generator modal when generator button is clicked', async () => {
    render(<ProjectArtifactsTab projectId="proj-1" />)
    await userEvent.click(screen.getByRole('button', { name: /open artifact generator/i }))
    await waitFor(() => {
      expect(screen.getByTestId('generator-modal')).toBeInTheDocument()
    })
  })

  it('shows pending generation indicator when store has pendingArtifactGeneration', async () => {
    mockStore = createMockAppStore({
      pendingArtifactGeneration: { title: 'Generating Now', kind: 'code', startedAt: Date.now() },
    })
    setupStoreMock(useAppStore, mockStore)
    render(<ProjectArtifactsTab projectId="proj-1" />)
    await waitFor(() => {
      expect(screen.getByText('Generating Now')).toBeInTheDocument()
    })
  })

  it('calls artifactList once on initial mount', async () => {
    render(<ProjectArtifactsTab projectId="proj-1" />)
    await waitFor(() => {
      expect(mockApi.artifactList).toHaveBeenCalledTimes(1)
      expect(mockApi.artifactList).toHaveBeenCalledWith('proj-1')
    })
  })
})
