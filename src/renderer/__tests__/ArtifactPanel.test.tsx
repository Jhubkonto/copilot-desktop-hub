import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArtifactPanel } from '../components/ArtifactPanel'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import { setupMockApi } from '../../test/mocks/api'
import type { ArtifactRow } from '../../shared/types'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

vi.mock('../components/ResizeHandle', () => ({ ResizeHandle: () => null }))

vi.mock('../components/ArtifactGeneratorModal', () => ({
  ArtifactGeneratorModal: () => <div data-testid="generator-modal" />,
}))

const ARTIFACT: ArtifactRow = {
  id: 'art-1',
  projectId: null,
  conversationId: null,
  title: 'Test Artifact',
  kind: 'document',
  description: 'A test artifact',
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
    title: 'Test Artifact',
    notes: null,
    specJson: null,
    manifestJson: '{}',
    sourceConversationId: null,
    sourceMessageId: null,
    createdByAgentIds: null,
    createdAt: 1000,
    files: [
      {
        id: 'f1',
        versionId: 'v1',
        relativePath: 'README.md',
        absolutePath: '/tmp/artifacts/README.md',
        mediaType: 'text/markdown',
        role: 'main',
        sizeBytes: 100,
        checksum: null,
      },
    ],
  },
}

let mockStore: ReturnType<typeof createMockAppStore>
let mockApi: ReturnType<typeof setupMockApi>

beforeEach(() => {
  vi.clearAllMocks()
  mockApi = setupMockApi()
  mockApi.artifactGet.mockResolvedValue(ARTIFACT)
  mockApi.artifactListVersions.mockResolvedValue([ARTIFACT.currentVersion!])
  mockStore = createMockAppStore({
    projects: [{ id: 'p1', name: 'Project Alpha', color: 'blue', created_at: 0, default_model: null }],
    currentConversationId: 'conv-1',
    viewingArtifactId: 'art-1',
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('ArtifactPanel', () => {
  it('renders the artifact title after loading', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => {
      expect(screen.getByText('Test Artifact')).toBeInTheDocument()
    })
  })

  it('calls closeArtifactPanel when X button is clicked', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    const closeBtn = screen.getByRole('button', { name: /close artifact panel/i })
    await userEvent.click(closeBtn)
    expect(mockStore.closeArtifactPanel).toHaveBeenCalled()
  })

  it('renders the Details and History tabs', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    expect(screen.getByRole('button', { name: /details/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /history/i })).toBeInTheDocument()
  })

  it('shows an export button for the current version in Details tab', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    expect(screen.getByRole('button', { name: /export current version/i })).toBeInTheDocument()
  })

  it('downloads the current version to a user-selected directory', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    await userEvent.click(screen.getByRole('button', { name: /^download$/i }))
    expect(mockApi.artifactDownload).toHaveBeenCalledWith('v1', 'raw-files')
  })

  it('shows artifact description in Details tab', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => {
      expect(screen.getByText('A test artifact')).toBeInTheDocument()
    })
  })

  it('calls requestArtifactAttach when "Use in Chat" is clicked', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    const useBtn = screen.getByRole('button', { name: /use in chat/i })
    await userEvent.click(useBtn)
    expect(mockStore.requestArtifactAttach).toHaveBeenCalledWith('art-1', 'v1')
  })

  it('shows confirm flow when Delete is clicked', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    const deleteBtn = screen.getByRole('button', { name: /^delete$/i })
    await userEvent.click(deleteBtn)
    expect(screen.getByText('Delete "Test Artifact"?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete artifact/i })).toBeInTheDocument()
  })

  it('calls artifactDelete and closes panel on confirm delete', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await userEvent.click(screen.getByRole('button', { name: /delete artifact/i }))
    await waitFor(() => {
      expect(mockApi.artifactDelete).toHaveBeenCalledWith('art-1')
      expect(mockStore.closeArtifactPanel).toHaveBeenCalled()
    })
  })

  it('cancels delete on Cancel click', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockApi.artifactDelete).not.toHaveBeenCalled()
  })

  it('shows version list in History tab', async () => {
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    await userEvent.click(screen.getByRole('button', { name: /history/i }))
    await waitFor(() => {
      expect(screen.getByText(/v1/)).toBeInTheDocument()
    })
  })

  it('does not show "Use in Chat" when no conversation is open', async () => {
    mockStore = createMockAppStore({
      projects: [],
      currentConversationId: null,
      viewingArtifactId: 'art-1',
    })
    setupStoreMock(useAppStore, mockStore)
    render(<ArtifactPanel artifactId="art-1" />)
    await waitFor(() => screen.getByText('Test Artifact'))
    expect(screen.queryByRole('button', { name: /use in chat/i })).not.toBeInTheDocument()
  })
})
