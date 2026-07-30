import { useEffect, useRef } from 'react'
import {
  PUSH_TO_TALK_SHORTCUT_CHANGED,
  readPushToTalkShortcut,
  shortcutIncludesReleasedKey,
  shortcutMatchesEvent,
} from '../lib/push-to-talk-shortcut'

interface Options {
  enabled: boolean
  state: 'idle' | 'recording' | 'transcribing'
  start: () => void | Promise<void>
  stop: () => void | Promise<void>
  cancel: () => void | Promise<void>
}

export function usePushToTalkShortcut({ enabled, state, start, stop, cancel }: Options): void {
  const activeRef = useRef(false)
  const startPromiseRef = useRef<Promise<void> | null>(null)
  const shortcutRef = useRef(readPushToTalkShortcut(localStorage))
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const refresh = () => {
      shortcutRef.current = readPushToTalkShortcut(localStorage)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.('[data-push-to-talk-capture="true"]')) return
      if (event.key === 'Escape' && activeRef.current) {
        event.preventDefault()
        activeRef.current = false
        const pendingStart = startPromiseRef.current
        if (pendingStart) void pendingStart.then(() => cancel())
        else void cancel()
        return
      }
      const shortcut = shortcutRef.current
      if (!enabled || !shortcut || event.repeat || activeRef.current || stateRef.current !== 'idle') return
      if (!shortcutMatchesEvent(shortcut, event)) return
      event.preventDefault()
      event.stopPropagation()
      activeRef.current = true
      const startPromise = Promise.resolve(start()).finally(() => {
        if (startPromiseRef.current === startPromise) startPromiseRef.current = null
      })
      startPromiseRef.current = startPromise
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const shortcut = shortcutRef.current
      if (!activeRef.current || !shortcut || !shortcutIncludesReleasedKey(shortcut, event)) return
      event.preventDefault()
      activeRef.current = false
      const pendingStart = startPromiseRef.current
      if (pendingStart) void pendingStart.then(() => stop())
      else void stop()
    }
    const onBlur = () => {
      if (!activeRef.current) return
      activeRef.current = false
      const pendingStart = startPromiseRef.current
      if (pendingStart) void pendingStart.then(() => stop())
      else void stop()
    }
    window.addEventListener(PUSH_TO_TALK_SHORTCUT_CHANGED, refresh)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener(PUSH_TO_TALK_SHORTCUT_CHANGED, refresh)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [cancel, enabled, start, stop])
}
