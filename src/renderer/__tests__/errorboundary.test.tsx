import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'

function Boom(): ReactElement | null {
  throw new Error('Rendered fewer hooks than expected')
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps crash diagnostics separate from Code Changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Rendered fewer hooks than expected')).toBeInTheDocument()
    expect(screen.queryByText(/self-heal/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/remote edit/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
