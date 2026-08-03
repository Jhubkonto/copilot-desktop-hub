import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../store/app-store'

export interface EmergencyStopStatus {
  active: boolean
  activatedAt: number | null
}

const SAFE_STATUS: EmergencyStopStatus = { active: false, activatedAt: null }

export function useEmergencyStop() {
  const [status, setStatus] = useState<EmergencyStopStatus>(SAFE_STATUS)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const applyStatus = (next: EmergencyStopStatus) => {
      setStatus(next)
      if (next.active) {
        const store = useAppStore.getState()
        store.generatingConversationIds.forEach(store.markConversationDoneGenerating)
        store.pendingConversationIds.forEach(store.clearConversationPending)
      }
    }
    void window.api.getEmergencyStop().then(applyStatus).catch(() => {})
    return window.api.onEmergencyStopChanged(applyStatus)
  }, [])

  const activate = useCallback(async () => {
    setBusy(true)
    try { setStatus(await window.api.activateEmergencyStop()) } finally { setBusy(false) }
  }, [])

  const resume = useCallback(async () => {
    setBusy(true)
    try { setStatus(await window.api.resumeConversations()) } finally { setBusy(false) }
  }, [])

  return { ...status, busy, activate, resume }
}
