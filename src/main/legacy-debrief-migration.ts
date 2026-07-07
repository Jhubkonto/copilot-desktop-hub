import type Database from 'better-sqlite3'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { mkdirSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import { formatDebriefMarkdown, type DebriefSectionData } from './debrief-handlers'

const DONE_FLAG_KEY = 'legacy_debrief_artifact_migration_done'

function getStorageRoot(db: Database.Database): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'artifact_storage_root'").get() as { value: string } | undefined
  return row?.value ?? path.join(app.getPath('userData'), 'artifacts')
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artifact'
}

interface LegacyDebriefRow {
  id: string
  conversation_id: string
  project_id: string | null
  summary: string
  commands_tools: string
  reproduction_guide: string
  mental_model: string
  generated_at: number
  created_at: number
}

/**
 * Best-effort, one-time migration of the pre-artifact-system `conversation_debriefs` table
 * (one row per conversation, no versioning) into version-1 debrief artifacts. Runs once at
 * app startup, guarded by a settings flag rather than as a numbered DB migration, because it
 * needs `app.getPath('userData')` for the artifact storage root — a dependency
 * `database-migrations.ts` deliberately avoids so its tests never need to mock Electron.
 * Malformed individual rows are skipped rather than aborting the whole batch; the old table
 * is left in place afterward (unused, not dropped) so this can be safely re-run if interrupted.
 */
export function migrateLegacyDebriefsToArtifacts(db: Database.Database): void {
  const flag = db.prepare("SELECT value FROM settings WHERE key = ?").get(DONE_FLAG_KEY) as { value: string } | undefined
  if (flag?.value === '1') return

  const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversation_debriefs'").get()
  if (!tableExists) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(DONE_FLAG_KEY, '1')
    return
  }

  const rows = db.prepare('SELECT * FROM conversation_debriefs').all() as LegacyDebriefRow[]
  const storageRoot = getStorageRoot(db)

  for (const row of rows) {
    try {
      // Skip if this conversation already has a debrief artifact (e.g. re-run after interruption,
      // or the user already ran /debrief before this migration got a chance to run).
      const alreadyMigrated = db.prepare(
        `SELECT 1 FROM artifact_chat_refs r JOIN artifacts a ON a.id = r.artifact_id
         WHERE r.conversation_id = ? AND a.kind = 'debrief' LIMIT 1`
      ).get(row.conversation_id)
      if (alreadyMigrated) continue

      const conversationRow = db.prepare('SELECT title FROM conversations WHERE id = ?').get(row.conversation_id) as { title: string } | undefined
      if (!conversationRow) continue // conversation no longer exists
      const conversationTitle = conversationRow.title
      const title = `Debrief: ${conversationTitle}`

      const section: DebriefSectionData = {
        summary: row.summary,
        commandsAndTools: (() => { try { return JSON.parse(row.commands_tools) as string[] } catch { return [] } })(),
        reproductionGuide: row.reproduction_guide,
        mentalModel: row.mental_model,
      }

      const artifactId = randomUUID()
      const versionId = randomUUID()
      const versionDir = row.project_id
        ? path.join(storageRoot, 'projects', row.project_id, slugify(title), 'v1')
        : path.join(storageRoot, 'global', slugify(title), 'v1')

      const jsonPath = path.join(versionDir, 'debrief.json')
      const mdPath = path.join(versionDir, 'debrief.md')
      mkdirSync(versionDir, { recursive: true })
      writeFileSync(jsonPath, JSON.stringify(section, null, 2), 'utf8')
      writeFileSync(mdPath, formatDebriefMarkdown(conversationTitle, section), 'utf8')

      const manifestJson = JSON.stringify({
        artifactId, versionId, version: 1, title, kind: 'debrief', createdAt: row.created_at,
        source: { conversationId: row.conversation_id },
        files: [
          { path: 'debrief.json', mediaType: 'application/json', role: 'primary' },
          { path: 'debrief.md', mediaType: 'text/markdown', role: 'supporting' },
        ],
      })

      db.transaction(() => {
        db.prepare(
          `INSERT INTO artifacts (id, project_id, title, kind, description, storage_root, current_version_id, status, created_at, updated_at)
           VALUES (?, ?, ?, 'debrief', ?, ?, ?, 'ready', ?, ?)`
        ).run(artifactId, row.project_id, title, `Migrated from legacy debrief for conversation ${row.conversation_id}`, storageRoot, versionId, row.created_at, row.created_at)
        db.prepare(
          `INSERT INTO artifact_versions (id, artifact_id, version_number, title, notes, spec_json, manifest_json, source_conversation_id, source_message_id, created_at)
           VALUES (?, ?, 1, ?, ?, NULL, ?, ?, NULL, ?)`
        ).run(versionId, artifactId, title, 'Migrated from the legacy conversation_debriefs table', manifestJson, row.conversation_id, row.created_at)
        db.prepare(
          `INSERT INTO artifact_files (id, version_id, relative_path, absolute_path, media_type, role, size_bytes)
           VALUES (?, ?, 'debrief.json', ?, 'application/json', 'primary', ?)`
        ).run(randomUUID(), versionId, jsonPath, statSync(jsonPath).size)
        db.prepare(
          `INSERT INTO artifact_files (id, version_id, relative_path, absolute_path, media_type, role, size_bytes)
           VALUES (?, ?, 'debrief.md', ?, 'text/markdown', 'supporting', ?)`
        ).run(randomUUID(), versionId, mdPath, statSync(mdPath).size)
        db.prepare(
          `INSERT INTO artifact_chat_refs (id, artifact_id, version_id, project_id, conversation_id, message_id, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`
        ).run(randomUUID(), artifactId, versionId, row.project_id, row.conversation_id, row.created_at)
      })()
    } catch {
      // Best-effort — one malformed legacy row shouldn't block the rest of the batch or startup.
    }
  }

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(DONE_FLAG_KEY, '1')
}
