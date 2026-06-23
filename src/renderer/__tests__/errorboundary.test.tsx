import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'

function Boom(): ReactElement | null {
  throw new Error('Rendered fewer hooks than expected')
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('can create and open a Remote Edit report from the crash fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    const onCreateRemoteEditReport = vi.fn().mockResolvedValue('report-123456')
    const onOpenRemoteEditReport = vi.fn()

    render(
      <ErrorBoundary
        onReportBug={vi.fn()}
        onCreateRemoteEditReport={onCreateRemoteEditReport}
        onOpenRemoteEditReport={onOpenRemoteEditReport}
      >
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /create remote-edit report/i }))

    expect(onCreateRemoteEditReport).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Rendered fewer hooks than expected',
    }))

    await user.click(await screen.findByRole('button', { name: /open remote-edit/i }))
    expect(onOpenRemoteEditReport).toHaveBeenCalledWith('report-123456')
  })
})
