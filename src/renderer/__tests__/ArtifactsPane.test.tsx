import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArtifactsPane } from '../components/section-pane/ArtifactsPane'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import { setupMockApi } from '../../test/mocks/api'
import type { ArtifactRow } from '../../shared/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

const ARTIFACT_READY: ArtifactRow = {
  id: 'art-1',
  projectId: null,
  conversationId: null,
  title: 'My Readme',
  kind: 'document',
  description: 'A readme file',
  storageRoot: '/tmp/artifacts',
  currentVersionId: 'v1',
  status: 'ready',
  errorMessage: null,
  createdAt: 1000,
  updatedAt: 1000,
  currentVersion: {
    id: 'v1',
    artifactId: 'art-1',
    versionNumber: 1,
    title: 'My Readme',
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
  mockApi.artifactList.mockResolvedValue([ARTIFACT_READY])
  mockStore = createMockAppStore({
    projects: [],
    pendingArtifactGeneration: null,
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('ArtifactsPane', () => {
  it('renders the artifact count and search input', async () => {
    render(<ArtifactsPane />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search artifacts/i)).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('1 artifact')).toBeInTheDocument()
    })
  })

  it('calls artifactList on mount', async () => {
    render(<ArtifactsPane />)
    await waitFor(() => {
      expect(mockApi.artifactList).toHaveBeenCalledWith()
    })
  })

  it('renders artifact rows after loading', async () => {
    render(<ArtifactsPane />)
    await waitFor(() => {
      expect(screen.getByText('My Readme')).toBeInTheDocument()
    })
  })

  it('shows empty message when no artifacts', async () => {
    mockApi.artifactList.mockResolvedValue([])
    render(<ArtifactsPane />)
    await waitFor(() => {
      expect(screen.getByText(/^no artifacts yet$/i)).toBeInTheDocument()
    })
  })

  it('filters artifacts by search query', async () => {
    const anotherArtifact: ArtifactRow = {
      ...ARTIFACT_READY,
      id: 'art-2',
      title: 'Other Thing',
    }
    mockApi.artifactList.mockResolvedValue([ARTIFACT_READY, anotherArtifact])
    render(<ArtifactsPane />)

    await waitFor(() => {
      expect(screen.getByText('My Readme')).toBeInTheDocument()
      expect(screen.getByText('Other Thing')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/search artifacts/i)
    await userEvent.type(searchInput, 'Readme')

    await waitFor(() => {
      expect(screen.getByText('My Readme')).toBeInTheDocument()
      expect(screen.queryByText('Other Thing')).not.toBeInTheDocument()
    })
  })

  it('does not offer standalone artifact generation', async () => {
    render(<ArtifactsPane />)
    await waitFor(() => expect(screen.getByText('1 artifact')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /artifact generator/i })).not.toBeInTheDocument()
  })

  it('calls openArtifactPanel when a row is clicked', async () => {
    render(<ArtifactsPane />)
    await waitFor(() => {
      expect(screen.getByText('My Readme')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('My Readme'))
    expect(mockStore.openArtifactPanel).toHaveBeenCalledWith('art-1')
  })

  it('calls artifactDelete when delete icon is clicked', async () => {
    render(<ArtifactsPane />)
    await waitFor(() => {
      expect(screen.getByText('My Readme')).toBeInTheDocument()
    })
    const deleteBtn = screen.getByRole('button', { name: /delete my readme/i })
    await userEvent.click(deleteBtn)
    await waitFor(() => {
      expect(mockApi.artifactDelete).toHaveBeenCalledWith('art-1')
    })
  })

  it('shows pending generation indicator from store', async () => {
    mockStore = createMockAppStore({
      projects: [],
      pendingArtifactGeneration: { title: 'Pending Art', kind: 'code', startedAt: Date.now() },
    })
    setupStoreMock(useAppStore, mockStore)
    render(<ArtifactsPane />)
    await waitFor(() => {
      expect(screen.getByText('Pending Art')).toBeInTheDocument()
    })
  })

  it('shows scope filter pills', async () => {
    render(<ArtifactsPane />)
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^project$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^global$/i })).not.toBeInTheDocument()
  })
})
