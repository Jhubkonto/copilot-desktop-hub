import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DropdownPanel } from '../components/DropdownPanel'

function rect({ top, bottom, left, right, width, height }: Partial<DOMRect>): DOMRect {
  return {
    x: left ?? 0,
    y: top ?? 0,
    top: top ?? 0,
    bottom: bottom ?? 0,
    left: left ?? 0,
    right: right ?? 0,
    width: width ?? 0,
    height: height ?? 0,
    toJSON: () => ({}),
  }
}

describe('DropdownPanel', () => {
  it('portals the panel and opens above when the trigger is near the viewport bottom', async () => {
    const measurements = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute('data-dropdown-panel')) {
          return rect({ top: 0, bottom: 120, left: 0, right: 256, width: 256, height: 120 })
        }
        return rect({ top: 700, bottom: 728, left: 40, right: 68, width: 28, height: 28 })
      })
    vi.stubGlobal('innerHeight', 768)
    vi.stubGlobal('innerWidth', 1024)

    const { container } = render(
      <DropdownPanel open onClose={vi.fn()} trigger={<button>Listen</button>} width="w-64">
        <div role="menu">Options</div>
      </DropdownPanel>,
    )

    const panel = await waitFor(() => document.querySelector<HTMLElement>('[data-dropdown-panel]')!)
    expect(panel).toHaveAttribute('data-placement', 'above')
    expect(panel.style.top).toBe('576px')
    expect(container.querySelector('[data-dropdown-panel]')).toBeNull()
    expect(document.body).toContainElement(panel)

    measurements.mockRestore()
    vi.unstubAllGlobals()
  })

  it('opens below when there is enough room and keeps portaled menu clicks inside', async () => {
    const onClose = vi.fn()
    const measurements = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute('data-dropdown-panel')) {
          return rect({ top: 0, bottom: 80, left: 0, right: 224, width: 224, height: 80 })
        }
        return rect({ top: 100, bottom: 128, left: 40, right: 68, width: 28, height: 28 })
      })

    render(
      <DropdownPanel open onClose={onClose} trigger={<button>Listen</button>}>
        <button role="menuitem">Primary option</button>
      </DropdownPanel>,
    )

    const panel = await waitFor(() => document.querySelector<HTMLElement>('[data-dropdown-panel]')!)
    expect(panel).toHaveAttribute('data-placement', 'below')
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Primary option' }))
    expect(onClose).not.toHaveBeenCalled()

    measurements.mockRestore()
  })
})
