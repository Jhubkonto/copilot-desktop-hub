import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('recovers automatically when its reset key changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const view = render(
      <ErrorBoundary resetKey="broken-chat">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    view.rerender(
      <ErrorBoundary resetKey="healthy-chat">
        <div>Healthy conversation</div>
      </ErrorBoundary>,
    )

    expect(screen.getByText('Healthy conversation')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('remounts the failed child tree when retrying', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true
    function Recoverable(): ReactElement {
      if (shouldThrow) throw new Error('Temporary render failure')
      return <div>Recovered chat</div>
    }

    render(
      <ErrorBoundary>
        <Recoverable />
      </ErrorBoundary>,
    )

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByText('Recovered chat')).toBeInTheDocument()
  })
})
