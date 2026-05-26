import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DirectoryPicker } from '../../renderer/components/DirectoryPicker'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi

beforeEach(() => {
  mockApi = setupMockApi()
  document.body.innerHTML = '<button data-directory-breadcrumb="true">crumb</button>'
})

describe('DirectoryPicker', () => {
  it('dp-1: renders current working directory', async () => {
    mockApi.getWorkingDirectory.mockResolvedValue('C:\\workspace')
    render(<DirectoryPicker agentId={null} onClose={() => {}} />)

    expect(await screen.findByText('C:\\workspace')).toBeInTheDocument()
  })

  it('dp-2: renders recent directories from getRecentDirs', async () => {
    mockApi.getRecentDirs.mockResolvedValue(['C:\\one', 'C:\\two'])
    render(<DirectoryPicker agentId={null} onClose={() => {}} />)

    expect(await screen.findByText('C:\\one')).toBeInTheDocument()
    expect(screen.getByText('C:\\two')).toBeInTheDocument()
  })

  it('dp-3: clicking a recent dir calls setWorkingDirectory and addRecentDir and closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockApi.getRecentDirs.mockResolvedValue(['C:\\recent'])
    render(<DirectoryPicker agentId={null} onClose={onClose} />)

    await user.click(await screen.findByText('C:\\recent'))

    await waitFor(() => {
      expect(mockApi.setWorkingDirectory).toHaveBeenCalledWith('C:\\recent')
      expect(mockApi.addRecentDir).toHaveBeenCalledWith('C:\\recent')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('dp-4: Browse button calls openDirectoryDialog', async () => {
    const user = userEvent.setup()
    mockApi.openDirectoryDialog.mockResolvedValue(['C:\\browse'])
    render(<DirectoryPicker agentId={null} onClose={() => {}} />)

    await user.click(screen.getByRole('button', { name: /browse/i }))

    await waitFor(() => {
      expect(mockApi.openDirectoryDialog).toHaveBeenCalled()
      expect(mockApi.setWorkingDirectory).toHaveBeenCalledWith('C:\\browse')
    })
  })

  it('dp-5: manual path input and confirm calls setWorkingDirectory', async () => {
    const user = userEvent.setup()
    render(<DirectoryPicker agentId={null} onClose={() => {}} />)

    await user.type(screen.getByPlaceholderText(/enter path manually/i), 'C:\\manual')
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => {
      expect(mockApi.setWorkingDirectory).toHaveBeenCalledWith('C:\\manual')
    })
  })
})
