import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProjectsPane } from '../components/section-pane/ProjectsPane'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn(),
}))

vi.mock('../store/app-store', () => ({
  useAppStore,
}))

let mockApi: MockApi

const SAMPLE_PROJECT = {
  id: 'project-1',
  name: 'Nexy Development',
  color: 'blue',
  created_at: 1000,
  updated_at: 1000,
}

function setup(overrides: Record<string, unknown> = {}) {
  mockApi = setupMockApi()
  const mockStore = createMockAppStore({
    projects: [SAMPLE_PROJECT],
    ...overrides,
  })
  setupStoreMock(useAppStore, mockStore)
  return mockStore
}

describe('ProjectsPane active code changes badge', () => {
  it('shows a running-indicator badge when a project has an active code change', () => {
    setup({ activeCodeChangesByProject: { 'project-1': 2 } })
    render(<ProjectsPane />)

    const badge = screen.getByTitle('2 Code Changes requests in progress')
    expect(badge).toHaveTextContent('2')
  })

  it('shows no badge when the project has no active code changes', () => {
    setup({ activeCodeChangesByProject: {} })
    render(<ProjectsPane />)

    expect(screen.queryByTitle(/Code Changes request/)).toBeNull()
  })

  it('loads active code changes and subscribes to live updates on mount', () => {
    const mockStore = setup()
    render(<ProjectsPane />)

    expect(mockStore.loadActiveCodeChanges).toHaveBeenCalled()
    expect(mockApi.onActiveCodeChangesChanged).toHaveBeenCalled()
  })
})
