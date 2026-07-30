import { describe, expect, it } from 'vitest'
import {
  clampVoiceDockPoint,
  readVoiceDockPoint,
  voiceDockPixelsToPoint,
  voiceDockPointToPixels,
  voiceDockSizeClass,
  writeVoiceDockPoint,
} from '../lib/voice-dock-position'

describe('Voice Dock placement', () => {
  it('classifies desktop window widths for independent persistence', () => {
    expect(voiceDockSizeClass(500)).toBe('compact')
    expect(voiceDockSizeClass(800)).toBe('medium')
    expect(voiceDockSizeClass(1_200)).toBe('expanded')
  })

  it('clamps invalid and unreachable normalized positions', () => {
    expect(clampVoiceDockPoint({ x: -4, y: 2 })).toEqual({ x: 0, y: 1 })
    expect(clampVoiceDockPoint({ x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual({ x: 1, y: 1 })
  })

  it('keeps the dock inside safe bounds and above the composer', () => {
    const pixels = voiceDockPointToPixels({ x: 1, y: 1 }, {
      width: 900,
      height: 700,
      dockWidth: 124,
      dockHeight: 72,
      inset: 12,
      reservedBottom: 112,
    })
    expect(pixels).toEqual({ x: 764, y: 516 })
    expect(voiceDockPixelsToPoint(pixels, {
      width: 900,
      height: 700,
      dockWidth: 124,
      dockHeight: 72,
      inset: 12,
      reservedBottom: 112,
    })).toEqual({ x: 1, y: 1 })
  })

  it('persists a clamped position per size class and recovers from corrupt data', () => {
    const storage = new Map<string, string>()
    const adapter: Storage = {
      get length() { return storage.size },
      clear: () => storage.clear(),
      getItem: (key) => storage.get(key) ?? null,
      key: (index) => [...storage.keys()][index] ?? null,
      removeItem: (key) => { storage.delete(key) },
      setItem: (key, value) => { storage.set(key, value) },
    }
    writeVoiceDockPoint(adapter, 'medium', { x: 0.25, y: 4 })
    expect(readVoiceDockPoint(adapter, 'medium')).toEqual({ x: 0.25, y: 1 })
    adapter.setItem('nexy.voiceDock.position.compact', '{bad')
    expect(readVoiceDockPoint(adapter, 'compact')).toEqual({ x: 1, y: 1 })
  })
})
