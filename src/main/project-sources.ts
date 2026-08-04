import { randomUUID } from 'crypto'
import { basename, normalize, resolve } from 'path'
import type Database from 'better-sqlite3'
import type { ProjectRepository, ProjectSource, ProjectSourceKind } from '../shared/types'
import { discoverReposInWorkspace } from './code-change/repo-discovery'

type SourceRow = {
  id: string; project_id: string; label: string; kind: ProjectSourceKind; local_path: string
  enabled: number; is_primary: number; created_at: number; updated_at: number
}
type RepositoryRow = {
  id: string; project_id: string; source_id: string; label: string; relative_path: string
  remote_url: string | null; branch: string | null; dirty: number | null; enabled: number
  available: number; verify_commands_json: string | null; created_at: number; updated_at: number
}

function canonicalPath(value: string): string {
  return normalize(resolve(value.trim()))
}

function mapSource(row: SourceRow): ProjectSource {
  return {
    id: row.id, projectId: row.project_id, label: row.label, kind: row.kind,
    localPath: row.local_path, enabled: row.enabled === 1, isPrimary: row.is_primary === 1,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapRepository(row: RepositoryRow): ProjectRepository {
  let verifyCommands: ProjectRepository['verifyCommands'] = null
  if (row.verify_commands_json) {
    try { verifyCommands = JSON.parse(row.verify_commands_json) as ProjectRepository['verifyCommands'] } catch { verifyCommands = null }
  }
  return {
    id: row.id, projectId: row.project_id, sourceId: row.source_id, label: row.label,
    relativePath: row.relative_path, remoteUrl: row.remote_url, branch: row.branch,
    dirty: row.dirty === null ? null : row.dirty === 1, enabled: row.enabled === 1,
    available: row.available === 1, verifyCommands, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export function ensureLegacyProjectSource(db: Database.Database, projectId: string, rootDirectory: string): void {
  if (!rootDirectory.trim()) return
  const count = db.prepare('SELECT COUNT(*) AS count FROM project_sources WHERE project_id = ?').get(projectId) as { count: number } | undefined
  if ((count?.count ?? 0) > 0) return
  const localPath = canonicalPath(rootDirectory)
  const now = Date.now()
  db.prepare(`INSERT OR IGNORE INTO project_sources
    (id, project_id, label, kind, local_path, enabled, is_primary, created_at, updated_at)
    VALUES (?, ?, ?, 'workspace-root', ?, 1, 1, ?, ?)`)
    .run(randomUUID(), projectId, basename(localPath) || 'Primary source', localPath, now, now)
}

export function setPrimarySourcePath(db: Database.Database, projectId: string, rootDirectory: string): void {
  if (!rootDirectory.trim()) return
  const localPath = canonicalPath(rootDirectory)
  const matching = db.prepare('SELECT id FROM project_sources WHERE project_id = ? AND local_path = ?')
    .get(projectId, localPath) as { id: string } | undefined
  const current = db.prepare('SELECT id FROM project_sources WHERE project_id = ? AND is_primary = 1')
    .get(projectId) as { id: string } | undefined
  const now = Date.now()
  if (matching) {
    const promote = db.transaction(() => {
      db.prepare('UPDATE project_sources SET is_primary = 0, updated_at = ? WHERE project_id = ?').run(now, projectId)
      db.prepare('UPDATE project_sources SET is_primary = 1, updated_at = ? WHERE id = ?').run(now, matching.id)
    })
    promote()
  } else if (current) {
    const replace = db.transaction(() => {
      // Repository identity is scoped to a source and its relative path. Repointing
      // that source changes the identity namespace, so rows discovered under the old
      // root must not be retained or reused by a repository at the replacement root.
      db.prepare('DELETE FROM project_repositories WHERE source_id = ?').run(current.id)
      db.prepare('UPDATE project_sources SET local_path = ?, label = ?, updated_at = ? WHERE id = ?')
        .run(localPath, basename(localPath) || 'Primary source', now, current.id)
    })
    replace()
  } else {
    ensureLegacyProjectSource(db, projectId, localPath)
  }
}

export function listProjectSources(db: Database.Database, projectId: string): { sources: ProjectSource[]; repositories: ProjectRepository[] } {
  const sources = (db.prepare(`SELECT * FROM project_sources WHERE project_id = ?
    ORDER BY is_primary DESC, created_at, label`).all(projectId) as SourceRow[]).map(mapSource)
  const repositories = (db.prepare(`SELECT * FROM project_repositories WHERE project_id = ?
    ORDER BY enabled DESC, label, relative_path`).all(projectId) as RepositoryRow[]).map(mapRepository)
  return { sources, repositories }
}

export async function addProjectSource(
  db: Database.Database,
  projectId: string,
  input: { label?: string; localPath: string; kind?: ProjectSourceKind; scan?: boolean },
): Promise<{ sources: ProjectSource[]; repositories: ProjectRepository[] }> {
  const localPath = canonicalPath(input.localPath)
  const existing = db.prepare('SELECT id FROM project_sources WHERE project_id = ? AND local_path = ?')
    .get(projectId, localPath) as { id: string } | undefined
  let sourceId = existing?.id
  if (!sourceId) {
    sourceId = randomUUID()
    const now = Date.now()
    const hasPrimary = db.prepare('SELECT 1 FROM project_sources WHERE project_id = ? AND is_primary = 1').get(projectId)
    db.prepare(`INSERT INTO project_sources
      (id, project_id, label, kind, local_path, enabled, is_primary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(sourceId, projectId, input.label?.trim() || basename(localPath) || 'Source', input.kind ?? 'workspace-root', localPath, hasPrimary ? 0 : 1, now, now)
  }
  if (input.scan !== false) await rescanProjectSource(db, projectId, sourceId)
  return listProjectSources(db, projectId)
}

export async function rescanProjectSource(db: Database.Database, projectId: string, sourceId: string): Promise<void> {
  const source = db.prepare('SELECT local_path FROM project_sources WHERE id = ? AND project_id = ?')
    .get(sourceId, projectId) as { local_path: string } | undefined
  if (!source) throw new Error('Project source not found')
  const discovered = await discoverReposInWorkspace(source.local_path)
  const now = Date.now()
  const seen = new Set<string>()
  for (const repo of discovered) {
    const relativePath = repo.relativePath || ''
    seen.add(relativePath)
    const current = db.prepare('SELECT id FROM project_repositories WHERE source_id = ? AND relative_path = ?')
      .get(sourceId, relativePath) as { id: string } | undefined
    if (current) {
      db.prepare(`UPDATE project_repositories SET label = ?, branch = ?, dirty = ?, available = 1, updated_at = ? WHERE id = ?`)
        .run(basename(repo.repoRoot), repo.branch, repo.dirty ? 1 : 0, now, current.id)
    } else {
      db.prepare(`INSERT INTO project_repositories
        (id, project_id, source_id, label, relative_path, branch, dirty, enabled, available, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`)
        .run(randomUUID(), projectId, sourceId, basename(repo.repoRoot), relativePath, repo.branch, repo.dirty ? 1 : 0, now, now)
    }
  }
  const existing = db.prepare('SELECT id, relative_path FROM project_repositories WHERE source_id = ?').all(sourceId) as Array<{ id: string; relative_path: string }>
  for (const repo of existing) {
    if (!seen.has(repo.relative_path)) {
      db.prepare('UPDATE project_repositories SET available = 0, updated_at = ? WHERE id = ?').run(now, repo.id)
    }
  }
}

export async function rescanProjectSources(db: Database.Database, projectId: string): Promise<{ sources: ProjectSource[]; repositories: ProjectRepository[] }> {
  const rows = db.prepare('SELECT id FROM project_sources WHERE project_id = ? AND enabled = 1').all(projectId) as Array<{ id: string }>
  for (const row of rows) await rescanProjectSource(db, projectId, row.id)
  return listProjectSources(db, projectId)
}

export function removeProjectSource(db: Database.Database, projectId: string, sourceId: string): { sources: ProjectSource[]; repositories: ProjectRepository[] } {
  const target = db.prepare('SELECT is_primary FROM project_sources WHERE id = ? AND project_id = ?').get(sourceId, projectId) as { is_primary: number } | undefined
  if (!target) return listProjectSources(db, projectId)
  db.prepare('DELETE FROM project_sources WHERE id = ? AND project_id = ?').run(sourceId, projectId)
  if (target.is_primary === 1) {
    const next = db.prepare('SELECT id FROM project_sources WHERE project_id = ? ORDER BY created_at LIMIT 1').get(projectId) as { id: string } | undefined
    if (next) db.prepare('UPDATE project_sources SET is_primary = 1, updated_at = ? WHERE id = ?').run(Date.now(), next.id)
  }
  return listProjectSources(db, projectId)
}

export function removeProjectRepository(
  db: Database.Database,
  projectId: string,
  repositoryId: string,
): { sources: ProjectSource[]; repositories: ProjectRepository[] } {
  db.prepare('DELETE FROM project_repositories WHERE id = ? AND project_id = ?').run(repositoryId, projectId)
  return listProjectSources(db, projectId)
}

export function primarySourcePath(hierarchy: { sources: ProjectSource[] }): string {
  return hierarchy.sources.find((source) => source.isPrimary)?.localPath ?? hierarchy.sources[0]?.localPath ?? ''
}
