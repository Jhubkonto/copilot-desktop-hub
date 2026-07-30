import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceDock } from '../components/chat/VoiceDock'

beforeEach(() => {
  localStorage.clear()
  HTMLElement.prototype.setPointerCapture = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
})

function renderDock(overrides: Partial<Parameters<typeof VoiceDock>[0]> = {}) {
  const props = {
    state: 'idle' as const,
    durationMs: 0,
    level: 0,
    error: null,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onCancel: vi.fn(),
    onDock: vi.fn(),
    ...overrides,
  }
  render(<div><VoiceDock {...props} /></div>)
  return props
}

describe('VoiceDock', () => {
  it('becomes fully opaque when hovered while keeping its idle transparency', () => {
    renderDock()

    expect(screen.getByTestId('voice-dock')).toHaveClass(
      'opacity-60',
      'hover:opacity-100',
      'transition-opacity',
    )
  })

  it('keeps grip dragging separate from microphone recording', () => {
    const props = renderDock()
    const grip = screen.getByRole('button', { name: 'Move Voice Dock' })

    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 700, clientY: 450 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 300, clientY: 250 })
    fireEvent.pointerUp(grip, { pointerId: 1 })

    expect(props.onStart).not.toHaveBeenCalled()
    expect(props.onStop).not.toHaveBeenCalled()
    expect(localStorage.getItem('nexy.voiceDock.position.medium')).not.toBeNull()
  })

  it('starts on center press and stops on release in hold mode', () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    const shared = {
      durationMs: 0,
      level: 0,
      error: null,
      onStart,
      onStop,
      onCancel: vi.fn(),
      onDock: vi.fn(),
    }
    const view = render(<div><VoiceDock {...shared} state="idle" /></div>)
    const microphone = screen.getByRole('button', { name: 'Hold to record' })

    fireEvent.pointerDown(microphone, { pointerId: 2, button: 0 })
    expect(onStart).toHaveBeenCalledOnce()
    view.rerender(<div><VoiceDock {...shared} state="recording" /></div>)
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Stop voice recording' }), { pointerId: 2 })

    expect(onStop).toHaveBeenCalledOnce()
    expect(shared.onDock).not.toHaveBeenCalled()
  })

  it('offers keyboard-accessible tap mode and docking', () => {
    const props = renderDock()
    fireEvent.click(screen.getByRole('button', { name: 'Voice Dock settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use tap to start and stop' }))
    expect(localStorage.getItem('nexy.voiceDock.tapMode')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Dock microphone in composer' }))
    expect(props.onDock).toHaveBeenCalledOnce()
  })

  it('exposes recording duration, level, and cancellation without color alone', () => {
    const props = renderDock({ state: 'recording', durationMs: 65_000, level: 0.42 })
    expect(screen.getByText('1:05')).toBeInTheDocument()
    expect(screen.getByTestId('voice-level').firstElementChild).toHaveStyle({ width: '42%' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel voice recording' }))
    expect(props.onCancel).toHaveBeenCalledOnce()
  })
})
