import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import { abortActiveStream, PROVIDERS, isProviderConfigured } from './providers'
import { dispatchChatSend } from './chat-handlers'
import { getCliModels } from './cli-detection'
import { getCachedCatalog } from './model-catalog'
import { retrieveAuthMode } from './auth'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
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
  setWsCommandHandler((command, data, reply) => {
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

    if (command === 'model:list') {
      let backend = typeof data.backend === 'string' ? data.backend : undefined
      const agentId = typeof data.agentId === 'string' ? data.agentId : undefined
      if (!backend && agentId) {
        const db = getDatabase()
        const row = db.prepare("SELECT json_extract(config_json, '$.backend') AS backend FROM agents WHERE id = ?").get(agentId) as
          | { backend: string | null }
          | undefined
        backend = row?.backend ?? undefined
      }
      const byId = new Map<string, { id: string; label: string; vendor?: string }>()
      byId.set('default', { id: 'default', label: 'Default model' })

      const fallbackBackend =
        !backend && retrieveAuthMode() === 'none'
          ? (
              ClaudeAdapter.isAvailable()
                ? 'claude-cli'
                : (CodexAdapter.isAvailable() ? 'codex-cli' : undefined)
            )
          : undefined
      const resolvedBackend = backend ?? fallbackBackend
      const catalogById = new Map(getCachedCatalog().map((model) => [model.id, model]))

      const models =
        resolvedBackend === 'codex-cli'
          ? getCliModels('codex-cli').map((model) => ({ ...model, vendor: 'Codex CLI' }))
          : resolvedBackend === 'claude-cli'
            ? getCliModels('claude-cli').map((model) => ({ ...model, vendor: 'Claude CLI' }))
            : PROVIDERS
                .filter((provider) => isProviderConfigured(provider.name))
                .flatMap((provider) => provider.models.map((model) => ({
                  id: provider.name === 'azure' ? `azure:${model}` : model,
                  label: catalogById.get(model)?.name ?? (provider.name === 'azure' ? `Azure ${model}` : model),
                  vendor: provider.label,
                })))

      for (const model of models) {
        if (!byId.has(model.id)) byId.set(model.id, model)
      }
      reply({ event: 'model:list', data: { models: [...byId.values()] } })
      return
    }

    if (command === 'chat:send-message') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const content = typeof data.content === 'string' ? data.content : ''
      const model = typeof data.model === 'string' ? data.model : undefined
      const agentId = typeof data.agentId === 'string' ? data.agentId : undefined
      const projectId = typeof data.projectId === 'string' ? data.projectId : undefined
      const rawImages = Array.isArray(data.images) ? data.images : []
      const images = rawImages.filter(
        (img): img is { id: string; name: string; dataUrl: string } =>
          typeof img === 'object' && img !== null &&
          typeof (img as Record<string, unknown>).id === 'string' &&
          typeof (img as Record<string, unknown>).name === 'string' &&
          typeof (img as Record<string, unknown>).dataUrl === 'string'
      )
      if (!conversationId || (!content && images.length === 0)) return
      const wins = BrowserWindow.getAllWindows()
      if (wins.length === 0) return
      wins[0].webContents.send('chat:remote-message', {
        conversationId,
        content,
        images: images.length > 0 ? images : undefined,
      })
      void dispatchChatSend(wins[0], conversationId, content, { model, agentId, projectId, images: images.length > 0 ? images : undefined })
      return
    }

    const db = getDatabase()

    if (command === 'conversation:list') {
      const rows = db.prepare(`
          SELECT c.id, c.title, c.created_at, c.updated_at,
            c.agent_id,
            c.model,
            json_extract(a.config_json, '$.name') AS agent_name,
            json_extract(a.config_json, '$.icon') AS agent_icon,
            c.project_id,
            p.name AS project_name,
            (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS last_message
          FROM conversations c
          LEFT JOIN agents a ON c.agent_id = a.id
          LEFT JOIN projects p ON c.project_id = p.id
          ORDER BY c.updated_at DESC
          LIMIT 50
        `).all()
      reply({ event: 'conversation:list', data: rows })
      return
    }

    if (command === 'conversation:set-model') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      const model = typeof data.model === 'string' && data.model !== 'default' ? data.model : null
      if (!conversationId) return
      db.prepare('UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?').run(model, Date.now(), conversationId)
      reply({ event: 'conversation:model-updated', data: { conversationId, model } })
      return
    }

    if (command === 'project:list') {
      const rows = db.prepare(`
          SELECT p.id, p.name, p.color,
            (SELECT COUNT(*) FROM conversations WHERE project_id = p.id) AS chat_count,
            (SELECT GROUP_CONCAT(NULLIF(json_extract(a.config_json, '$.icon'), ''), ',')
             FROM project_agents pa JOIN agents a ON pa.agent_id = a.id
             WHERE pa.project_id = p.id
             ORDER BY pa.sort_order ASC) AS agent_icons
          FROM projects p ORDER BY p.name ASC
        `).all()
      reply({ event: 'project:list', data: { projects: rows } })
      return
    }

    if (command === 'conversation:get-messages') {
      const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
      if (!conversationId) return
      const rows = db.prepare(
        `SELECT id, role, content, model, attachments, timestamp FROM messages
           WHERE conversation_id = ? ORDER BY timestamp ASC`
      ).all(conversationId)
      reply({ event: 'conversation:messages', data: { conversationId, messages: rows } })
      return
    }

    if (command === 'agent:list') {
      const rows = db.prepare(
        `SELECT id,
          json_extract(config_json, '$.name') AS name,
          json_extract(config_json, '$.icon') AS icon,
          json_extract(config_json, '$.backend') AS backend,
          json_extract(config_json, '$.cliModel') AS cli_model
         FROM agents ORDER BY created_at ASC`
      ).all()
      reply({ event: 'agent:list', data: { agents: rows } })
      return
    }

    if (command === 'conversation:create') {
      const agentId = typeof data.agentId === 'string' ? data.agentId : null
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      const title = typeof data.title === 'string' ? data.title : 'New Chat'
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        `INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, agentId, projectId, title, now, now)
      reply({ event: 'conversation:created', data: { id, agentId, projectId, title } })
      return
    }
  })

  safeHandle('ws:start', async () => {
    const result = await startWsServer()
    const status = getWsStatus()
    const qrDataUrl = await getQrDataUrl()
    return { ...result, qrDataUrl, pairingUrl: status.pairingUrl, secure: status.secure }
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
    const status = getWsStatus()
    const qrDataUrl = await getQrDataUrl()
    return { token, qrDataUrl, pairingUrl: status.pairingUrl, secure: status.secure }
  })
}
