export interface VoiceDockPoint {
  x: number
  y: number
}

export interface VoiceDockBounds {
  width: number
  height: number
  dockWidth: number
  dockHeight: number
  inset?: number
  reservedBottom?: number
}

export type VoiceDockSizeClass = 'compact' | 'medium' | 'expanded'

const DEFAULT_POINT: VoiceDockPoint = { x: 1, y: 1 }

export function voiceDockSizeClass(width: number): VoiceDockSizeClass {
  if (width < 640) return 'compact'
  if (width < 1_024) return 'medium'
  return 'expanded'
}

export function clampVoiceDockPoint(point: VoiceDockPoint): VoiceDockPoint {
  return {
    x: Math.min(1, Math.max(0, Number.isFinite(point.x) ? point.x : DEFAULT_POINT.x)),
    y: Math.min(1, Math.max(0, Number.isFinite(point.y) ? point.y : DEFAULT_POINT.y)),
  }
}

export function voiceDockPointToPixels(point: VoiceDockPoint, bounds: VoiceDockBounds): VoiceDockPoint {
  const inset = bounds.inset ?? 12
  const reservedBottom = bounds.reservedBottom ?? 112
  const availableWidth = Math.max(0, bounds.width - bounds.dockWidth - inset * 2)
  const availableHeight = Math.max(0, bounds.height - bounds.dockHeight - inset - reservedBottom)
  const normalized = clampVoiceDockPoint(point)
  return {
    x: inset + normalized.x * availableWidth,
    y: inset + normalized.y * availableHeight,
  }
}

export function voiceDockPixelsToPoint(pixels: VoiceDockPoint, bounds: VoiceDockBounds): VoiceDockPoint {
  const inset = bounds.inset ?? 12
  const reservedBottom = bounds.reservedBottom ?? 112
  const availableWidth = Math.max(0, bounds.width - bounds.dockWidth - inset * 2)
  const availableHeight = Math.max(0, bounds.height - bounds.dockHeight - inset - reservedBottom)
  return clampVoiceDockPoint({
    x: availableWidth === 0 ? 0 : (pixels.x - inset) / availableWidth,
    y: availableHeight === 0 ? 0 : (pixels.y - inset) / availableHeight,
  })
}

export function readVoiceDockPoint(storage: Storage, sizeClass: VoiceDockSizeClass): VoiceDockPoint {
  try {
    const value = JSON.parse(storage.getItem(`nexy.voiceDock.position.${sizeClass}`) ?? '')
    if (typeof value?.x === 'number' && typeof value?.y === 'number') {
      return clampVoiceDockPoint(value)
    }
  } catch {
    // Invalid or older settings fall back to the reachable recommended position.
  }
  return DEFAULT_POINT
}

export function writeVoiceDockPoint(storage: Storage, sizeClass: VoiceDockSizeClass, point: VoiceDockPoint): void {
  storage.setItem(`nexy.voiceDock.position.${sizeClass}`, JSON.stringify(clampVoiceDockPoint(point)))
}
