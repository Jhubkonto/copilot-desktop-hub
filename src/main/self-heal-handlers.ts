import type { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import {
  emitInvestigationEvent,
  loadInvestigationSettings,
  runInvestigation,
  saveInvestigationSettings,
} from './self-heal/investigator'
import { getDatabase } from './database'
import type { ErrorReportEntry, ErrorReportStatus, SelfHealInvestigationSettings } from '../shared/types'

let activeInvestigations = new Set<string>()

export function registerSelfHealHandlers(mainWindow?: BrowserWindow): void {
  safeHandle('self-heal:get-investigation-settings', () => loadInvestigationSettings())

  safeHandle('self-heal:set-investigation-settings', (_event, input: SelfHealInvestigationSettings) =>
    saveInvestigationSettings(input)
  )

  safeHandle('self-heal:set-report-status', (_event, reportId: string, status: ErrorReportStatus) => {
    if (!['open', 'investigating', 'investigated', 'fixed', 'rejected'].includes(status)) return null
    const now = Date.now()
    getDatabase().prepare('UPDATE error_reports SET status = ?, updated_at = ? WHERE id = ?').run(status, now, reportId)
    return getDatabase().prepare('SELECT * FROM error_reports WHERE id = ?').get(reportId) as ErrorReportEntry | null
  })

  safeHandle('self-heal:start-investigation', async (_event, reportId: string) => {
    if (!mainWindow) throw new Error('Main window is not available')
    if (activeInvestigations.has(reportId)) return { reportId }
    activeInvestigations.add(reportId)
    void runInvestigation(mainWindow, reportId, {
      onChunk: (chunk) => {
        emitInvestigationEvent(mainWindow, 'self-heal:investigation-chunk', { reportId, chunk })
      },
      onActivity: (activity) => {
        emitInvestigationEvent(mainWindow, 'self-heal:investigation-activity', activity)
      },
    })
      .then((result) => {
        emitInvestigationEvent(mainWindow, 'self-heal:investigation-done', result)
      })
      .finally(() => {
        activeInvestigations.delete(reportId)
      })
    return { reportId }
  })
}
