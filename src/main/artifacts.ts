import { safeHandle } from './safe-handle'
import { getDatabase } from './database'
import type {
  ArtifactRow,
  ArtifactVersion,
  ArtifactFile,
  ArtifactKind,
  ArtifactStatus,
  ArtifactExportFormat,
  ArtifactPromotionRequest,
  ArtifactPromotionResult,
} from '../shared/types'
import { exportArtifactVersion } from './artifact-export'
import { app, shell, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import path from 'path'

/** Notifies all open windows that an artifact changed, so the chat card and Project
 * Artifacts tab can refresh live instead of only reflecting state as of last mount. */
function broadcastArtifactUpdated(artifactId: string, projectId: string | null): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('artifact:updated', { artifactId, projectId })
  })
}

const ARTIFACT_REF_PREFIX = '__artifact-ref:'

function artifactRefContent(ref: {
  artifactId: string
  versionId?: string
  kind?: ArtifactKind
  pending?: boolean
}): string {
  return `${ARTIFACT_REF_PREFIX}${JSON.stringify(Object.fromEntries(
    Object.entries(ref).filter(([, value]) => value !== undefined),
  ))}`
}

function parseArtifactRefContent(content: string): {
  artifactId?: string
  versionId?: string
  kind?: string
  pending?: boolean
} | null {
  if (!content.startsWith(ARTIFACT_REF_PREFIX)) return null
  try {
    return JSON.parse(content.slice(ARTIFACT_REF_PREFIX.length)) as {
      artifactId?: string
      versionId?: string
      kind?: string
      pending?: boolean
    }
  } catch {
    return null
  }
}

function pinLatestPendingArtifactRefMessage(input: {
  conversationId: string
  artifactId: string
  versionId: string
  kind: ArtifactKind
  pendingSince: number | null
}): void {
  const db = getDatabase()
  const rows = db.prepare(
    `SELECT id, content, timestamp FROM messages
     WHERE conversation_id = ? AND role = 'system' AND content LIKE ?
     ORDER BY timestamp DESC LIMIT 50`,
  ).all(input.conversationId, `${ARTIFACT_REF_PREFIX}%`) as Array<{
    id: string
    content: string
    timestamp: number
  }>

  let fallbackRow: { id: string; content: string } | null = null
  for (const row of rows) {
    const ref = parseArtifactRefContent(row.content)
    if (ref?.artifactId !== input.artifactId || ref.versionId) continue

    if (ref.pending === true) {
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(
        artifactRefContent({
          artifactId: input.artifactId,
          versionId: input.versionId,
          kind: (ref.kind as ArtifactKind | undefined) ?? input.kind,
        }),
        row.id,
      )
      return
    }

    if (
      fallbackRow === null &&
      input.pendingSince !== null &&
      Number(row.timestamp) >= input.pendingSince
    ) {
      fallbackRow = row
    }
  }

  if (fallbackRow) {
    const ref = parseArtifactRefContent(fallbackRow.content)
    db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(
      artifactRefContent({
        artifactId: input.artifactId,
        versionId: input.versionId,
        kind: (ref?.kind as ArtifactKind | undefined) ?? input.kind,
      }),
      fallbackRow.id,
    )
  }
}

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
    conversationId: r.conversation_id != null ? String(r.conversation_id) : null,
    title: String(r.title),
    kind: String(r.kind) as ArtifactKind,
    description: r.description != null ? String(r.description) : null,
    storageRoot: String(r.storage_root),
    currentVersionId: r.current_version_id != null ? String(r.current_version_id) : null,
    status: String(r.status) as ArtifactStatus,
    errorMessage: r.error_message != null ? String(r.error_message) : null,
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

export function getStorageRoot(): string {
  const db = getDatabase()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'artifact_storage_root'").get() as { value: string } | undefined
  return row?.value ?? path.join(app.getPath('userData'), 'artifacts')
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'artifact'
}

function sanitizeRelativeArtifactPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').trim().replace(/^\/+/, '')
  if (!normalized) throw new Error('File path is required')
  if (path.isAbsolute(normalized)) throw new Error('File path must be relative')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('File path must stay within the artifact folder')
  }
  return segments.join('/')
}

function guessMediaType(kind: ArtifactPromotionRequest['kind'], filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.md' || kind === 'document' || kind === 'prompt' || kind === 'plan') return 'text/markdown'
  if (['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html'].includes(ext)) {
    if (ext === '.json') return 'application/json'
    if (ext === '.css') return 'text/css'
    if (ext === '.html') return 'text/html'
    return 'text/plain'
  }
  if (ext === '.txt') return 'text/plain'
  return kind === 'code' ? 'text/plain' : 'text/plain'
}

function deriveArtifactTitle(inputTitle: string, messageContent: string, conversationTitle: string | null): string {
  const explicit = inputTitle.trim()
  if (explicit) return explicit
  const headingMatch = messageContent.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m)
  if (headingMatch?.[1]?.trim()) return headingMatch[1].trim()
  if (conversationTitle?.trim()) return conversationTitle.trim()
  return 'New Artifact'
}

export function promoteConversationMessageToArtifact(input: ArtifactPromotionRequest): ArtifactPromotionResult {
  const db = getDatabase()
  const row = db.prepare(
    `SELECT
        m.id,
        m.conversation_id,
        m.role,
        m.content,
        c.title AS conversation_title,
        c.project_id AS conversation_project_id
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = ?`
  ).get(input.messageId) as
    | {
      id: string
      conversation_id: string
      role: string
      content: string
      conversation_title: string | null
      conversation_project_id: string | null
    }
    | undefined
  if (!row) throw new Error('Message not found')
  if (row.conversation_id !== input.conversationId) throw new Error('Message does not belong to this conversation')
  if (row.role !== 'assistant') throw new Error('Only assistant messages can be saved as artifacts')
  const content = String(row.content ?? '').trim()
  if (!content) throw new Error('Message has no content to save')

  const storageRoot = getStorageRoot()
  const title = deriveArtifactTitle(input.title, content, row.conversation_title)
  const projectId = input.scope.type === 'project' ? (input.scope.projectId ?? row.conversation_project_id ?? null) : null
  if (input.scope.type === 'project' && !projectId) throw new Error('A project artifact requires a project ID')
  const relativePath = sanitizeRelativeArtifactPath(input.filePath)
  const artifactId = randomUUID()
  const versionId = randomUUID()
  const now = Date.now()
  const versionDir = projectId
    ? path.join(storageRoot, 'projects', projectId, slugify(title), 'v1')
    : path.join(storageRoot, 'global', slugify(title), 'v1')
  const absolutePath = path.join(versionDir, ...relativePath.split('/'))
  mkdirSync(path.dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content, 'utf8')
  const sizeBytes = statSync(absolutePath).size
  const manifestJson = JSON.stringify({
    artifactId,
    versionId,
    version: 1,
    title,
    kind: input.kind,
    createdAt: now,
    source: {
      conversationId: input.conversationId,
      messageId: input.messageId,
    },
    files: [{ path: relativePath, mediaType: guessMediaType(input.kind, relativePath), role: 'primary' }],
  })

  db.transaction(() => {
    db.prepare(
      `INSERT INTO artifacts (id, project_id, title, kind, description, storage_root, current_version_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`
    ).run(artifactId, projectId, title, input.kind, `Saved from chat message ${input.messageId}`, storageRoot, versionId, now, now)
    db.prepare(
      `INSERT INTO artifact_versions (id, artifact_id, version_number, title, notes, spec_json, manifest_json, source_conversation_id, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      versionId,
      artifactId,
      1,
      title,
      'Promoted from assistant chat response',
      null,
      manifestJson,
      input.conversationId,
      input.messageId,
      now,
    )
    db.prepare(
      `INSERT INTO artifact_files (id, version_id, relative_path, absolute_path, media_type, role, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), versionId, relativePath, absolutePath, guessMediaType(input.kind, relativePath), 'primary', sizeBytes)
    db.prepare(
      `INSERT INTO artifact_chat_refs (id, artifact_id, version_id, project_id, conversation_id, message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), artifactId, versionId, projectId, input.conversationId, input.messageId, now)
  })()

  return { artifactId, versionId, title }
}

// ---------------------------------------------------------------------------
// Conversation-scoped artifact versioning (used by /debrief and /quiz)
// ---------------------------------------------------------------------------

export interface ConversationArtifactRef {
  artifactId: string
  versionId: string
}

/** Finds the artifact of a given kind most recently linked to a conversation, if any. Checks
 * the direct conversation_id column first (set for artifacts created since that column was
 * added), falling back to artifact_chat_refs for older rows/promoted messages that only have
 * a conversation link via a version's chat ref. */
export function findArtifactForConversation(conversationId: string, kind: ArtifactKind): ArtifactRow | null {
  const db = getDatabase()
  let row = db.prepare(
    `SELECT * FROM artifacts WHERE conversation_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1`
  ).get(conversationId, kind) as Record<string, unknown> | undefined
  if (!row) {
    row = db.prepare(
      `SELECT a.* FROM artifacts a
       JOIN artifact_chat_refs r ON r.artifact_id = a.id
       WHERE r.conversation_id = ? AND a.kind = ?
       ORDER BY a.updated_at DESC LIMIT 1`
    ).get(conversationId, kind) as Record<string, unknown> | undefined
  }
  if (!row) return null
  const currentVersionId = row.current_version_id != null ? String(row.current_version_id) : null
  const currentVersion = currentVersionId ? getVersionWithFiles(currentVersionId) : undefined
  return rowToArtifact(row, currentVersion)
}

/**
 * Creates (or resets) the artifact of `kind` linked to this conversation with status
 * 'generating' and no version yet, so a durable `__artifact-ref:` chat message and the
 * Project Artifacts tab can both show generation as in-progress the instant /debrief or
 * /quiz is run — before the LLM call that actually produces content has returned.
 */
export function createPendingArtifactForConversation(input: {
  conversationId: string
  projectId: string | null
  kind: ArtifactKind
  title: string
}): string {
  const db = getDatabase()
  const existing = findArtifactForConversation(input.conversationId, input.kind)
  const now = Date.now()
  const artifactId = existing?.id ?? randomUUID()
  if (existing) {
    db.prepare(
      `UPDATE artifacts SET status = 'generating', error_message = NULL, title = ?, conversation_id = ?, updated_at = ? WHERE id = ?`
    ).run(input.title, input.conversationId, now, artifactId)
  } else {
    db.prepare(
      `INSERT INTO artifacts (id, project_id, conversation_id, title, kind, description, storage_root, current_version_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'generating', ?, ?)`
    ).run(artifactId, input.projectId, input.conversationId, input.title, input.kind, `Generated from chat conversation ${input.conversationId}`, getStorageRoot(), now, now)
  }
  broadcastArtifactUpdated(artifactId, input.projectId)
  return artifactId
}

/** Marks an in-progress artifact generation as failed, recording the reason so the chat
 * card and Artifacts tab can surface it instead of spinning forever. */
export function markArtifactGenerationFailed(artifactId: string, projectId: string | null, errorMessage: string): void {
  const db = getDatabase()
  db.prepare(`UPDATE artifacts SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`)
    .run(errorMessage, Date.now(), artifactId)
  broadcastArtifactUpdated(artifactId, projectId)
}

/** Reads the content of a named file within an artifact version, or null if not found. */
export function readArtifactVersionFile(versionId: string, relativePath: string): string | null {
  const version = getVersionWithFiles(versionId)
  const file = version?.files?.find((f) => f.relativePath === relativePath)
  if (!file) return null
  return readFileSync(file.absolutePath, 'utf8')
}

interface ConversationArtifactFileInput {
  relativePath: string
  mediaType: string
  role: 'primary' | 'supporting'
  content: string
}

interface WriteArtifactVersionForConversationInput {
  conversationId: string
  projectId: string | null
  kind: ArtifactKind
  title: string
  files: ConversationArtifactFileInput[]
}

/**
 * Creates (or adds a new version to) the artifact of `kind` already linked to this
 * conversation, writing each file to disk and recording it in `artifact_files`. Used by
 * /debrief and /quiz so re-running either command produces a new version under the same
 * artifact rather than an unrelated one, mirroring how a real document gets revised.
 */
export function writeArtifactVersionForConversation(input: WriteArtifactVersionForConversationInput): ConversationArtifactRef {
  const db = getDatabase()
  const existing = findArtifactForConversation(input.conversationId, input.kind)
  const artifactId = existing?.id ?? randomUUID()
  const versionId = randomUUID()
  const now = Date.now()
  const storageRoot = getStorageRoot()
  const pendingSince = existing?.status === 'generating' ? existing.updatedAt : null

  const existingVersionCount = existing
    ? (db.prepare('SELECT COUNT(*) as c FROM artifact_versions WHERE artifact_id = ?').get(artifactId) as { c: number }).c
    : 0
  const versionNumber = existingVersionCount + 1

  const versionDir = input.projectId
    ? path.join(storageRoot, 'projects', input.projectId, slugify(input.title), `v${versionNumber}`)
    : path.join(storageRoot, 'global', slugify(input.title), `v${versionNumber}`)

  const writtenFiles = input.files.map((f) => {
    const relativePath = sanitizeRelativeArtifactPath(f.relativePath)
    const absolutePath = path.join(versionDir, ...relativePath.split('/'))
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, f.content, 'utf8')
    return { ...f, relativePath, absolutePath, sizeBytes: statSync(absolutePath).size }
  })

  const manifestJson = JSON.stringify({
    artifactId,
    versionId,
    version: versionNumber,
    title: input.title,
    kind: input.kind,
    createdAt: now,
    source: { conversationId: input.conversationId },
    files: writtenFiles.map((f) => ({ path: f.relativePath, mediaType: f.mediaType, role: f.role })),
  })

  db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE artifacts SET current_version_id = ?, conversation_id = ?, status = 'ready', error_message = NULL, updated_at = ? WHERE id = ?`
      ).run(versionId, input.conversationId, now, artifactId)
    } else {
      db.prepare(
        `INSERT INTO artifacts (id, project_id, conversation_id, title, kind, description, storage_root, current_version_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`
      ).run(artifactId, input.projectId, input.conversationId, input.title, input.kind, `Generated from chat conversation ${input.conversationId}`, storageRoot, versionId, now, now)
    }
    db.prepare(
      `INSERT INTO artifact_versions (id, artifact_id, version_number, title, notes, spec_json, manifest_json, source_conversation_id, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(versionId, artifactId, versionNumber, input.title, null, null, manifestJson, input.conversationId, null, now)
    for (const f of writtenFiles) {
      db.prepare(
        `INSERT INTO artifact_files (id, version_id, relative_path, absolute_path, media_type, role, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), versionId, f.relativePath, f.absolutePath, f.mediaType, f.role, f.sizeBytes)
    }
    db.prepare(
      `INSERT INTO artifact_chat_refs (id, artifact_id, version_id, project_id, conversation_id, message_id, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).run(randomUUID(), artifactId, versionId, input.projectId, input.conversationId, now)
  })()

  pinLatestPendingArtifactRefMessage({
    conversationId: input.conversationId,
    artifactId,
    versionId,
    kind: input.kind,
    pendingSince,
  })
  broadcastArtifactUpdated(artifactId, input.projectId)
  return { artifactId, versionId }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerArtifactHandlers(): void {
  safeHandle('artifact:list', (_event, projectId?: string) => {
    const db = getDatabase()
    // No projectId means "every artifact regardless of project" (used by the Artifacts pane's
    // "All" scope and the sidebar's new-artifact badge) — NOT "only project-less artifacts".
    // Pass a projectId to scope to one project's artifacts specifically.
    const rows = projectId
      ? (db.prepare('SELECT * FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Record<string, unknown>[])
      : (db.prepare('SELECT * FROM artifacts ORDER BY updated_at DESC').all() as Record<string, unknown>[])

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

  safeHandle('artifact:promote-message', (_event, input: ArtifactPromotionRequest) => {
    return promoteConversationMessageToArtifact(input)
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

  safeHandle('artifact:get-file-content', (_event, versionId: string, relativePath: string) => {
    const content = readArtifactVersionFile(versionId, relativePath)
    if (content === null) throw new Error('File not found in artifact version')
    return { content }
  })
}
