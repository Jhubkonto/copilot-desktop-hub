import { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { abortActiveStream } from './providers'
import { dispatchChatSend } from './chat-handlers'
import {
  startWsServer,
  stopWsServer,
  getWsStatus,
  getQrDataUrl,
  regenerateToken,
  setWsCommandHandler,
} from './ws-server'

// Filled in by tools.ts after registration to avoid a circular import
let resolveApprovalFn: ((requestId: string, approved: boolean) => boolean) | null = null
export function registerApprovalResolver(fn: (requestId: string, approved: boolean) => boolean): void {
  resolveApprovalFn = fn
}

export function registerWsHandlers(): void {
  setWsCommandHandler((command, data) => {
    if (command === 'ping') return

    if (command === 'tool:approve' || command === 'tool:reject') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : ''
      resolveApprovalFn?.(requestId, command === 'tool:approve')
      return
    }

    if (command === 'agent:stop') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : undefined
      abortActiveStream(conversationId)
      return
    }

    if (command === 'chat:send-message') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const content = typeof data.content === 'string' ? data.content : ''
      const model = typeof data.model === 'string' ? data.model : undefined
      const agentId = typeof data.agentId === 'string' ? data.agentId : undefined
      if (!conversationId || !content) return
      const wins = BrowserWindow.getAllWindows()
      if (wins.length === 0) return
      void dispatchChatSend(wins[0], conversationId, content, { model, agentId })
      return
    }

    if (command === 'conversation:list') {
      // Import broadcastToMobile lazily to avoid circular dep at module load time
      void import('./ws-server').then(({ broadcastToMobile }) => {
        const db = getDatabase()
        const rows = db
          .prepare("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 30")
          .all()
        broadcastToMobile({ event: 'conversation:list', data: rows })
      })
      return
    }
  })

  safeHandle('ws:start', async () => {
    const result = await startWsServer()
    const qrDataUrl = await getQrDataUrl()
    return { ...result, qrDataUrl }
  })

  safeHandle('ws:stop', () => {
    stopWsServer()
    return true
  })

  safeHandle('ws:status', async () => {
    const status = getWsStatus()
    const qrDataUrl = status.enabled ? await getQrDataUrl() : null
    return { ...status, qrDataUrl }
  })

  safeHandle('ws:regenerate-token', async () => {
    const token = regenerateToken()
    const qrDataUrl = await getQrDataUrl()
    return { token, qrDataUrl }
  })
}
