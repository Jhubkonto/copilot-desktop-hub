import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NexyIcon } from '../NexyIcon'

describe('NexyIcon', () => {
  afterEach(() => {
    document.documentElement.dataset.uiStyle = 'classic'
  })

  it('is decorative by default', () => {
    const { container } = render(<NexyIcon name="chat" />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('exposes an accessible image when a title is supplied', () => {
    render(<NexyIcon name="settings" title="Settings" />)

    expect(screen.getByRole('img', { name: 'Settings' })).toBeInTheDocument()
  })

  it('keeps the requested icon viewport size', () => {
    const { container } = render(<NexyIcon name="project" size={14} />)

    expect(container.querySelector('svg')).toHaveAttribute('width', '14')
    expect(container.querySelector('svg')).toHaveAttribute('height', '14')
  })

  it('uses the pre-8-bit shrink-window icon for Classic restore controls', () => {
    document.documentElement.dataset.uiStyle = 'classic'
    const { container } = render(<NexyIcon name="restore" />)

    expect(container.querySelector('svg')).toHaveClass('lucide-maximize-2')
    expect(container.querySelector('svg')).not.toHaveClass('lucide-rotate-ccw')
  })

  it('uses a spinner in Classic and a subtle loading pulse in 8-bit', () => {
    document.documentElement.dataset.uiStyle = 'classic'
    const { container, rerender } = render(<NexyIcon name="busy" />)
    expect(container.querySelector('svg')).toHaveClass('animate-spin')

    document.documentElement.dataset.uiStyle = '8bit'
    rerender(<NexyIcon name="busy" />)
    expect(container.querySelector('svg')).not.toHaveClass('animate-spin')
    expect(container.querySelector('svg')).toHaveClass('nexy-retro-loading-pulse')
  })

  it('maps explicit pulse indicators to the retro loading pulse in 8-bit', () => {
    document.documentElement.dataset.uiStyle = 'classic'
    const { container, rerender } = render(<NexyIcon name="busy" motion="pulse" />)
    expect(container.querySelector('svg')).toHaveClass('animate-pulse')
    expect(container.querySelector('svg')).not.toHaveClass('animate-spin')

    document.documentElement.dataset.uiStyle = '8bit'
    rerender(<NexyIcon name="busy" motion="pulse" />)
    expect(container.querySelector('svg')).not.toHaveClass('animate-pulse')
    expect(container.querySelector('svg')).toHaveClass('nexy-retro-loading-pulse')
  })

  it('maps explicit spin indicators to a retro loading spin in 8-bit', () => {
    document.documentElement.dataset.uiStyle = '8bit'
    const { container } = render(<NexyIcon name="busy" motion="spin" />)

    expect(container.querySelector('svg')).toHaveClass('nexy-retro-loading-spin')
    expect(container.querySelector('svg')).not.toHaveClass('nexy-retro-loading-pulse')
  })

  it('allows callers to suppress busy motion in either UI style', () => {
    document.documentElement.dataset.uiStyle = 'classic'
    const { container, rerender } = render(<NexyIcon name="busy" motion="none" />)
    expect(container.querySelector('svg')).not.toHaveClass('animate-spin')

    document.documentElement.dataset.uiStyle = '8bit'
    rerender(<NexyIcon name="busy" motion="none" />)
    expect(container.querySelector('svg')).not.toHaveClass('nexy-retro-loading-pulse')
  })
})
