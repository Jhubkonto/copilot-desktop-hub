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

  it('can create and open a Self-Heal report from the crash fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    const onCreateSelfHealReport = vi.fn().mockResolvedValue('report-123456')
    const onOpenSelfHealReport = vi.fn()

    render(
      <ErrorBoundary
        onReportBug={vi.fn()}
        onCreateSelfHealReport={onCreateSelfHealReport}
        onOpenSelfHealReport={onOpenSelfHealReport}
      >
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /create self-heal report/i }))

    expect(onCreateSelfHealReport).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Rendered fewer hooks than expected',
    }))

    await user.click(await screen.findByRole('button', { name: /open self-heal/i }))
    expect(onOpenSelfHealReport).toHaveBeenCalledWith('report-123456')
  })
})
