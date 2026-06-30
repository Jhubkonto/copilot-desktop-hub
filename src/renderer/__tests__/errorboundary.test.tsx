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

  it('keeps crash diagnostics separate from Code Changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    const onReportBug = vi.fn()

    render(
      <ErrorBoundary onReportBug={onReportBug}>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.queryByText(/self-heal/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/remote edit/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /report manually/i }))
    expect(onReportBug).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Rendered fewer hooks than expected',
    }))
  })
})
