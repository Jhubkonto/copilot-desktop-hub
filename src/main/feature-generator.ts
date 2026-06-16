import { app } from 'electron'
import path from 'path'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import { getProviderForAgent, getApiKey, sendProviderWithTools } from './providers'
import { runProviderMcpToolLoop } from './tool-loop'
import type { ProviderMessage } from './provider-core-types'
import type { ToolDefinition, ToolChoice, ProviderNonStreamResult } from './provider-types'
import type { FeatureSpec, FeatureGeneratorMessage, FeatureGeneratorRun, FeatureSpecialist } from '../shared/types'
import { getDatabase } from './database'
import { broadcastToMobile } from './ws-server'
import { getStagingDir } from './self-heal/fix-agent'
import { getWorkspacePath } from './self-heal/investigator'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPEC_OPEN_TAG = '<feature-spec>'
const SPEC_CLOSE_TAG = '</feature-spec>'
const PLAN_OPEN_TAG = '<implementation-plan>'
const PLAN_CLOSE_TAG = '</implementation-plan>'

const MAX_FILE_CHARS = 24000

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const FEATURE_GENERATOR_SYSTEM_PROMPT = `You are an expert feature planning assistant for Nexy, an AI-powered multi-agent Electron desktop app.

Your job is to help a developer plan and implement a new feature, bug fix, refactor, or change to the codebase.

## Conversation style
- Ask 2–3 targeted, high-signal questions per turn
- Aim to understand: what to build/change, target surfaces (main process, renderer, Android, database, etc.), constraints, acceptance criteria, and risk tolerance
- Be concise and developer-focused
- When you have enough context (usually 2–3 exchanges), emit the feature spec

## Target surfaces
- desktop-main: Electron main process, IPC handlers, database, background services
- desktop-renderer: React renderer, UI components, Zustand store
- android: Android companion app (Kotlin)
- shared: shared types, protocols, preload bridge
- database: SQLite migrations, schema changes
- build: build scripts, packaging, release tooling
- docs: documentation, roadmap, comments

## Generating the spec
When you have enough context, emit a brief summary followed by a JSON block wrapped in <feature-spec>…</feature-spec> tags. The JSON must match this exact shape:

{
  "title": "Short descriptive title",
  "type": "feature",           // one of: feature, bugfix, refactor, ui, integration, docs, tooling
  "targetAreas": ["desktop-renderer"],   // array of target surfaces
  "userStory": "As a developer, I want to...",
  "acceptanceCriteria": ["AC1", "AC2"],
  "constraints": ["Must not break existing X"],
  "outOfScope": ["Android support (Phase 2)"],
  "risks": ["May conflict with Y"],
  "likelyAffectedFiles": ["src/renderer/components/Foo.tsx"],
  "verificationPlan": ["Run typecheck", "Check in Developer tab"],
  "autonomy": "apply-verify-commit-reload"   // one of: plan-only, staged-diffs, apply-verify-commit-reload
}

Keep acceptanceCriteria concrete and testable. List specific files when known.`

const PLAN_SYSTEM_PROMPT = `You are a senior software architect for Nexy, an Electron + React + better-sqlite3 app.

Given an approved feature spec, produce a detailed implementation plan.

The plan must be wrapped in <implementation-plan>…</implementation-plan> tags.

Inside the tags, write Markdown with these sections:
## Overview
Brief summary of the approach.

## Implementation steps
Numbered steps. Each step names the file(s) to change and what to change.

## IPC/protocol changes
List any new or modified IPC channels, types, preload entries, or WS events.

## Database changes
List any new migrations or schema changes.

## Verification commands
Exact commands to verify: typecheck, lint, tests, manual steps.

## Risks and rollback
Known risks and how to roll back if verification fails.

Be specific: name files, function names, and line ranges when relevant. No generic advice.`

const IMPLEMENTATION_SYSTEM_PROMPT = `You are a senior software engineer implementing a feature in Nexy.

You will be given:
1. An approved feature spec
2. An approved implementation plan
3. The current content of each file to change

For each file, output the COMPLETE new file content wrapped in delimiters:
<<<FILE: relative/path/to/file.ts>>>
... complete file content ...
<<<END_FILE>>>

Rules:
- Output COMPLETE file content — never partial or diff format
- Only output files that need changes
- Follow existing code style exactly
- No comments explaining what changed — just the new code
- If a file does not exist yet, create it with the correct content`

// ---------------------------------------------------------------------------
// Spec/plan extraction and normalization
// ---------------------------------------------------------------------------

function extractFeatureSpec(text: string): FeatureSpec | null {
  const openIdx = text.lastIndexOf(SPEC_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(SPEC_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  const json = text.slice(openIdx + SPEC_OPEN_TAG.length, closeIdx).trim()
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    return normalizeFeatureSpec(raw)
  } catch {
    return null
  }
}

function extractPlan(text: string): string | null {
  const openIdx = text.lastIndexOf(PLAN_OPEN_TAG)
  if (openIdx === -1) return null
  const closeIdx = text.lastIndexOf(PLAN_CLOSE_TAG)
  if (closeIdx === -1 || closeIdx <= openIdx) return null
  return text.slice(openIdx + PLAN_OPEN_TAG.length, closeIdx).trim()
}

const VALID_TYPES = new Set(['feature', 'bugfix', 'refactor', 'ui', 'integration', 'docs', 'tooling'])
const VALID_AREAS = new Set(['desktop-main', 'desktop-renderer', 'android', 'shared', 'database', 'build', 'docs'])
const VALID_AUTONOMY = new Set(['plan-only', 'staged-diffs', 'apply-verify-commit-reload'])

function normalizeFeatureSpec(raw: Record<string, unknown>): FeatureSpec {
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []

  return {
    title: String(raw.title || 'New Feature').trim().slice(0, 120),
    type: VALID_TYPES.has(String(raw.type)) ? (String(raw.type) as FeatureSpec['type']) : 'feature',
    targetAreas: asStringArray(raw.targetAreas).filter((a) => VALID_AREAS.has(a)) as FeatureSpec['targetAreas'],
    userStory: String(raw.userStory || '').trim(),
    acceptanceCriteria: asStringArray(raw.acceptanceCriteria),
    constraints: asStringArray(raw.constraints),
    outOfScope: asStringArray(raw.outOfScope),
    risks: asStringArray(raw.risks),
    likelyAffectedFiles: asStringArray(raw.likelyAffectedFiles),
    verificationPlan: asStringArray(raw.verificationPlan),
    autonomy: VALID_AUTONOMY.has(String(raw.autonomy)) ? (String(raw.autonomy) as FeatureSpec['autonomy']) : 'staged-diffs',
  }
}

// ---------------------------------------------------------------------------
// Provider messages builder
// ---------------------------------------------------------------------------

function buildChatMessages(messages: FeatureGeneratorMessage[]): ProviderMessage[] {
  return [
    { role: 'system', content: FEATURE_GENERATOR_SYSTEM_PROMPT },
    ...messages.map((m): ProviderMessage => ({ role: m.role, content: m.content })),
  ]
}

function buildPlanMessages(spec: FeatureSpec, workspacePath: string): ProviderMessage[] {
  const specJson = JSON.stringify(spec, null, 2)
  return [
    { role: 'system', content: PLAN_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Workspace: ${workspacePath}\n\nApproved feature spec:\n\`\`\`json\n${specJson}\n\`\`\`\n\nProduce a detailed implementation plan.`,
    },
  ]
}

function buildImplementationMessages(
  spec: FeatureSpec,
  plan: string,
  fileContents: { path: string; content: string }[],
  workspacePath: string,
): ProviderMessage[] {
  const filesBlock = fileContents
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, MAX_FILE_CHARS)}\n\`\`\``)
    .join('\n\n')

  return [
    { role: 'system', content: IMPLEMENTATION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Workspace: ${workspacePath}\n\nApproved spec:\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\nApproved plan:\n${plan}\n\nCurrent file contents:\n${filesBlock}\n\nOutput the complete patched files using the <<<FILE:…>>> delimiters.`,
    },
  ]
}

// ---------------------------------------------------------------------------
// Inline tools for discovery chat
// ---------------------------------------------------------------------------

function buildInlineTools(workspacePath: string): Map<string, (args: Record<string, unknown>) => Promise<{ success: boolean; result?: string; error?: string }>> {
  return new Map([
    [
      'read_file',
      async (args) => {
        try {
          const rel = String(args.path ?? '')
          const abs = path.join(workspacePath, rel)
          if (!existsSync(abs) || !statSync(abs).isFile()) return { success: false, error: 'File not found' }
          const content = readFileSync(abs, 'utf8')
          return { success: true, result: content.slice(0, MAX_FILE_CHARS) }
        } catch (e) {
          return { success: false, error: String(e) }
        }
      },
    ],
    [
      'list_directory',
      async (args) => {
        try {
          const { readdirSync } = await import('fs')
          const rel = String(args.path ?? '')
          const abs = path.join(workspacePath, rel)
          const entries = readdirSync(abs, { withFileTypes: true })
          return { success: true, result: entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n') }
        } catch (e) {
          return { success: false, error: String(e) }
        }
      },
    ],
    [
      'grep_pattern',
      async (args) => {
        try {
          const { execSync } = await import('child_process')
          const pattern = String(args.pattern ?? '')
          const searchPath = String(args.path ?? 'src')
          const abs = path.join(workspacePath, searchPath)
          const result = execSync(
            `grep -r --include="*.ts" --include="*.tsx" -n "${pattern.replace(/"/g, '\\"')}" "${abs}" 2>/dev/null | head -50`,
            { encoding: 'utf8', maxBuffer: 1024 * 1024 },
          )
          return { success: true, result: result || '(no matches)' }
        } catch (e) {
          return { success: true, result: '(no matches)' }
        }
      },
    ],
  ])
}

// ---------------------------------------------------------------------------
// Specialist team generation
// ---------------------------------------------------------------------------

function buildSpecialistTeam(spec: FeatureSpec): FeatureSpecialist[] {
  const team: FeatureSpecialist[] = []

  team.push({
    role: 'Lead Implementer',
    description: 'Owns the implementation plan and final integration across all changed files',
    systemPrompt: `You are the lead implementer for the feature: "${spec.title}". Your role is to produce high-quality, complete file patches following the approved implementation plan. You ensure all changes are consistent, well-typed, and follow existing code conventions in this Electron + React + TypeScript + better-sqlite3 codebase.`,
    isTemporary: true,
  })

  if (spec.targetAreas.includes('desktop-renderer')) {
    team.push({
      role: 'Renderer Specialist',
      description: 'Handles React components, Zustand store, and UI/UX for the renderer process',
      systemPrompt: `You are a React and Zustand specialist working on the renderer process of a desktop Electron app. You produce accessible, well-styled TSX components using Tailwind CSS, follow the existing Immer slice pattern for state, and ensure UI changes match the existing design language.`,
      isTemporary: true,
    })
  }

  if (spec.targetAreas.includes('desktop-main')) {
    team.push({
      role: 'Main Process Specialist',
      description: 'Handles Electron main process, IPC handlers, and backend services',
      systemPrompt: `You are an Electron main-process specialist. You register IPC handlers using safeHandle(), add typed channels to IpcReturnMap and IpcChannels in shared/types.ts, add preload bridge entries, and work with better-sqlite3 synchronous DB calls. All new IPC channels must follow the existing naming and registration patterns.`,
      isTemporary: true,
    })
  }

  if (spec.targetAreas.includes('database')) {
    team.push({
      role: 'Database Specialist',
      description: 'Handles SQLite migrations and schema changes',
      systemPrompt: `You are a database specialist for a better-sqlite3 SQLite app. You write append-only numbered migrations in the MIGRATIONS array in database-migrations.ts. You never edit existing migration entries. You map snake_case DB columns to camelCase TypeScript objects in handlers.`,
      isTemporary: true,
    })
  }

  if (spec.targetAreas.includes('android')) {
    team.push({
      role: 'Android Specialist',
      description: 'Handles WebSocket protocol, Android companion app, and mobile events',
      systemPrompt: `You are an Android and WebSocket protocol specialist. You add WS command handlers in ws-handlers.ts using broadcastToMobile(), and describe corresponding Android-side changes in Kotlin.`,
      isTemporary: true,
    })
  }

  team.push({
    role: 'Reviewer',
    description: 'Checks for regressions, missing tests, scope creep, and type safety',
    systemPrompt: `You are a code reviewer for a TypeScript Electron app. You check that all IPC channels are typed, that new DB tables have migrations, that no existing behavior is broken, that tests cover new paths, and that the implementation matches the approved spec. You flag any issues concisely.`,
    isTemporary: true,
  })

  return team
}

// ---------------------------------------------------------------------------
// Implementation output parser
// ---------------------------------------------------------------------------

interface ParsedFile {
  relativePath: string
  content: string
}

function parseImplementationOutput(text: string): ParsedFile[] {
  const results: ParsedFile[] = []
  const filePattern = /<<<FILE:\s*([^\n>]+)>>>([\s\S]*?)<<<END_FILE>>>/g
  let match: RegExpExecArray | null
  while ((match = filePattern.exec(text)) !== null) {
    const relativePath = match[1].trim()
    const content = match[2].replace(/^\n/, '')
    if (relativePath && content) {
      results.push({ relativePath, content })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function createRunRecord(id: string, title: string): void {
  const db = getDatabase()
  const now = Date.now()
  db.prepare(
    `INSERT INTO feature_generator_runs (id, title, status, created_at, updated_at) VALUES (?, ?, 'drafting', ?, ?)`,
  ).run(id, title, now, now)
}

function updateRunRecord(id: string, fields: Partial<{
  status: string
  specJson: string
  teamJson: string
  planMarkdown: string
  stagedFilesJson: string
  appliedFilesJson: string
  verificationJson: string
  commitSha: string
  reloaded: number
  rolledBack: number
}>): void {
  const db = getDatabase()
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status) }
  if (fields.specJson !== undefined) { sets.push('spec_json = ?'); vals.push(fields.specJson) }
  if (fields.teamJson !== undefined) { sets.push('team_json = ?'); vals.push(fields.teamJson) }
  if (fields.planMarkdown !== undefined) { sets.push('plan_markdown = ?'); vals.push(fields.planMarkdown) }
  if (fields.stagedFilesJson !== undefined) { sets.push('staged_files_json = ?'); vals.push(fields.stagedFilesJson) }
  if (fields.appliedFilesJson !== undefined) { sets.push('applied_files_json = ?'); vals.push(fields.appliedFilesJson) }
  if (fields.verificationJson !== undefined) { sets.push('verification_json = ?'); vals.push(fields.verificationJson) }
  if (fields.commitSha !== undefined) { sets.push('commit_sha = ?'); vals.push(fields.commitSha) }
  if (fields.reloaded !== undefined) { sets.push('reloaded = ?'); vals.push(fields.reloaded) }
  if (fields.rolledBack !== undefined) { sets.push('rolled_back = ?'); vals.push(fields.rolledBack) }
  vals.push(id)
  db.prepare(`UPDATE feature_generator_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

function rowToRun(row: Record<string, unknown>): FeatureGeneratorRun {
  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    specJson: row.spec_json != null ? String(row.spec_json) : null,
    teamJson: row.team_json != null ? String(row.team_json) : null,
    planMarkdown: row.plan_markdown != null ? String(row.plan_markdown) : null,
    stagedFilesJson: row.staged_files_json != null ? String(row.staged_files_json) : null,
    appliedFilesJson: row.applied_files_json != null ? String(row.applied_files_json) : null,
    verificationJson: row.verification_json != null ? String(row.verification_json) : null,
    commitSha: row.commit_sha != null ? String(row.commit_sha) : null,
    reloaded: Number(row.reloaded) === 1,
    rolledBack: Number(row.rolled_back) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
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
// Desktop streaming chat
// ---------------------------------------------------------------------------

export async function runFeatureGeneratorChat(
  win: BrowserWindow,
  messages: FeatureGeneratorMessage[],
): Promise<void> {
  const workspacePath = getWorkspacePath()
  const providerMessages = buildChatMessages(messages)
  const sessionId = `feature-gen-${randomUUID()}`
  const inlineHandlers = buildInlineTools(workspacePath)

  let accumulated = ''
  const fullText = await runProviderMcpToolLoop(
    makeCaller(4096, 0.7),
    providerMessages,
    [],
    new Map(),
    sessionId,
    null,
    win.webContents,
    (chunk) => {
      accumulated += chunk
      if (!win.isDestroyed()) win.webContents.send('feature-generator:token', chunk)
    },
    undefined,
    false,
    inlineHandlers,
    undefined,
    undefined,
    false,
  )

  accumulated = fullText || accumulated

  const spec = extractFeatureSpec(accumulated)
  if (spec && !win.isDestroyed()) {
    win.webContents.send('feature-generator:spec-ready', spec)
  }
}

// ---------------------------------------------------------------------------
// Android headless streaming chat
// ---------------------------------------------------------------------------

export async function runFeatureGeneratorChatForAndroid(
  messages: FeatureGeneratorMessage[],
): Promise<void> {
  const workspacePath = getWorkspacePath()
  const providerMessages = buildChatMessages(messages)
  const sessionId = `feature-gen-android-${randomUUID()}`
  const inlineHandlers = buildInlineTools(workspacePath)

  let accumulated = ''
  const fullText = await runProviderMcpToolLoop(
    makeCaller(4096, 0.7),
    providerMessages,
    [],
    new Map(),
    sessionId,
    null,
    { send: () => {}, isDestroyed: () => false } as unknown as Electron.WebContents,
    (chunk) => {
      accumulated += chunk
      broadcastToMobile({ event: 'feature-generator:token', data: { chunk } })
    },
    undefined,
    false,
    inlineHandlers,
    undefined,
    undefined,
    false,
  )

  accumulated = fullText || accumulated

  const spec = extractFeatureSpec(accumulated)
  if (spec) {
    broadcastToMobile({ event: 'feature-generator:spec-ready', data: spec })
  }
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

export async function generateImplementationPlan(
  win: BrowserWindow,
  runId: string,
  spec: FeatureSpec,
): Promise<string> {
  const workspacePath = getWorkspacePath()
  const messages = buildPlanMessages(spec, workspacePath)

  let accumulated = ''
  const fullText = await runProviderMcpToolLoop(
    makeCaller(8192, 0.3),
    messages,
    [],
    new Map(),
    `feature-gen-plan-${runId}`,
    null,
    win.webContents,
    (chunk) => {
      accumulated += chunk
      if (!win.isDestroyed()) win.webContents.send('feature-generator:token', chunk)
    },
    undefined,
    false,
    buildInlineTools(workspacePath),
    undefined,
    undefined,
    false,
  )

  accumulated = fullText || accumulated

  const plan = extractPlan(accumulated) ?? accumulated.trim()
  updateRunRecord(runId, { planMarkdown: plan, status: 'plan-ready' })
  return plan
}

// ---------------------------------------------------------------------------
// Implementation runner
// ---------------------------------------------------------------------------

export async function runFeatureImplementation(
  win: BrowserWindow,
  runId: string,
  spec: FeatureSpec,
  plan: string,
): Promise<void> {
  const workspacePath = getWorkspacePath()
  const stagingDir = path.join(app.getPath('userData'), 'feature-gen', 'staging', runId)
  mkdirSync(stagingDir, { recursive: true })

  updateRunRecord(runId, { status: 'staging' })

  const fileContents: { path: string; content: string }[] = spec.likelyAffectedFiles.map((rel) => {
    try {
      const abs = path.join(workspacePath, rel)
      if (existsSync(abs) && statSync(abs).isFile()) {
        const raw = readFileSync(abs, 'utf8')
        return { path: rel, content: raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) + '\n...[truncated]' : raw }
      }
    } catch {}
    return { path: rel, content: '(file not found — new file)' }
  })

  const messages = buildImplementationMessages(spec, plan, fileContents, workspacePath)

  let accumulated = ''
  const fullText = await runProviderMcpToolLoop(
    makeCaller(16384, 0.1),
    messages,
    [],
    new Map(),
    `feature-gen-impl-${runId}`,
    null,
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

  const parsed = parseImplementationOutput(accumulated)
  const staged: string[] = []

  for (const file of parsed) {
    try {
      const dest = path.join(stagingDir, file.relativePath)
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, file.content, 'utf8')
      staged.push(file.relativePath)

      if (!win.isDestroyed()) {
        win.webContents.send('feature-generator:fix-event', {
          runId,
          file: file.relativePath,
          status: 'staged',
        })
      }
    } catch (e) {
      if (!win.isDestroyed()) {
        win.webContents.send('feature-generator:fix-event', {
          runId,
          file: file.relativePath,
          status: 'error',
        })
      }
    }
  }

  updateRunRecord(runId, { stagedFilesJson: JSON.stringify(staged), status: 'diff-ready' })
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerFeatureGeneratorHandlers(win?: BrowserWindow): void {
  safeHandle('feature-generator:chat', async (_event, messages: FeatureGeneratorMessage[]) => {
    if (!win) throw new Error('No main window available')
    await runFeatureGeneratorChat(win, messages)
    return { started: true }
  })

  safeHandle('feature-generator:generate-plan', async (_event, runId: string, spec: FeatureSpec) => {
    if (!win) throw new Error('No main window available')

    // Ensure run record exists
    const db = getDatabase()
    const existing = db.prepare('SELECT id FROM feature_generator_runs WHERE id = ?').get(runId)
    if (!existing) {
      createRunRecord(runId, spec.title)
    }
    updateRunRecord(runId, { specJson: JSON.stringify(spec), status: 'spec-ready' })

    // Generate specialist team and store it
    const team = buildSpecialistTeam(spec)
    updateRunRecord(runId, { teamJson: JSON.stringify(team) })

    const plan = await generateImplementationPlan(win, runId, spec)
    return { plan }
  })

  safeHandle('feature-generator:start-implementation', async (_event, runId: string, spec: FeatureSpec, plan: string) => {
    if (!win) throw new Error('No main window available')
    await runFeatureImplementation(win, runId, spec, plan)
    return { started: true }
  })

  safeHandle('feature-generator:get-runs', async () => {
    const db = getDatabase()
    const rows = db.prepare('SELECT * FROM feature_generator_runs ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map(rowToRun)
  })

  safeHandle('feature-generator:get-run', async (_event, id: string) => {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM feature_generator_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? rowToRun(row) : null
  })
}

// ---------------------------------------------------------------------------
// Staging dir helper (for use by the renderer via self-heal staging IPC)
// ---------------------------------------------------------------------------

export function getFeatureGenStagingDir(runId: string): string {
  return path.join(app.getPath('userData'), 'feature-gen', 'staging', runId)
}
