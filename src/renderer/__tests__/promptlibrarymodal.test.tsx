import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PromptLibraryModal } from '../../renderer/components/PromptLibraryModal'
import { setupMockApi } from '../../test/mocks/api'

beforeEach(() => {
  setupMockApi()
})

describe('PromptLibraryModal', () => {
  it('opens on the save form with message content prefilled', async () => {
    render(
      <PromptLibraryModal
        projectId="project-1"
        projectName="Nexy"
        draftContent={'Review this implementation\nfor correctness.'}
        initialMode="save"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByRole('heading', { name: 'Save a prompt' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Review this implementation')
    expect(screen.getByLabelText('Prompt')).toHaveValue(
      'Review this implementation\nfor correctness.'
    )
    expect(screen.getByLabelText('Scope')).toHaveValue('project')
  })
})
