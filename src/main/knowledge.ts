import { getDatabase } from './database'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { safeHandle } from './safe-handle'

export function registerKnowledgeHandlers(): void {
  const db = getDatabase()

  safeHandle('agent:list-knowledge-files', (_event, agentId: string) => {
    return db
      .prepare(
        'SELECT * FROM agent_knowledge_files WHERE agent_id = ? ORDER BY sort_order ASC, created_at ASC'
      )
      .all(agentId)
  })

  safeHandle(
    'agent:add-knowledge-file',
    (_event, agentId: string, filePath: string, injectMode = 'always') => {
      const id = randomUUID()
      const now = Date.now()
      const maxRow = db
        .prepare('SELECT MAX(sort_order) as m FROM agent_knowledge_files WHERE agent_id = ?')
        .get(agentId) as { m: number | null }
      db.prepare(
        'INSERT INTO agent_knowledge_files (id, agent_id, file_path, inject_mode, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, agentId, filePath, injectMode, (maxRow.m ?? -1) + 1, now, now)
      return db.prepare('SELECT * FROM agent_knowledge_files WHERE id = ?').get(id)
    }
  )

  safeHandle('agent:remove-knowledge-file', (_event, id: string) => {
    db.prepare('DELETE FROM agent_knowledge_files WHERE id = ?').run(id)
    return true
  })

  safeHandle('agent:update-knowledge-inject-mode', (_event, id: string, mode: string) => {
    db.prepare(
      'UPDATE agent_knowledge_files SET inject_mode = ?, updated_at = ? WHERE id = ?'
    ).run(mode, Date.now(), id)
    return true
  })

  safeHandle('fs:read-file', (_event, agentId: string, filePath: string) => {
    const row = db
      .prepare('SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?')
      .get(agentId, filePath)
    if (!row) throw new Error('File not registered for this agent')
    if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
    return readFileSync(filePath, 'utf-8')
  })

  safeHandle(
    'fs:write-file',
    (_event, agentId: string, filePath: string, content: string) => {
      const row = db
        .prepare('SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND file_path = ?')
        .get(agentId, filePath)
      if (!row) throw new Error('File not registered for this agent')
      writeFileSync(filePath, content, 'utf-8')
      db.prepare(
        'UPDATE agent_knowledge_files SET updated_at = ? WHERE agent_id = ? AND file_path = ?'
      ).run(Date.now(), agentId, filePath)
      return true
    }
  )
}
