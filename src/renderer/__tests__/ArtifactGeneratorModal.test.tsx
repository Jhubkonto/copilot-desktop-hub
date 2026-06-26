import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArtifactGeneratorModal } from '../components/ArtifactGeneratorModal'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'
import { setupMockApi } from '../../test/mocks/api'

const { useAppStore } = vi.hoisted(() => ({ useAppStore: vi.fn() }))
vi.mock('../store/app-store', () => ({ useAppStore }))

vi.mock('../components/chat/ModelPicker', () => ({
  ModelPicker: () => null,
}))

vi.mock('../components/chat/VoiceInputButton', () => ({
  VoiceInputButton: () => null,
}))

let mockStore: ReturnType<typeof createMockAppStore>
let mockApi: ReturnType<typeof setupMockApi>
const onClose = vi.fn()
const onArtifactCreated = vi.fn()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (arg: any) => void
type MockableEvent = { mockImplementation: (fn: (listener: Listener) => () => void) => void }

function captureListener(
  mockFn: MockableEvent,
): { trigger: (arg: unknown) => void } {
  let listener: Listener | undefined
  mockFn.mockImplementation((fn: Listener) => {
    listener = fn
    return () => {}
  })
  return {
    trigger: (arg) => { if (listener) listener(arg) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi = setupMockApi()
  mockStore = createMockAppStore({
    catalogModels: [],
    globalDefaultModel: 'default',
    projects: [],
    activeProjectId: null,
  })
  setupStoreMock(useAppStore, mockStore)
})

const SPEC = {
  title: 'My Doc',
  kind: 'document',
  intendedUse: 'Reference doc',
  audience: 'Devs',
  outputFiles: [],
  acceptanceCriteria: [],
}

describe('ArtifactGeneratorModal', () => {
  it('renders the modal with initial greeting', () => {
    render(<ArtifactGeneratorModal onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: /generate new artifact/i })).toBeInTheDocument()
    expect(screen.getByText(/let's create an artifact/i)).toBeInTheDocument()
  })

  it('closes when X button is clicked', async () => {
    render(<ArtifactGeneratorModal onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows spec preview panel on the left', () => {
    render(<ArtifactGeneratorModal onClose={onClose} />)
    expect(screen.getAllByText(/artifact spec/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/will appear here/i)).toBeInTheDocument()
  })

  it('sends a message when Enter is pressed in the input', async () => {
    mockApi.artifactGeneratorChat.mockResolvedValue({ started: true })
    render(<ArtifactGeneratorModal onClose={onClose} />)
    const input = screen.getByPlaceholderText(/describe the artifact/i)
    await userEvent.type(input, 'Build me a readme{Enter}')
    await waitFor(() => {
      expect(mockApi.artifactGeneratorChat).toHaveBeenCalled()
    })
  })

  it('renders the EditForm when Edit button is clicked after spec is ready', async () => {
    const spec = captureListener(
      mockApi.onArtifactGeneratorSpecReady as unknown as MockableEvent,
    )
    render(<ArtifactGeneratorModal onClose={onClose} />)
    spec.trigger(SPEC)

    await waitFor(() => {
      expect(screen.getByText(/spec ready/i)).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))

    await waitFor(() => {
      expect(screen.getByText(/edit artifact spec/i)).toBeInTheDocument()
    })
  })

  it('EditForm shows all editable fields', async () => {
    const spec = captureListener(
      mockApi.onArtifactGeneratorSpecReady as unknown as MockableEvent,
    )
    render(<ArtifactGeneratorModal onClose={onClose} />)
    spec.trigger({ ...SPEC, intendedUse: 'A doc' })

    await waitFor(() => screen.getByText(/spec ready/i))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/artifact title/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/what is this artifact for/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/who is this for/i)).toBeInTheDocument()
    })
  })

  it('EditForm Back button returns to spec preview', async () => {
    const spec = captureListener(
      mockApi.onArtifactGeneratorSpecReady as unknown as MockableEvent,
    )
    render(<ArtifactGeneratorModal onClose={onClose} />)
    spec.trigger({ ...SPEC, intendedUse: 'A doc' })

    await waitFor(() => screen.getByText(/spec ready/i))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByText(/edit artifact spec/i))

    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.queryByText(/edit artifact spec/i)).not.toBeInTheDocument()
      expect(screen.getByText(/spec ready/i)).toBeInTheDocument()
    })
  })

  it('renders DoneOverlay with "Generate another" and "Done" buttons when isDone', async () => {
    const spec = captureListener(
      mockApi.onArtifactGeneratorSpecReady as unknown as MockableEvent,
    )
    const done = captureListener(
      mockApi.onArtifactGeneratorDone as unknown as MockableEvent,
    )
    mockApi.artifactGeneratorGenerate.mockResolvedValue({ started: true })
    mockApi.artifactGeneratorGetRuns.mockResolvedValue([
      { id: 'run-1', artifactId: 'art-1', title: 'My Doc', status: 'done', specJson: null, createdAt: 0, updatedAt: 0 },
    ])

    render(<ArtifactGeneratorModal onClose={onClose} onArtifactCreated={onArtifactCreated} />)
    spec.trigger(SPEC)

    await waitFor(() => screen.getByText(/spec ready/i))
    await userEvent.click(screen.getByRole('button', { name: /generate artifact/i }))

    done.trigger({ hasSpec: true })

    await waitFor(() => {
      expect(screen.getByText(/artifact created!/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /generate another/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
    })
  })

  it('DoneOverlay "Generate another" resets to chat phase', async () => {
    const spec = captureListener(
      mockApi.onArtifactGeneratorSpecReady as unknown as MockableEvent,
    )
    mockApi.artifactGeneratorGenerate.mockResolvedValue({ started: true })
    mockApi.artifactGeneratorGetRuns.mockResolvedValue([
      { id: 'run-1', artifactId: 'art-1', title: 'My Doc', status: 'done', specJson: null, createdAt: 0, updatedAt: 0 },
    ])

    render(<ArtifactGeneratorModal onClose={onClose} onArtifactCreated={onArtifactCreated} />)
    spec.trigger({ ...SPEC, intendedUse: '', audience: '' })

    await waitFor(() => screen.getByText(/spec ready/i))
    await userEvent.click(screen.getByRole('button', { name: /generate artifact/i }))

    await waitFor(() => screen.getByText(/artifact created!/i))
    await userEvent.click(screen.getByRole('button', { name: /generate another/i }))

    await waitFor(() => {
      expect(screen.queryByText(/artifact created!/i)).not.toBeInTheDocument()
      expect(screen.getByText(/let's create an artifact/i)).toBeInTheDocument()
    })
  })

  it('"Done" button in DoneOverlay calls onClose', async () => {
    const spec = captureListener(
      mockApi.onArtifactGeneratorSpecReady as unknown as MockableEvent,
    )
    mockApi.artifactGeneratorGenerate.mockResolvedValue({ started: true })
    mockApi.artifactGeneratorGetRuns.mockResolvedValue([
      { id: 'run-1', artifactId: 'art-1', title: 'My Doc', status: 'done', specJson: null, createdAt: 0, updatedAt: 0 },
    ])

    render(<ArtifactGeneratorModal onClose={onClose} onArtifactCreated={onArtifactCreated} />)
    spec.trigger({ ...SPEC, intendedUse: '', audience: '' })

    await waitFor(() => screen.getByText(/spec ready/i))
    await userEvent.click(screen.getByRole('button', { name: /generate artifact/i }))

    await waitFor(() => screen.getByText(/artifact created!/i))
    await userEvent.click(screen.getByRole('button', { name: /^done$/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
