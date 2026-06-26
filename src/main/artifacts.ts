import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import type { ArtifactRow, ArtifactVersion, ArtifactFile, ArtifactKind, ArtifactStatus, ArtifactExportFormat } from '../shared/types'
import { exportArtifactVersion } from './artifact-export'
import { app, shell } from 'electron'
import path from 'path'

// ---------------------------------------------------------------------------
// Row converters (snake_case DB → camelCase TS)
// ---------------------------------------------------------------------------

function rowToFile(r: Record<string, unknown>): ArtifactFile {
  return {
    id: String(r.id),
    versionId: String(r.version_id),
    relativePath: String(r.relative_path),
    absolutePath: String(r.absolute_path),
    mediaType: String(r.media_type),
    role: String(r.role),
    sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    checksum: r.checksum != null ? String(r.checksum) : null,
  }
}

function rowToVersion(r: Record<string, unknown>, files?: ArtifactFile[]): ArtifactVersion {
  return {
    id: String(r.id),
    artifactId: String(r.artifact_id),
    versionNumber: Number(r.version_number),
    title: String(r.title),
    notes: r.notes != null ? String(r.notes) : null,
    specJson: r.spec_json != null ? String(r.spec_json) : null,
    manifestJson: String(r.manifest_json ?? '{}'),
    sourceConversationId: r.source_conversation_id != null ? String(r.source_conversation_id) : null,
    sourceMessageId: r.source_message_id != null ? String(r.source_message_id) : null,
    createdByAgentIds: r.created_by_agent_ids != null ? String(r.created_by_agent_ids) : null,
    createdAt: Number(r.created_at),
    files,
  }
}

function rowToArtifact(r: Record<string, unknown>, currentVersion?: ArtifactVersion): ArtifactRow {
  return {
    id: String(r.id),
    projectId: r.project_id != null ? String(r.project_id) : null,
    title: String(r.title),
    kind: String(r.kind) as ArtifactKind,
    description: r.description != null ? String(r.description) : null,
    storageRoot: String(r.storage_root),
    currentVersionId: r.current_version_id != null ? String(r.current_version_id) : null,
    status: String(r.status) as ArtifactStatus,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    currentVersion,
  }
}

function getVersionWithFiles(versionId: string): ArtifactVersion | undefined {
  const db = getDatabase()
  const vRow = db.prepare('SELECT * FROM artifact_versions WHERE id = ?').get(versionId) as Record<string, unknown> | undefined
  if (!vRow) return undefined
  const fileRows = db.prepare('SELECT * FROM artifact_files WHERE version_id = ?').all(versionId) as Record<string, unknown>[]
  return rowToVersion(vRow, fileRows.map(rowToFile))
}

function getVersionsWithFilesBatch(versionIds: string[]): Map<string, ArtifactVersion> {
  if (versionIds.length === 0) return new Map()
  const db = getDatabase()
  const placeholders = versionIds.map(() => '?').join(',')
  const vRows = db.prepare(`SELECT * FROM artifact_versions WHERE id IN (${placeholders})`).all(...versionIds) as Record<string, unknown>[]
  const fileRows = db.prepare(`SELECT * FROM artifact_files WHERE version_id IN (${placeholders})`).all(...versionIds) as Record<string, unknown>[]
  const filesByVersionId = new Map<string, ArtifactFile[]>()
  for (const f of fileRows) {
    const vid = String(f.version_id)
    const existing = filesByVersionId.get(vid)
    if (existing) existing.push(rowToFile(f))
    else filesByVersionId.set(vid, [rowToFile(f)])
  }
  const result = new Map<string, ArtifactVersion>()
  for (const v of vRows) {
    const vid = String(v.id)
    result.set(vid, rowToVersion(v, filesByVersionId.get(vid) ?? []))
  }
  return result
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerArtifactHandlers(): void {
  safeHandle('artifact:list', (_event, projectId?: string) => {
    const db = getDatabase()
    const rows = projectId
      ? (db.prepare('SELECT * FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Record<string, unknown>[])
      : (db.prepare('SELECT * FROM artifacts WHERE project_id IS NULL ORDER BY updated_at DESC').all() as Record<string, unknown>[])

    const versionIds = rows.map((r) => r.current_version_id != null ? String(r.current_version_id) : null).filter((id): id is string => id !== null)
    const versionsById = getVersionsWithFilesBatch(versionIds)
    return rows.map((r) => {
      const currentVersionId = r.current_version_id != null ? String(r.current_version_id) : null
      return rowToArtifact(r, currentVersionId ? versionsById.get(currentVersionId) : undefined)
    })
  })

  safeHandle('artifact:get', (_event, id: string) => {
    const db = getDatabase()
    const r = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!r) return null
    const currentVersionId = r.current_version_id != null ? String(r.current_version_id) : null
    const currentVersion = currentVersionId ? getVersionWithFiles(currentVersionId) : undefined
    return rowToArtifact(r, currentVersion)
  })

  safeHandle('artifact:list-versions', (_event, artifactId: string) => {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC').all(artifactId) as Record<string, unknown>[]
    const versionIds = rows.map((r) => String(r.id))
    const versionsById = getVersionsWithFilesBatch(versionIds)
    return rows.map((r) => versionsById.get(String(r.id)) ?? rowToVersion(r, []))
  })

  safeHandle('artifact:get-version', (_event, versionId: string) => {
    const v = getVersionWithFiles(versionId)
    return v ?? null
  })

  safeHandle('artifact:delete', (_event, id: string) => {
    const db = getDatabase()
    const info = db.prepare('DELETE FROM artifacts WHERE id = ?').run(id)
    return { deleted: info.changes > 0 }
  })

  safeHandle('artifact:move-to-project', (_event, artifactId: string, projectId: string | null) => {
    const db = getDatabase()
    const info = projectId
      ? db.prepare('UPDATE artifacts SET project_id = ?, updated_at = ? WHERE id = ?').run(projectId, Date.now(), artifactId)
      : db.prepare('UPDATE artifacts SET project_id = NULL, updated_at = ? WHERE id = ?').run(Date.now(), artifactId)
    return { ok: info.changes > 0 }
  })

  safeHandle('artifact:export', async (_event, versionId: string, format: string) => {
    const db = getDatabase()
    const vRow = db.prepare('SELECT * FROM artifact_versions WHERE id = ?').get(versionId) as Record<string, unknown> | undefined
    if (!vRow) throw new Error('Version not found')
    const artifactId = String(vRow.artifact_id)
    const aRow = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId) as Record<string, unknown> | undefined
    if (!aRow) throw new Error('Artifact not found')
    const destDir = path.join(app.getPath('downloads'), 'nexy-artifacts', artifactId, `v${vRow.version_number}`)
    const exportPath = await exportArtifactVersion(versionId, format as ArtifactExportFormat, destDir)
    return { exportPath }
  })

  safeHandle('artifact:open-folder', (_event, absolutePath: string) => {
    shell.showItemInFolder(absolutePath)
    return { ok: true }
  })
}
