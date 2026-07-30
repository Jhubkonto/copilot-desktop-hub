import { GripVertical, Loader2, Mic, PanelBottomClose, RotateCcw, Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import type { VoiceState } from '../../hooks/useVoiceInput'
import {
  readVoiceDockPoint,
  voiceDockPixelsToPoint,
  voiceDockPointToPixels,
  voiceDockSizeClass,
  writeVoiceDockPoint,
  type VoiceDockPoint,
} from '../../lib/voice-dock-position'

const DOCK_WIDTH = 124
const DOCK_HEIGHT = 72

interface VoiceDockProps {
  state: VoiceState
  durationMs: number
  level: number
  error: string | null
  disabled?: boolean
  onStart: () => void | Promise<void>
  onStop: () => void | Promise<void>
  onCancel: () => void | Promise<void>
  onDock: () => void
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function VoiceDock({
  state,
  durationMs,
  level,
  error,
  disabled = false,
  onStart,
  onStop,
  onCancel,
  onDock,
}: VoiceDockProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const holdRef = useRef<number | null>(null)
  const [tapMode, setTapMode] = useState(() => localStorage.getItem('nexy.voiceDock.tapMode') === 'true')
  const [showSettings, setShowSettings] = useState(false)
  const [point, setPoint] = useState<VoiceDockPoint>({ x: 1, y: 1 })
  const [pixels, setPixels] = useState<VoiceDockPoint>({ x: 12, y: 12 })

  const layout = useCallback((nextPoint?: VoiceDockPoint) => {
    const element = rootRef.current
    const parent = element?.parentElement
    if (!element || !parent) return
    const sizeClass = voiceDockSizeClass(parent.clientWidth)
    const resolved = nextPoint ?? readVoiceDockPoint(localStorage, sizeClass)
    setPoint(resolved)
    setPixels(voiceDockPointToPixels(resolved, {
      width: parent.clientWidth,
      height: parent.clientHeight,
      dockWidth: DOCK_WIDTH,
      dockHeight: DOCK_HEIGHT,
    }))
  }, [])

  useLayoutEffect(() => layout(), [layout])
  useEffect(() => {
    const onResize = () => layout(point)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [layout, point])

  const persistPoint = useCallback((next: VoiceDockPoint) => {
    const parent = rootRef.current?.parentElement
    if (!parent) return
    writeVoiceDockPoint(localStorage, voiceDockSizeClass(parent.clientWidth), next)
  }, [])

  const resetPosition = () => {
    const next = { x: 1, y: 1 }
    persistPoint(next)
    layout(next)
  }

  const onGripPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onGripPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    const parent = rootRef.current?.parentElement
    if (!drag || drag.pointerId !== event.pointerId || !parent) return
    const parentRect = parent.getBoundingClientRect()
    const next = voiceDockPixelsToPoint({
      x: event.clientX - parentRect.left - drag.offsetX,
      y: event.clientY - parentRect.top - drag.offsetY,
    }, {
      width: parent.clientWidth,
      height: parent.clientHeight,
      dockWidth: DOCK_WIDTH,
      dockHeight: DOCK_HEIGHT,
    })
    setPoint(next)
    setPixels(voiceDockPointToPixels(next, {
      width: parent.clientWidth,
      height: parent.clientHeight,
      dockWidth: DOCK_WIDTH,
      dockHeight: DOCK_HEIGHT,
    }))
  }

  const onGripPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    persistPoint(point)
  }

  const onMicPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (tapMode || disabled || state !== 'idle' || event.button !== 0) return
    holdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    void onStart()
  }

  const onMicPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (tapMode || holdRef.current !== event.pointerId) return
    holdRef.current = null
    void onStop()
  }

  const onMicClick = () => {
    if (!tapMode || disabled || state === 'transcribing') return
    if (state === 'recording') void onStop()
    else void onStart()
  }

  const stateLabel = error
    ? error
    : state === 'recording'
      ? `Listening · ${formatDuration(durationMs)}`
      : state === 'transcribing'
        ? 'Transcribing locally…'
        : tapMode ? 'Tap to record' : 'Hold to record'

  return (
    <div
      ref={rootRef}
      data-testid="voice-dock"
      className={`absolute z-30 flex items-center rounded-full border shadow-lg bg-white dark:bg-gray-800 transition-opacity hover:opacity-100 ${
        state === 'idle' && !error ? 'opacity-60' : 'opacity-95'
      } ${error ? 'border-red-400 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}
      style={{ left: pixels.x, top: pixels.y, width: DOCK_WIDTH, height: DOCK_HEIGHT }}
      role="group"
      aria-label={`Voice Dock. ${stateLabel}`}
    >
      <button
        type="button"
        className="h-12 w-7 flex items-center justify-center cursor-grab text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 touch-none"
        aria-label="Move Voice Dock"
        title="Drag to move"
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onPointerCancel={onGripPointerUp}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <button
        type="button"
        disabled={disabled || state === 'transcribing'}
        className={`relative h-[60px] w-[60px] shrink-0 rounded-full flex items-center justify-center disabled:opacity-50 touch-none ${
          state === 'recording'
            ? 'bg-red-600 text-white'
            : error
              ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'bg-blue-600 text-white dark:bg-blue-500'
        }`}
        aria-label={state === 'recording' ? 'Stop voice recording' : state === 'transcribing' ? 'Transcribing voice input' : stateLabel}
        aria-pressed={state === 'recording'}
        onPointerDown={onMicPointerDown}
        onPointerUp={onMicPointerUp}
        onPointerCancel={onMicPointerUp}
        onClick={onMicClick}
      >
        {state === 'transcribing'
          ? <Loader2 className="w-6 h-6 animate-spin" />
          : state === 'recording'
            ? <span className="flex flex-col items-center"><Mic className="w-5 h-5" /><span className="text-[10px] tabular-nums">{formatDuration(durationMs)}</span></span>
            : <Mic className="w-6 h-6" />}
        {state === 'recording' && (
          <span
            data-testid="voice-level"
            className="absolute bottom-1 left-2 right-2 h-1 rounded-full bg-white/35 overflow-hidden"
          >
            <span className="block h-full bg-white" style={{ width: `${Math.max(5, Math.round(level * 100))}%` }} />
          </span>
        )}
      </button>
      <div className="flex w-8 flex-col items-center">
        {state === 'recording' ? (
          <button type="button" onClick={() => void onCancel()} className="p-1 text-gray-500 hover:text-red-600" aria-label="Cancel voice recording" title="Cancel">
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button type="button" onClick={() => setShowSettings((value) => !value)} className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200" aria-label="Voice Dock settings" aria-expanded={showSettings}>
            <Settings2 className="w-4 h-4" />
          </button>
        )}
        <button type="button" onClick={onDock} className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200" aria-label="Dock microphone in composer" title="Dock microphone">
          <PanelBottomClose className="w-4 h-4" />
        </button>
      </div>
      <div className="sr-only" aria-live="polite">{stateLabel}</div>
      {showSettings && state !== 'recording' && (
        <div className="absolute right-0 top-[76px] w-48 rounded-lg border border-gray-200 bg-white p-1 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            className="flex w-full items-center rounded-md px-2 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            onClick={() => {
              const next = !tapMode
              setTapMode(next)
              localStorage.setItem('nexy.voiceDock.tapMode', String(next))
            }}
            aria-pressed={tapMode}
          >
            {tapMode ? 'Use press and hold' : 'Use tap to start and stop'}
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700" onClick={resetPosition}>
            <RotateCcw className="w-3.5 h-3.5" /> Reset position
          </button>
        </div>
      )}
    </div>
  )
}
