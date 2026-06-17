import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../../renderer/components/Sidebar'
import { setupMockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn()
}))

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore
}))

let mockStore: ReturnType<typeof createMockAppStore>
const user = userEvent.setup()

beforeEach(() => {
  setupMockApi()
  mockStore = createMockAppStore({
    authState: { authenticated: true, user: { login: 'test', name: 'Test', avatar_url: '' } }
  })
  setupStoreMock(useAppStore, mockStore)
})

describe('Sidebar — Error Handling', () => {
  it('opens projects pane when Projects button is clicked', async () => {
    render(<Sidebar />)

    const projectsBtn = screen.getByLabelText('Open projects')
    await user.click(projectsBtn)

    expect(mockStore.openSectionPane).toHaveBeenCalledWith('projects')
  })
})
