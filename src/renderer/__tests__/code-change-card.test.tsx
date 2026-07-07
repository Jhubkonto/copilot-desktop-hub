import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { CodeChangeCard } from '../components/chat/CodeChangeCard'
import { setupMockApi, type MockApi } from '../../test/mocks/api'

let mockApi: MockApi

beforeEach(() => {
  mockApi = setupMockApi()
})

describe('CodeChangeCard', () => {
  it('shows a deleted/missing state instead of loading forever when the report no longer exists', async () => {
    mockApi.getErrorReport.mockResolvedValue(null)

    render(<CodeChangeCard reportId="deleted-report" />)

    expect(await screen.findByText('Code change deleted or no longer available')).toBeInTheDocument()
    expect(screen.queryByText('Loading code change…')).not.toBeInTheDocument()
  })
})
