import { ipcMain, BrowserWindow, dialog } from 'electron'
import { getDatabase } from './database'
import { randomUUID } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import { sendCopilotMessage, stopGeneration } from './copilot'
import { checkCliOnStartup } from './cli-detection'
import { registerAgentHandlers, getAgentConfig } from './agents'
import { registerToolHandlers } from './tools'
import { registerTerminalHandlers } from './terminal'
import { registerMcpHandlers } from './mcp'

export function registerIpcHandlers(): void {
  registerSettingsHandlers()
  registerConversationHandlers()
  registerChatHandlers()
  registerMessageHandlers()
  registerFileHandlers()
  registerAgentHandlers()
  registerToolHandlers()
  registerTerminalHandlers()
  registerMcpHandlers()
}

function registerSettingsHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('app:get-settings', () => {
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    return settings
  })

  ipcMain.handle('app:set-setting', (_event, key: string, value: string) => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      key,
      value
    )
    return true
  })

  ipcMain.handle('app:get-theme', () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get() as
      | { value: string }
      | undefined
    return row?.value ?? 'dark'
  })

  ipcMain.handle('app:set-theme', (_event, theme: string) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)").run(
      theme
    )
    return true
  })
}

function registerConversationHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('conversation:list', () => {
    return db
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
      .all()
  })

  ipcMain.handle('conversation:create', (_event, agentId?: string) => {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO conversations (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, agentId ?? null, 'New Chat', now, now)
    return {
      id,
      agent_id: agentId ?? null,
      title: 'New Chat',
      created_at: now,
      updated_at: now
    }
  })

  ipcMain.handle('conversation:delete', (_event, id: string) => {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('conversation:get-messages', (_event, conversationId: string) => {
    return db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC'
      )
      .all(conversationId)
  })

  ipcMain.handle('conversation:search', (_event, query: string) => {
    if (!query.trim()) {
      return db
        .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
        .all()
    }
    const searchTerm = `%${query}%`
    return db
      .prepare(
        `SELECT DISTINCT c.* FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.title LIKE ? OR m.content LIKE ?
         ORDER BY c.updated_at DESC`
      )
      .all(searchTerm, searchTerm)
  })

  ipcMain.handle('conversation:rename', (_event, id: string, title: string) => {
    db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
      title,
      Date.now(),
      id
    )
    return true
  })
}

function registerChatHandlers(): void {
  const db = getDatabase()

  // Track Copilot session IDs per conversation
  const sessionMap = new Map<string, string>()

  ipcMain.handle(
    'chat:send-message',
    async (
      event,
      conversationId: string,
      content: string,
      options?: {
        attachments?: { id: string; name: string; path: string; size: number }[]
        regenerate?: boolean
        agentId?: string
      }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return null

      const attachments = options?.attachments
      const regenerate = options?.regenerate === true
      const agentId = options?.agentId

      if (!regenerate) {
        // Ensure conversation exists, create if needed
        const convo = db
          .prepare('SELECT id FROM conversations WHERE id = ?')
          .get(conversationId) as { id: string } | undefined

        if (!convo) {
          const now = Date.now()
          const title = content.slice(0, 80) + (content.length > 80 ? '...' : '')
          db.prepare(
            'INSERT INTO conversations (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          ).run(conversationId, agentId ?? null, title, now, now)
        }

        // Save user message
        const userMsgId = randomUUID()
        const attachmentsJson =
          attachments && attachments.length > 0 ? JSON.stringify(attachments) : null
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(userMsgId, conversationId, 'user', content, attachmentsJson, Date.now())

        // Update conversation title if it's the first message
        const msgCount = db
          .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
          .get(conversationId) as { count: number }
        if (msgCount.count === 1) {
          const title = content.slice(0, 80) + (content.length > 80 ? '...' : '')
          db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(
            title,
            conversationId
          )
        }
      }

      // Update conversation timestamp
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
        Date.now(),
        conversationId
      )

      // Build augmented content with file attachments
      let augmentedContent = content
      if (attachments && attachments.length > 0) {
        let fileContext = ''
        for (const att of attachments) {
          try {
            const fileContent = readFileSync(att.path, 'utf-8')
            fileContext += `File: ${att.name}\n\`\`\`\n${fileContent}\n\`\`\`\n\n`
          } catch {
            fileContext += `File: ${att.name} (could not read file)\n\n`
          }
        }
        augmentedContent = fileContext + content
      }

      // Look up agent system prompt for this conversation
      const convRow = db
        .prepare('SELECT agent_id FROM conversations WHERE id = ?')
        .get(conversationId) as { agent_id: string | null } | undefined
      if (convRow?.agent_id) {
        const agentCfg = getAgentConfig(convRow.agent_id)
        if (agentCfg?.systemPrompt) {
          augmentedContent = `[System Instructions]\n${agentCfg.systemPrompt}\n[/System Instructions]\n\n${augmentedContent}`
        }
      }

      let responseContent: string

      // Try Copilot SDK first, fall back to placeholder
      const cliStatus = checkCliOnStartup()
      if (cliStatus.installed) {
        try {
          const copilotSessionId = sessionMap.get(conversationId)
          const result = await sendCopilotMessage(
            window,
            conversationId,
            augmentedContent,
            copilotSessionId
          )
          responseContent = result.responseContent
          sessionMap.set(conversationId, result.copilotSessionId)
        } catch (error) {
          console.error('Copilot SDK error, falling back to placeholder:', error)
          responseContent = await generatePlaceholderResponse(augmentedContent, window)
        }
      } else {
        responseContent = await generatePlaceholderResponse(augmentedContent, window)
      }

      // Save assistant message
      const assistantMsgId = randomUUID()
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)'
      ).run(assistantMsgId, conversationId, 'assistant', responseContent, Date.now())

      return { assistantMsgId }
    }
  )

  ipcMain.handle('chat:stop-generation', async () => {
    await stopGeneration()
    return true
  })
}

function registerMessageHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('message:delete', (_event, id: string) => {
    db.prepare('DELETE FROM messages WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle(
    'message:delete-after',
    (_event, conversationId: string, timestamp: number) => {
      db.prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND timestamp >= ?'
      ).run(conversationId, timestamp)
      return true
    }
  )
}

function registerFileHandlers(): void {
  ipcMain.handle('file:open-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Code & Text',
          extensions: [
            'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h',
            'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'zsh',
            'ps1', 'sql', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css',
            'scss', 'less', 'md', 'txt', 'csv', 'log', 'env', 'cfg', 'ini', 'conf'
          ]
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled) return []

    return result.filePaths.map((filePath) => {
      const stat = statSync(filePath)
      return {
        id: randomUUID(),
        name: basename(filePath),
        path: filePath,
        size: stat.size
      }
    })
  })
}

async function generatePlaceholderResponse(
  _userMessage: string,
  window: BrowserWindow
): Promise<string> {
  const response =
    'Copilot CLI is not available. Install it to get real AI responses, or this placeholder will be used instead. Your messages are being saved to the local database.'

  const words = response.split(' ')
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i]
    window.webContents.send('chat:stream-response', chunk)
    await new Promise((resolve) => setTimeout(resolve, 30))
  }

  window.webContents.send('chat:stream-response', null)
  return response
}
