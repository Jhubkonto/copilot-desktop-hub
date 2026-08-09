import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProjectsPane } from '../components/section-pane/ProjectsPane'
import { setupMockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn(),
}))

vi.mock('../store/app-store', () => ({
  useAppStore,
}))

const SAMPLE_PROJECT = {
  id: 'project-1',
  name: 'Nexy Development',
  color: 'blue',
  created_at: 1000,
  updated_at: 1000,
}

function setup(overrides: Record<string, unknown> = {}) {
  setupMockApi()
  const mockStore = createMockAppStore({
    projects: [SAMPLE_PROJECT],
    ...overrides,
  })
  setupStoreMock(useAppStore, mockStore)
  return mockStore
}

describe('ProjectsPane', () => {
  it('does not render or subscribe to the retired Code Changes activity state', () => {
    setup()
    render(<ProjectsPane />)

    expect(screen.queryByTitle(/Code Changes request/)).toBeNull()
  })
})
