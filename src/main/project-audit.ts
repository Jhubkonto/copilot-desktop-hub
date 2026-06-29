import path from 'path'
import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type {
  ProjectEditSession,
  ProjectEditSource,
  ProjectTouchedFile,
  ProjectTouchedFileStatus,
  RemoteEditStagedFileDiff,
} from '../shared/types'

type RecordProjectAuditChangeInput = {
  sessionId?: string
  projectId?: string | null
  conversationId?: string | null
  agentId?: string | null
  title: string
  source: ProjectEditSource
  relativePath: string
  status: ProjectTouchedFileStatus
  lastOperation: 'write' | 'create' | 'delete' | 'apply'
  diff?: { hunks: unknown[] } | null
}

function normalizeFsPath(filePath: string): string {
  return path.resolve(filePath).replace(/[\\/]+/g, path.sep).toLowerCase()
}

export function inferProjectIdForWorkspace(workspacePath: string): string | null {
  const normalizedWorkspace = normalizeFsPath(workspacePath)
  const rows = getDatabase()
    .prepare('SELECT id, config_json FROM projects')
    .all() as Array<{ id: string; config_json: string | null }>

  for (const row of rows) {
    if (!row.config_json) continue
    try {
      const config = JSON.parse(row.config_json) as { rootDirectory?: unknown }
      if (typeof config.rootDirectory !== 'string' || !config.rootDirectory.trim()) continue
      if (normalizeFsPath(config.rootDirectory) === normalizedWorkspace) return row.id
    } catch {
      continue
    }
  }

  return null
}

export function inferProjectAuditTarget(filePath: string): { projectId: string; relativePath: string } | null {
  const normalizedFile = normalizeFsPath(filePath)
  const rows = getDatabase()
    .prepare('SELECT id, config_json FROM projects')
    .all() as Array<{ id: string; config_json: string | null }>

  let bestMatch: { projectId: string; rootPath: string } | null = null

  for (const row of rows) {
    if (!row.config_json) continue
    try {
      const config = JSON.parse(row.config_json) as { rootDirectory?: unknown }
      if (typeof config.rootDirectory !== 'string' || !config.rootDirectory.trim()) continue
      const normalizedRoot = normalizeFsPath(config.rootDirectory)
      if (
        normalizedFile === normalizedRoot ||
        normalizedFile.startsWith(`${normalizedRoot}${path.sep}`)
      ) {
        if (!bestMatch || normalizedRoot.length > bestMatch.rootPath.length) {
          bestMatch = { projectId: row.id, rootPath: normalizedRoot }
        }
      }
    } catch {
      continue
    }
  }

  if (!bestMatch) return null

  const relativePath = path.relative(bestMatch.rootPath, normalizedFile).replace(/[\\/]+/g, '/')
  return {
    projectId: bestMatch.projectId,
    relativePath: relativePath || path.basename(filePath),
  }
}

export function recordProjectAuditChange(input: RecordProjectAuditChangeInput): string {
  const db = getDatabase()
  const now = Date.now()
  const sessionId = input.sessionId ?? randomUUID()

  db.prepare(
    `INSERT INTO project_edit_sessions (id, project_id, conversation_id, agent_id, title, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id,
       conversation_id = excluded.conversation_id,
       agent_id = excluded.agent_id,
       title = excluded.title,
       source = excluded.source,
       updated_at = excluded.updated_at`
  ).run(
    sessionId,
    input.projectId ?? null,
    input.conversationId ?? null,
    input.agentId ?? null,
    input.title,
    input.source,
    now,
    now,
  )

  const existing = db.prepare(
    'SELECT first_touched_at FROM project_touched_files WHERE session_id = ? AND relative_path = ?'
  ).get(sessionId, input.relativePath) as { first_touched_at: number } | undefined

  db.prepare(
    `INSERT INTO project_touched_files (session_id, relative_path, status, last_operation, first_touched_at, last_touched_at, diff_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, relative_path) DO UPDATE SET
       status = excluded.status,
       last_operation = excluded.last_operation,
       last_touched_at = excluded.last_touched_at,
       diff_json = COALESCE(excluded.diff_json, project_touched_files.diff_json)`
  ).run(
    sessionId,
    input.relativePath,
    input.status,
    input.lastOperation,
    existing?.first_touched_at ?? now,
    now,
    input.diff ? JSON.stringify(input.diff) : null,
  )

  return sessionId
}

function mapSessionRow(row: {
  id: string
  project_id: string | null
  conversation_id: string | null
  agent_id: string | null
  title: string
  source: ProjectEditSource
  created_at: number
  updated_at: number
  file_count: number
}): ProjectEditSession {
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    title: row.title,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileCount: row.file_count,
  }
}

function mapTouchedFileRow(row: {
  session_id: string
  relative_path: string
  status: ProjectTouchedFileStatus
  last_operation: 'write' | 'create' | 'delete' | 'apply'
  first_touched_at: number
  last_touched_at: number
  diff_json: string | null
}): ProjectTouchedFile {
  return {
    sessionId: row.session_id,
    relativePath: row.relative_path,
    status: row.status,
    lastOperation: row.last_operation,
    firstTouchedAt: row.first_touched_at,
    lastTouchedAt: row.last_touched_at,
    diffAvailable: typeof row.diff_json === 'string' && row.diff_json.trim().length > 0,
  }
}

export function listProjectAuditSessions(projectId?: string | null): ProjectEditSession[] {
  const db = getDatabase()
  const rows = (
    projectId === undefined
      ? db.prepare(
          `SELECT s.*, COUNT(f.relative_path) AS file_count
           FROM project_edit_sessions s
           LEFT JOIN project_touched_files f ON f.session_id = s.id
           GROUP BY s.id
           ORDER BY s.updated_at DESC`
        ).all()
      : projectId === null
        ? db.prepare(
            `SELECT s.*, COUNT(f.relative_path) AS file_count
             FROM project_edit_sessions s
             LEFT JOIN project_touched_files f ON f.session_id = s.id
             WHERE s.project_id IS NULL
             GROUP BY s.id
             ORDER BY s.updated_at DESC`
          ).all()
        : db.prepare(
            `SELECT s.*, COUNT(f.relative_path) AS file_count
             FROM project_edit_sessions s
             LEFT JOIN project_touched_files f ON f.session_id = s.id
             WHERE s.project_id = ?
             GROUP BY s.id
             ORDER BY s.updated_at DESC`
          ).all(projectId)
  ) as Array<{
    id: string
    project_id: string | null
    conversation_id: string | null
    agent_id: string | null
    title: string
    source: ProjectEditSource
    created_at: number
    updated_at: number
    file_count: number
  }>

  return rows.map(mapSessionRow)
}

export function listProjectAuditFiles(sessionId: string): ProjectTouchedFile[] {
  const db = getDatabase()
  const rows = db.prepare(
    `SELECT session_id, relative_path, status, last_operation, first_touched_at, last_touched_at, diff_json
     FROM project_touched_files
     WHERE session_id = ?
     ORDER BY last_touched_at DESC, relative_path ASC`
  ).all(sessionId) as Array<{
    session_id: string
    relative_path: string
    status: ProjectTouchedFileStatus
    last_operation: 'write' | 'create' | 'delete' | 'apply'
    first_touched_at: number
    last_touched_at: number
    diff_json: string | null
  }>

  return rows.map(mapTouchedFileRow)
}

export function getProjectAuditDiff(sessionId: string, relativePath: string): RemoteEditStagedFileDiff | null {
  const db = getDatabase()
  const row = db.prepare(
    'SELECT diff_json FROM project_touched_files WHERE session_id = ? AND relative_path = ?'
  ).get(sessionId, relativePath) as { diff_json: string | null } | undefined
  if (!row?.diff_json) return null
  return {
    relativePath,
    ...(JSON.parse(row.diff_json) as { hunks: unknown[] }),
  } as RemoteEditStagedFileDiff
}

export function getRemoteEditAuditDiff(reportId: string, relativePath: string): RemoteEditStagedFileDiff | null {
  if (!reportId || !relativePath) return null
  return getProjectAuditDiff(`remote-edit:${reportId}`, relativePath)
}

export function registerProjectAuditHandlers(): void {
  safeHandle('project-audit:list-sessions', (_event, projectId?: string | null) => {
    return listProjectAuditSessions(projectId)
  })

  safeHandle('project-audit:list-files', (_event, sessionId: string) => {
    return listProjectAuditFiles(sessionId)
  })

  safeHandle('project-audit:get-diff', (_event, sessionId: string, relativePath: string) => {
    return getProjectAuditDiff(sessionId, relativePath)
  })
}
