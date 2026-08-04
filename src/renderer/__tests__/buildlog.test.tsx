import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BuildLog } from '../components/BuildLog'

describe('BuildLog', () => {
  it('keeps command output readable with a theme-independent terminal palette', () => {
    const { container } = render(<BuildLog lines={['Build completed']} />)

    const output = container.querySelector('pre')
    expect(output).toHaveClass('bg-gray-950', 'text-gray-100')
    expect(output).not.toHaveClass('bg-nexy-frame', 'text-nexy-highlight')
    expect(screen.getByText('Build completed')).toBeInTheDocument()
  })
})
