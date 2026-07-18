import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupMockApi } from '../../test/mocks/api'
import { ArtifactCard } from '../components/artifacts/ArtifactCard'

let api: ReturnType<typeof setupMockApi>

beforeEach(() => {
  vi.clearAllMocks()
  api = setupMockApi()
})

describe('ArtifactCard missing artifacts', () => {
  it('uses the referenced kind for a deleted artifact', async () => {
    api.artifactGet.mockResolvedValue(null)

    render(<ArtifactCard artifactId="deleted-quiz" referencedKind="quiz" />)

    expect(await screen.findByText('Quiz deleted')).toBeInTheDocument()
    expect(screen.queryByText('Loading artifact…')).not.toBeInTheDocument()
  })

  it('uses a generic label when the referenced kind is unknown', async () => {
    api.artifactGet.mockResolvedValue(null)

    render(<ArtifactCard artifactId="deleted-artifact" />)

    expect(await screen.findByText('Artifact deleted')).toBeInTheDocument()
  })

  it('does not report an IPC failure as a deletion', async () => {
    api.artifactGet.mockRejectedValue(new Error('IPC unavailable'))

    render(<ArtifactCard artifactId="temporarily-unavailable" referencedKind="quiz" />)

    expect(await screen.findByText('Artifact unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Quiz deleted')).not.toBeInTheDocument()
  })
})
