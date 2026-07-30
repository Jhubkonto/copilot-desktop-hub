import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePushToTalkShortcut } from '../hooks/usePushToTalkShortcut'
import {
  formatPushToTalkShortcut,
  readPushToTalkShortcut,
  validatePushToTalkShortcut,
  writePushToTalkShortcut,
  type PushToTalkShortcut,
} from '../lib/push-to-talk-shortcut'

const SHORTCUT: PushToTalkShortcut = {
  version: 1,
  modifiers: ['Control', 'Shift'],
  code: 'Space',
}

beforeEach(() => localStorage.clear())

describe('push-to-talk shortcut', () => {
  it('validates, stores, and displays a normalized chord', () => {
    expect(validatePushToTalkShortcut(SHORTCUT)).toBeNull()
    expect(validatePushToTalkShortcut({ version: 1, modifiers: [], code: 'KeyK' }))
      .toBe('Add at least one modifier key.')
    expect(validatePushToTalkShortcut({ version: 1, modifiers: ['Control'], code: 'KeyV' }))
      .toBe('That shortcut is reserved for editing.')
    expect(validatePushToTalkShortcut({ version: 1, modifiers: ['Control', 'Shift'], code: 'KeyH' }))
      .toBe('That shortcut is already used to show or hide Nexy.')

    writePushToTalkShortcut(localStorage, SHORTCUT)
    expect(readPushToTalkShortcut(localStorage)).toEqual(SHORTCUT)
    expect(formatPushToTalkShortcut(SHORTCUT)).toContain('Space')
  })

  it('starts once on chord press and stops once when any chord key is released', async () => {
    writePushToTalkShortcut(localStorage, SHORTCUT)
    const start = vi.fn().mockResolvedValue(undefined)
    const stop = vi.fn().mockResolvedValue(undefined)
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderHook(() => usePushToTalkShortcut({
      enabled: true,
      state: 'idle',
      start,
      stop,
      cancel,
    }))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Space',
        key: ' ',
        ctrlKey: true,
        shiftKey: true,
      }))
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Space',
        key: ' ',
        ctrlKey: true,
        shiftKey: true,
        repeat: true,
      }))
      window.dispatchEvent(new KeyboardEvent('keyup', {
        code: 'ShiftLeft',
        key: 'Shift',
        ctrlKey: true,
      }))
    })

    await waitFor(() => expect(stop).toHaveBeenCalledOnce())
    expect(start).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('cancels an active keyboard recording with Escape', async () => {
    writePushToTalkShortcut(localStorage, SHORTCUT)
    const cancel = vi.fn().mockResolvedValue(undefined)
    renderHook(() => usePushToTalkShortcut({
      enabled: true,
      state: 'idle',
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      cancel,
    }))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Space',
        key: ' ',
        ctrlKey: true,
        shiftKey: true,
      }))
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }))
    })

    await waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })
})
