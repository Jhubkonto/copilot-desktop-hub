import path from 'path'
import { mkdirSync, cpSync, copyFileSync } from 'fs'
import type { ArtifactExportFormat } from '../shared/types'
import { getDatabase } from './database'

function rowToFiles(versionId: string): { absolutePath: string; relativePath: string; mediaType: string }[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM artifact_files WHERE version_id = ?').all(versionId) as Record<string, unknown>[]
  return rows.map((r) => ({
    absolutePath: String(r.absolute_path),
    relativePath: String(r.relative_path),
    mediaType: String(r.media_type),
  }))
}

export async function exportArtifactVersion(
  versionId: string,
  format: ArtifactExportFormat,
  destDir: string,
): Promise<string> {
  mkdirSync(destDir, { recursive: true })

  const files = rowToFiles(versionId)
  if (files.length === 0) throw new Error('No files found for this artifact version')

  const versionDir = path.dirname(files[0].absolutePath)

  if (format === 'raw-files') {
    cpSync(versionDir, destDir, { recursive: true })
    return destDir
  }

  if (format === 'markdown') {
    const mdFiles = files.filter((f) => f.relativePath.endsWith('.md'))
    if (mdFiles.length === 0) throw new Error('No Markdown files in this artifact version')
    for (const f of mdFiles) {
      const dest = path.join(destDir, path.basename(f.absolutePath))
      copyFileSync(f.absolutePath, dest)
    }
    return destDir
  }

  if (format === 'json') {
    const jsonFiles = files.filter((f) => f.relativePath.endsWith('.json'))
    for (const f of jsonFiles) {
      const dest = path.join(destDir, path.basename(f.absolutePath))
      copyFileSync(f.absolutePath, dest)
    }
    // Also write the manifest
    const db = getDatabase()
    const vRow = db.prepare('SELECT manifest_json FROM artifact_versions WHERE id = ?').get(versionId) as Record<string, unknown> | undefined
    if (vRow?.manifest_json) {
      const { writeFileSync } = await import('fs')
      writeFileSync(path.join(destDir, 'manifest.json'), String(vRow.manifest_json), 'utf8')
    }
    return destDir
  }

  throw new Error(`Export format '${format}' is not yet supported`)
}
