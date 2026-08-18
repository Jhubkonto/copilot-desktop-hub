import path from 'path'
import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import type {
  ProjectEditSession,
  ProjectEditSource,
  ProjectTouchedFile,
  ProjectTouchedFileStatus,
  ProjectFileDiff,
} from '../shared/types'

type RecordProjectAuditChangeInput = {
  sessionId?: string
  projectId?: string | null
  conversationId?: string | null
  agentId?: string | null
  title: string
  source: ProjectEditSource
  sourceId?: string | null
  sourceLabel?: string | null
  repositoryId?: string | null
  repositoryLabel?: string | null
  relativePath: string
  displayPath?: string
  status: ProjectTouchedFileStatus
  lastOperation: 'write' | 'create' | 'delete' | 'apply'
  branch?: string | null
  commitHash?: string | null
  legacyRepositoryUnknown?: boolean
  diff?: { hunks: unknown[] } | null
}

export type ProjectAuditTarget = {
  projectId: string
  sourceId: string | null
  sourceLabel: string | null
  repositoryId: string | null
  repositoryLabel: string | null
  relativePath: string
  displayPath: string
  branch: string | null
}

function canonicalFsPath(filePath: string): string {
  return path.resolve(filePath).replace(/[\\/]+/g, path.sep)
}

function comparableFsPath(filePath: string): string {
  const canonical = canonicalFsPath(filePath)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function isInside(rootPath: string, filePath: string): boolean {
  const root = comparableFsPath(rootPath)
  const file = comparableFsPath(filePath)
  return file === root || file.startsWith(`${root}${path.sep}`)
}

function slashPath(value: string): string {
  return value.replace(/[\\/]+/g, '/')
}

export function inferProjectIdForWorkspace(workspacePath: string): string | null {
  const normalizedWorkspace = comparableFsPath(workspacePath)
  const source = getDatabase().prepare(
    `SELECT s.project_id, s.local_path, r.relative_path
     FROM project_sources s
     LEFT JOIN project_repositories r ON r.source_id = s.id
     WHERE s.enabled = 1`
  ).all() as Array<{ project_id: string; local_path: string; relative_path: string | null }>
  for (const row of source) {
    const candidate = row.relative_path === null ? row.local_path : path.join(row.local_path, row.relative_path)
    if (comparableFsPath(candidate) === normalizedWorkspace) return row.project_id
  }

  const rows = getDatabase().prepare('SELECT id, config_json FROM projects').all() as Array<{ id: string; config_json: string | null }>

  for (const row of rows) {
    if (!row.config_json) continue
    try {
      const config = JSON.parse(row.config_json) as { rootDirectory?: unknown }
      if (typeof config.rootDirectory !== 'string' || !config.rootDirectory.trim()) continue
      if (comparableFsPath(config.rootDirectory) === normalizedWorkspace) return row.id
    } catch {
      continue
    }
  }

  return null
}

export function inferProjectAuditTarget(filePath: string, projectId?: string | null): ProjectAuditTarget | null {
  const absoluteFile = canonicalFsPath(filePath)
  const rows = getDatabase().prepare(
    `SELECT s.id AS source_id, s.project_id, s.label AS source_label, s.local_path,
            r.id AS repository_id, r.label AS repository_label, r.relative_path AS repository_path,
            r.branch
     FROM project_sources s
     LEFT JOIN project_repositories r ON r.source_id = s.id AND r.enabled = 1
     WHERE s.enabled = 1 AND (? IS NULL OR s.project_id = ?)`
  ).all(projectId ?? null, projectId ?? null) as Array<{
    source_id: string; project_id: string; source_label: string; local_path: string
    repository_id: string | null; repository_label: string | null; repository_path: string | null
    branch: string | null
  }>

  let bestMatch: (typeof rows)[number] & { matchRoot: string; repositoryMatch: boolean } | null = null
  for (const row of rows) {
    const repositoryRoot = row.repository_id ? path.join(row.local_path, row.repository_path ?? '') : null
    const matchRoot = repositoryRoot && isInside(repositoryRoot, absoluteFile) ? repositoryRoot
      : isInside(row.local_path, absoluteFile) ? row.local_path
        : null
    if (!matchRoot) continue
    const repositoryMatch = repositoryRoot !== null && comparableFsPath(matchRoot) === comparableFsPath(repositoryRoot)
    if (!bestMatch || comparableFsPath(matchRoot).length > comparableFsPath(bestMatch.matchRoot).length ||
      (comparableFsPath(matchRoot).length === comparableFsPath(bestMatch.matchRoot).length && repositoryMatch && !bestMatch.repositoryMatch)) {
      bestMatch = { ...row, matchRoot, repositoryMatch }
    }
  }

  if (!bestMatch) {
    const projects = (projectId
      ? getDatabase().prepare('SELECT id, config_json FROM projects WHERE id = ?').all(projectId)
      : getDatabase().prepare('SELECT id, config_json FROM projects').all()) as Array<{ id: string; config_json: string | null }>
    let legacyMatch: { projectId: string; rootPath: string } | null = null
    for (const project of projects) {
      try {
        const rootDirectory = (JSON.parse(project.config_json ?? '{}') as { rootDirectory?: unknown }).rootDirectory
        if (typeof rootDirectory !== 'string' || !rootDirectory.trim() || !isInside(rootDirectory, absoluteFile)) continue
        const rootPath = canonicalFsPath(rootDirectory)
        if (!legacyMatch || comparableFsPath(rootPath).length > comparableFsPath(legacyMatch.rootPath).length) {
          legacyMatch = { projectId: project.id, rootPath }
        }
      } catch { /* malformed legacy project config */ }
    }
    if (!legacyMatch) return null
    const legacyRelativePath = slashPath(path.relative(legacyMatch.rootPath, absoluteFile)) || path.basename(absoluteFile)
    return {
      projectId: legacyMatch.projectId,
      sourceId: null,
      sourceLabel: null,
      repositoryId: null,
      repositoryLabel: null,
      relativePath: legacyRelativePath,
      displayPath: legacyRelativePath,
      branch: null,
    }
  }
  const repositoryId = bestMatch.repositoryMatch ? bestMatch.repository_id : null
  const relativePath = slashPath(path.relative(bestMatch.matchRoot, absoluteFile))
  const displayPath = slashPath(path.relative(bestMatch.local_path, absoluteFile))
  return {
    projectId: bestMatch.project_id,
    sourceId: bestMatch.source_id,
    sourceLabel: bestMatch.source_label,
    repositoryId,
    repositoryLabel: repositoryId ? bestMatch.repository_label : null,
    relativePath: relativePath || path.basename(absoluteFile),
    displayPath: displayPath || path.basename(absoluteFile),
    branch: repositoryId ? bestMatch.branch : null,
  }
}

export function recordProjectAuditChange(input: RecordProjectAuditChangeInput): string {
  const db = getDatabase()
  const now = Date.now()
  const sessionId = input.sessionId ?? randomUUID()

  // Session and touched-file rows are written atomically: if the file insert throws, the
  // session insert is rolled back too, so a failed record never leaves an orphan 0-file session.
  db.transaction(() => {
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
    `SELECT id, first_touched_at FROM project_touched_files
     WHERE session_id = ? AND IFNULL(source_id, '') = IFNULL(?, '')
       AND IFNULL(repository_id, '') = IFNULL(?, '') AND relative_path = ?`
  ).get(sessionId, input.sourceId ?? null, input.repositoryId ?? null, input.relativePath) as { id: string; first_touched_at: number } | undefined
  const fileId = existing?.id ?? randomUUID()

  db.prepare(
    `INSERT INTO project_touched_files
       (id, session_id, source_id, source_label, repository_id, repository_label, relative_path,
        display_path, status, last_operation, branch, commit_hash, legacy_repository_unknown,
        first_touched_at, last_touched_at, diff_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_id = excluded.source_id,
       source_label = COALESCE(excluded.source_label, project_touched_files.source_label),
       repository_id = excluded.repository_id,
       repository_label = COALESCE(excluded.repository_label, project_touched_files.repository_label),
       display_path = excluded.display_path,
       status = excluded.status,
       last_operation = excluded.last_operation,
       branch = COALESCE(excluded.branch, project_touched_files.branch),
       commit_hash = COALESCE(excluded.commit_hash, project_touched_files.commit_hash),
       legacy_repository_unknown = excluded.legacy_repository_unknown,
       last_touched_at = excluded.last_touched_at,
       diff_json = COALESCE(excluded.diff_json, project_touched_files.diff_json)`
  ).run(
    fileId,
    sessionId,
    input.sourceId ?? null,
    input.sourceLabel ?? null,
    input.repositoryId ?? null,
    input.repositoryLabel ?? null,
    input.relativePath,
    input.displayPath ?? input.relativePath,
    input.status,
    input.lastOperation,
    input.branch ?? null,
    input.commitHash ?? null,
    // better-sqlite3 rejects boolean binds ("can only bind numbers, strings, bigints,
    // buffers, and null"), so coerce to 0/1. Binding the raw boolean here threw and, because
    // the session row is inserted first, silently produced 0-file audit sessions.
    (input.legacyRepositoryUnknown ?? (!input.repositoryId && !input.sourceId)) ? 1 : 0,
    existing?.first_touched_at ?? now,
    now,
    input.diff ? JSON.stringify(input.diff) : null,
  )
  })()

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
  id: string
  session_id: string
  source_id: string | null
  source_label: string | null
  repository_id: string | null
  repository_label: string | null
  repository_available: number | null
  relative_path: string
  display_path: string
  status: ProjectTouchedFileStatus
  last_operation: 'write' | 'create' | 'delete' | 'apply'
  branch: string | null
  commit_hash: string | null
  legacy_repository_unknown: number
  first_touched_at: number
  last_touched_at: number
  diff_json: string | null
}): ProjectTouchedFile {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceId: row.source_id,
    sourceLabel: row.source_label,
    repositoryId: row.repository_id,
    repositoryLabel: row.repository_label,
    repositoryAvailable: row.repository_available === null ? null : row.repository_available === 1,
    relativePath: row.relative_path,
    displayPath: row.display_path,
    status: row.status,
    lastOperation: row.last_operation,
    branch: row.branch,
    commitHash: row.commit_hash,
    legacyRepositoryUnknown: row.legacy_repository_unknown === 1,
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
    `SELECT f.id, f.session_id, f.source_id, COALESCE(s.label, f.source_label) AS source_label,
            f.repository_id, COALESCE(r.label, f.repository_label) AS repository_label,
            r.available AS repository_available, f.relative_path, f.display_path, f.status,
            f.last_operation, f.branch, f.commit_hash, f.legacy_repository_unknown,
            f.first_touched_at, f.last_touched_at, f.diff_json
     FROM project_touched_files f
     LEFT JOIN project_sources s ON s.id = f.source_id
     LEFT JOIN project_repositories r ON r.id = f.repository_id
     WHERE f.session_id = ?
     ORDER BY COALESCE(r.label, f.repository_label, s.label, f.source_label, 'Legacy / repository unknown'),
              f.last_touched_at DESC, f.relative_path ASC`
  ).all(sessionId) as Array<{
    id: string; session_id: string
    source_id: string | null; source_label: string | null
    repository_id: string | null; repository_label: string | null; repository_available: number | null
    relative_path: string
    display_path: string
    status: ProjectTouchedFileStatus
    last_operation: 'write' | 'create' | 'delete' | 'apply'
    branch: string | null; commit_hash: string | null; legacy_repository_unknown: number
    first_touched_at: number
    last_touched_at: number
    diff_json: string | null
  }>

  return rows.map(mapTouchedFileRow)
}

export function getProjectAuditDiff(sessionId: string, relativePath: string, fileId?: string | null): ProjectFileDiff | null {
  const db = getDatabase()
  const row = (fileId
    ? db.prepare('SELECT diff_json FROM project_touched_files WHERE id = ? AND session_id = ?').get(fileId, sessionId)
    : db.prepare(`SELECT diff_json FROM project_touched_files WHERE session_id = ? AND relative_path = ?
        ORDER BY last_touched_at DESC LIMIT 1`).get(sessionId, relativePath)) as { diff_json: string | null } | undefined
  if (!row?.diff_json) return null
  return {
    relativePath,
    ...(JSON.parse(row.diff_json) as { hunks: unknown[] }),
  } as ProjectFileDiff
}
