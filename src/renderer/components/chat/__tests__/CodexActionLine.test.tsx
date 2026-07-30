import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CodexActionLine } from '../CodexActionLine'

describe('CodexActionLine', () => {
  it('opens the full invocation and output only from the explicit command button', () => {
    const { container } = render(
      <CodexActionLine
        kind="tool"
        toolName="Run Command"
        args={{ command: 'Get-Content -Raw src/example.ts' }}
        result={'first line\nsecond line\nthird line\nfourth line'}
      />,
    )

    expect(container.querySelector('[title*="Get-Content"]')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View full details for Run Command' }))

    const dialog = screen.getByRole('dialog', { name: 'Full details for Run Command' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Ran Run Command Get-Content -Raw src/example.ts')).toBeInTheDocument()
    expect(dialog.querySelectorAll('pre')[1]).toHaveTextContent('first line second line third line fourth line')
  })

  it('closes the command modal with Escape', () => {
    render(
      <CodexActionLine
        kind="tool"
        toolName="Read"
        args={{ path: 'src/example.ts' }}
        result="contents"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'View full details for Read' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
