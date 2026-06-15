import { app } from 'electron'
import path from 'path'
import { mkdirSync, writeFileSync, statSync } from 'fs'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import { getProviderForAgent, getApiKey, sendProviderWithTools } from './providers'
import { runProviderMcpToolLoop } from './tool-loop'
import type { ProviderMessage } from './provider-core-types'
import type { ToolDefinition, ToolChoice, ProviderNonStreamResult } from './provider-types'
import type { ArtifactSpec, ArtifactGeneratorMessage, ArtifactGeneratorRun, ArtifactKind, ArtifactExportFormat } from '../shared/types'
import { getDatabase } from './database'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPEC_OPEN_TAG = '<artifact-spec>'
const SPEC_CLOSE_TAG = '</artifact-spec>'

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const ARTIFACT_GENERATOR_SYSTEM_PROMPT = `You are an expert artifact creation assistant for Nexy.

Your job is to help a user create a versioned deliverable — a document, code file, prompt pack, plan, data file, UI spec, agent config, or any other tangible output.

## Conversation style
- Ask 2–3 targeted, high-signal questions per turn
- Aim to understand: what deliverable, audience, format/files needed, global vs project scope, constraints, and acceptance criteria
- Be concise and practical
- When you have enough context (usually 2–3 exchanges), emit the artifact spec

## Artifact kinds
- document: PRDs, briefs, reports, plans, articles, specs
- code: scripts, components, config files, small libraries
- ui: page mockups, screen specs, component sets, HTML/CSS prototypes
- data: JSON, CSV, transformed datasets, analysis outputs
- prompt: prompt packs, system prompts, agent instructions
- agent-config: generated agent/team configuration files
- plan: milestone plans, test plans, launch plans
- bundle: multi-file deliverables that do not fit one category
- other: fallback for user-defined deliverables

## Generating the spec
When you have enough context, emit a brief summary followed by a JSON block wrapped in <artifact-spec>…</artifact-spec> tags. The JSON must match this exact shape:

{
  "title": "Short descriptive title",
  "kind": "document",
  "scope": { "type": "global" },
  "intendedUse": "What this artifact will be used for",
  "audience": "Who will read/use it (optional)",
  "outputFiles": [
    { "path": "output.md", "mediaType": "text/markdown", "role": "primary", "description": "Main document" }
  ],
  "sourceContext": {
    "useProjectInstructions": false,
    "useProjectWiki": false,
    "useConversationContext": false,
    "referencedFiles": []
  },
  "acceptanceCriteria": ["Covers X", "Includes Y section"],
  "exportFormats": ["markdown", "raw-files"]
}

Keep outputFiles specific — name each file with its path and media type. List acceptance criteria as concrete, checkable items.`

const GENERATION_SYSTEM_PROMPT = `You are an expert content creator generating a versioned artifact.

You will be given:
1. An approved artifact spec describing what to create
2. Instructions for each output file

For each output file listed in the spec, generate the complete file content wrapped in delimiters:
<<<FILE: relative/path/to/file>>>
... complete file content ...
<<<END_FILE>>>

Rules:
- Output COMPLETE file content — never partial or placeholder content
- Only output files listed in the spec's outputFiles array
- Match the media type and role of each file
- High quality, production-ready output only
- No meta-commentary outside the delimiters`

// ---------------------------------------------------------------------------
// Spec extraction and normalization
// ---------------------------------------------------------------------------

function extractArtifactSpec(text: string): ArtifactSpec | null {
  const openIdx = text.lastIndexOf(SPEC_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(SPEC_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  const json = text.slice(openIdx + SPEC_OPEN_TAG.length, closeIdx).trim()
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    return normalizeArtifactSpec(raw)
  } catch {
    return null
  }
}

const VALID_KINDS = new Set(['document', 'code', 'ui', 'data', 'prompt', 'agent-config', 'plan', 'bundle', 'other'])
const VALID_EXPORT_FORMATS = new Set(['markdown', 'html', 'json', 'zip', 'raw-files'])
const VALID_FILE_ROLES = new Set(['primary', 'supporting', 'preview', 'source'])

function normalizeArtifactSpec(raw: Record<string, unknown>): ArtifactSpec {
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []

  const rawScope = raw.scope as Record<string, unknown> | undefined
  const scope: ArtifactSpec['scope'] = {
    type: rawScope?.type === 'project' ? 'project' : 'global',
    projectId: rawScope?.projectId != null ? String(rawScope.projectId) : undefined,
  }

  const rawFiles = Array.isArray(raw.outputFiles) ? raw.outputFiles : []
  const outputFiles = rawFiles
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      path: String(f.path ?? 'output.txt'),
      mediaType: String(f.mediaType ?? 'text/plain'),
      role: VALID_FILE_ROLES.has(String(f.role)) ? (String(f.role) as ArtifactSpec['outputFiles'][0]['role']) : 'primary',
      description: f.description != null ? String(f.description) : undefined,
    }))

  const rawSrc = raw.sourceContext as Record<string, unknown> | undefined

  return {
    title: String(raw.title || 'New Artifact').trim().slice(0, 120),
    kind: VALID_KINDS.has(String(raw.kind)) ? (String(raw.kind) as ArtifactKind) : 'document',
    scope,
    intendedUse: String(raw.intendedUse || '').trim(),
    audience: raw.audience != null ? String(raw.audience).trim() : undefined,
    outputFiles: outputFiles.length > 0 ? outputFiles : [{ path: 'output.md', mediaType: 'text/markdown', role: 'primary' }],
    sourceContext: {
      useProjectInstructions: Boolean(rawSrc?.useProjectInstructions),
      useProjectWiki: Boolean(rawSrc?.useProjectWiki),
      useConversationContext: Boolean(rawSrc?.useConversationContext),
      referencedFiles: asStringArray(rawSrc?.referencedFiles),
    },
    acceptanceCriteria: asStringArray(raw.acceptanceCriteria),
    exportFormats: asStringArray(raw.exportFormats).filter((f) => VALID_EXPORT_FORMATS.has(f)) as ArtifactExportFormat[],
  }
}

// ---------------------------------------------------------------------------
// Parse generated file output (<<<FILE: path>>>…<<<END_FILE>>>)
// ---------------------------------------------------------------------------

function parseGenerationOutput(text: string): { relativePath: string; content: string }[] {
  const results: { relativePath: string; content: string }[] = []
  const regex = /<<<FILE:\s*([^\n>]+)>>>([\s\S]*?)<<<END_FILE>>>/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const relativePath = match[1].trim()
    const content = match[2].replace(/^\n/, '').replace(/\n$/, '')
    if (relativePath) results.push({ relativePath, content })
  }
  return results
}

// ---------------------------------------------------------------------------
// Provider messages builder
// ---------------------------------------------------------------------------

function buildChatMessages(messages: ArtifactGeneratorMessage[], projectContext?: string): ProviderMessage[] {
  const systemContent = projectContext
    ? `${ARTIFACT_GENERATOR_SYSTEM_PROMPT}\n\n## Project context\n${projectContext}`
    : ARTIFACT_GENERATOR_SYSTEM_PROMPT
  return [
    { role: 'system', content: systemContent },
    ...messages.map((m): ProviderMessage => ({ role: m.role, content: m.content })),
  ]
}

function buildGenerationMessages(spec: ArtifactSpec): ProviderMessage[] {
  return [
    { role: 'system', content: GENERATION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Generate the following artifact:\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\nOutput each file using the <<<FILE: path>>>…<<<END_FILE>>> delimiters.`,
    },
  ]
}

// ---------------------------------------------------------------------------
// LLM caller factory
// ---------------------------------------------------------------------------

function makeCaller(maxTokens = 4096, temperature = 0.7) {
  const { provider, model } = getProviderForAgent('')
  const apiKey = getApiKey(provider)
  return (msgs: ProviderMessage[], tools: ToolDefinition[] | undefined, toolChoice: ToolChoice): Promise<ProviderNonStreamResult> =>
    sendProviderWithTools(provider, apiKey, model, msgs, tools ?? [], toolChoice, { maxTokens, temperature })
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getStorageRoot(): string {
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

function createRunRecord(id: string, title: string): void {
  const db = getDatabase()
  const now = Date.now()
  db.prepare(
    `INSERT INTO artifact_generator_runs (id, title, status, created_at, updated_at) VALUES (?, ?, 'chatting', ?, ?)`,
  ).run(id, title, now, now)
}

function updateRunRecord(id: string, fields: Partial<{ status: string; specJson: string; artifactId: string }>): void {
  const db = getDatabase()
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status) }
  if (fields.specJson !== undefined) { sets.push('spec_json = ?'); vals.push(fields.specJson) }
  if (fields.artifactId !== undefined) { sets.push('artifact_id = ?'); vals.push(fields.artifactId) }
  vals.push(id)
  db.prepare(`UPDATE artifact_generator_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

function rowToRun(row: Record<string, unknown>): ArtifactGeneratorRun {
  return {
    id: String(row.id),
    artifactId: row.artifact_id != null ? String(row.artifact_id) : null,
    title: String(row.title),
    status: String(row.status),
    specJson: row.spec_json != null ? String(row.spec_json) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

// ---------------------------------------------------------------------------
// Desktop streaming chat
// ---------------------------------------------------------------------------

export async function runArtifactGeneratorChat(
  win: BrowserWindow,
  messages: ArtifactGeneratorMessage[],
  projectId?: string,
): Promise<void> {
  const providerMessages = buildChatMessages(messages)
  const sessionId = `artifact-gen-${randomUUID()}`

  let accumulated = ''
  const fullText = await runProviderMcpToolLoop(
    makeCaller(4096, 0.7),
    providerMessages,
    [],
    new Map(),
    sessionId,
    win.webContents,
    (chunk) => {
      accumulated += chunk
      if (!win.isDestroyed()) win.webContents.send('artifact-generator:token', chunk)
    },
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
  )

  accumulated = fullText || accumulated

  const spec = extractArtifactSpec(accumulated)
  if (spec) {
    if (projectId) spec.scope = { type: 'project', projectId }
    if (!win.isDestroyed()) win.webContents.send('artifact-generator:spec-ready', spec)
  }
}

// ---------------------------------------------------------------------------
// Artifact generation runner
// ---------------------------------------------------------------------------

export async function runArtifactGeneration(
  win: BrowserWindow,
  runId: string,
  spec: ArtifactSpec,
): Promise<void> {
  const db = getDatabase()
  const storageRoot = getStorageRoot()
  const projectId = spec.scope.type === 'project' ? spec.scope.projectId : undefined
  const slug = slugify(spec.title)

  // Determine version number
  let existingArtifactId: string | null = null
  const existingQ = projectId
    ? db.prepare('SELECT id FROM artifacts WHERE project_id = ? AND title = ?').get(projectId, spec.title) as { id: string } | undefined
    : db.prepare('SELECT id FROM artifacts WHERE project_id IS NULL AND title = ?').get(spec.title) as { id: string } | undefined

  if (existingQ) existingArtifactId = existingQ.id

  let versionNumber = 1
  if (existingArtifactId) {
    const maxV = db.prepare('SELECT MAX(version_number) AS v FROM artifact_versions WHERE artifact_id = ?').get(existingArtifactId) as { v: number | null } | undefined
    versionNumber = (maxV?.v ?? 0) + 1
  }

  const versionDir = projectId
    ? path.join(storageRoot, 'projects', projectId, slug, `v${versionNumber}`)
    : path.join(storageRoot, 'global', slug, `v${versionNumber}`)

  mkdirSync(versionDir, { recursive: true })
  updateRunRecord(runId, { status: 'generating' })

  // Generate files via LLM
  const messages = buildGenerationMessages(spec)
  let accumulated = ''
  const fullText = await runProviderMcpToolLoop(
    makeCaller(16384, 0.3),
    messages,
    [],
    new Map(),
    `artifact-gen-files-${runId}`,
    win.webContents,
    (chunk) => { accumulated += chunk },
    undefined,
    false,
    undefined,
    'Output only <<<FILE:…>>> delimited blocks.',
    undefined,
    false,
  )
  accumulated = fullText || accumulated

  const parsed = parseGenerationOutput(accumulated)
  const writtenFiles: { relativePath: string; absolutePath: string; mediaType: string; role: string; sizeBytes: number }[] = []

  for (const f of parsed) {
    try {
      const dest = path.join(versionDir, f.relativePath)
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, f.content, 'utf8')
      const size = statSync(dest).size

      // Match media type and role from spec
      const specFile = spec.outputFiles.find((sf) => sf.path === f.relativePath)
      writtenFiles.push({
        relativePath: f.relativePath,
        absolutePath: dest,
        mediaType: specFile?.mediaType ?? 'text/plain',
        role: specFile?.role ?? 'supporting',
        sizeBytes: size,
      })

      if (!win.isDestroyed()) win.webContents.send('artifact-generator:file-event', { file: f.relativePath, status: 'done' })
    } catch {
      if (!win.isDestroyed()) win.webContents.send('artifact-generator:file-event', { file: f.relativePath, status: 'error' })
    }
  }

  // Persist to DB
  const now = Date.now()
  const artifactId = existingArtifactId ?? randomUUID()
  const versionId = randomUUID()

  const manifestJson = JSON.stringify({
    artifactId,
    versionId,
    version: versionNumber,
    title: spec.title,
    kind: spec.kind,
    createdAt: now,
    files: writtenFiles.map((f) => ({ path: f.relativePath, mediaType: f.mediaType, role: f.role })),
  })

  if (!existingArtifactId) {
    db.prepare(
      `INSERT INTO artifacts (id, project_id, title, kind, description, storage_root, current_version_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
    ).run(artifactId, projectId ?? null, spec.title, spec.kind, spec.intendedUse || null, storageRoot, versionId, now, now)
  } else {
    db.prepare('UPDATE artifacts SET current_version_id = ?, status = ?, updated_at = ? WHERE id = ?').run(versionId, 'ready', now, existingArtifactId)
  }

  db.prepare(
    `INSERT INTO artifact_versions (id, artifact_id, version_number, title, spec_json, manifest_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(versionId, artifactId, versionNumber, spec.title, JSON.stringify(spec), manifestJson, now)

  for (const f of writtenFiles) {
    db.prepare(
      `INSERT INTO artifact_files (id, version_id, relative_path, absolute_path, media_type, role, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), versionId, f.relativePath, f.absolutePath, f.mediaType, f.role, f.sizeBytes)
  }

  updateRunRecord(runId, { status: 'ready', artifactId })
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerArtifactGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle('artifact-generator:chat', async (_event, messages: ArtifactGeneratorMessage[], projectId?: string) => {
    if (!win) throw new Error('No main window available')
    await runArtifactGeneratorChat(win, messages, projectId)
    return { started: true }
  })

  safeHandle('artifact-generator:generate', async (_event, runId: string, spec: ArtifactSpec, projectId?: string) => {
    if (!win) throw new Error('No main window available')
    const db = getDatabase()
    const existing = db.prepare('SELECT id FROM artifact_generator_runs WHERE id = ?').get(runId)
    if (!existing) createRunRecord(runId, spec.title)
    updateRunRecord(runId, { specJson: JSON.stringify(spec) })
    await runArtifactGeneration(win, runId, spec)
    return { started: true }
  })

  safeHandle('artifact-generator:get-runs', async () => {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM artifact_generator_runs ORDER BY created_at DESC LIMIT 100').all() as Record<string, unknown>[]
    return rows.map(rowToRun)
  })

  safeHandle('artifact-generator:get-storage-root', async () => {
    return { path: getStorageRoot() }
  })

  safeHandle('artifact-generator:set-storage-root', async (_event, storagePath: string) => {
    const db = getDatabase()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('artifact_storage_root', ?)").run(storagePath)
    return { ok: true }
  })
}
