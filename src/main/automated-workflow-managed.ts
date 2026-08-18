import { createHash, randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'fs'
import path from 'path'
import { BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import { broadcastToMobile } from './ws-server'
import { computeLineDiff } from './diff-utils'
import {
  getArtifactVersion,
  getStorageRoot,
  listArtifactVersionsForArtifact,
  readArtifactVersionFile,
  writeManagedArtifactVersion,
} from './artifacts'
import { getAutomatedWorkflowRun } from './automated-workflow-runs'
import type {
  AutomatedWorkflowRunDetail,
  AutomatedWorkflowRunStep,
  WorkflowArtifactBindingRecord,
  WorkflowArtifactVersionContent,
  WorkflowClientKind,
  WorkflowEditVersionInput,
  WorkflowPublishAction,
  WorkflowPublishConfirmInput,
  WorkflowPublishPreview,
  WorkflowPublishPreviewInput,
  WorkflowReviewInput,
  WorkflowSourceOption,
} from '../shared/types'

const MAX_SOURCE_FILE_BYTES = 1_000_000
const MAX_SNAPSHOT_BYTES = 4_000_000
const MAX_MANAGED_PROMPT_CHARS = 180_000
const MAX_SOURCE_LIST_RESULTS = 5_000
const IGNORED_SOURCE_DIRECTORIES = new Set(['.git', '.gradle', 'node_modules', 'release', 'build', 'dist'])

type SourceRow = { id: string; project_id: string; label: string; local_path: string; enabled: number }

function checksum(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function notifyRunChanged(runId: string): AutomatedWorkflowRunDetail {
  const run = getAutomatedWorkflowRun(runId)
  if (!run) throw new Error('Workflow run not found')
  try {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('automated-workflow-runs:detail', run)
        window.webContents.send('automated-workflow-runs:changed', { projectId: run.projectId, runId })
      }
    })
  } catch {
    // Tests and headless startup may not expose BrowserWindow.getAllWindows.
  }
  broadcastToMobile({ event: 'automated-workflow-runs:detail', data: { run } })
  broadcastToMobile({ event: 'automated-workflow-runs:changed', data: { projectId: run.projectId, runId } })
  return run
}

function normalizeRelativePath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/')
  if (!trimmed || path.posix.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
    throw new Error('Workflow paths must be project-relative')
  }
  const normalized = path.posix.normalize(trimmed)
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Workflow paths must stay inside the selected project source')
  }
  return normalized.replace(/^\.\//, '')
}

function resolveSource(projectId: string | null, sourceId: string): SourceRow {
  if (!projectId) throw new Error('Managed project-file workflows require a project')
  const row = getDatabase().prepare(`SELECT id, project_id, label, local_path, enabled
    FROM project_sources WHERE id = ? AND project_id = ?`).get(sourceId, projectId) as SourceRow | undefined
  if (!row || row.enabled !== 1) throw new Error('The selected project source is unavailable')
  if (!existsSync(row.local_path)) throw new Error(`Project source "${row.label}" is not available on this desktop`)
  return row
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function resolveConfinedPath(source: SourceRow, relativePath: string, mustExist: boolean): string {
  const normalized = normalizeRelativePath(relativePath)
  const root = realpathSync.native(source.local_path)
  const candidate = path.resolve(root, ...normalized.split('/'))
  if (!isInside(root, candidate)) throw new Error('Resolved path escapes the selected project source')

  let probe = mustExist ? candidate : path.dirname(candidate)
  while (!existsSync(probe)) {
    const parent = path.dirname(probe)
    if (parent === probe || !isInside(root, parent)) throw new Error('Destination parent escapes the project source')
    probe = parent
  }
  const resolvedProbe = realpathSync.native(probe)
  if (!isInside(root, resolvedProbe)) throw new Error('A symbolic link or junction escapes the selected project source')
  if (mustExist) {
    const resolvedCandidate = realpathSync.native(candidate)
    if (!isInside(root, resolvedCandidate)) throw new Error('A symbolic link or junction escapes the selected project source')
    return resolvedCandidate
  }
  return candidate
}

function walkSourceFiles(root: string, relative = '', output: string[] = []): string[] {
  if (output.length >= MAX_SOURCE_LIST_RESULTS) return output
  const directory = relative ? path.join(root, ...relative.split('/')) : root
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (output.length >= MAX_SOURCE_LIST_RESULTS) break
    if (entry.isSymbolicLink()) continue
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!IGNORED_SOURCE_DIRECTORIES.has(entry.name)) walkSourceFiles(root, child, output)
    } else if (entry.isFile()) {
      output.push(child.replace(/\\/g, '/'))
    }
  }
  return output
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeRelativePath(pattern)
  let expression = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    if (character === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        expression += '(?:.*/)?'
        index += 2
      } else {
        expression += '.*'
        index += 1
      }
    } else if (character === '*') expression += '[^/]*'
    else if (character === '?') expression += '[^/]'
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  }
  return new RegExp(`${expression}$`)
}

function resolveIncludes(source: SourceRow, includes: string[]): string[] {
  const candidates = walkSourceFiles(realpathSync.native(source.local_path))
  const selected = new Set<string>()
  for (const include of includes) {
    const normalized = normalizeRelativePath(include)
    const matcher = globToRegExp(normalized)
    for (const candidate of candidates) if (matcher.test(candidate)) selected.add(candidate)
  }
  return [...selected].sort()
}

export function listManagedWorkflowSources(projectId: string): WorkflowSourceOption[] {
  const sources = getDatabase().prepare(`SELECT id, project_id, label, local_path, enabled
    FROM project_sources WHERE project_id = ? AND enabled = 1 ORDER BY is_primary DESC, created_at`)
    .all(projectId) as SourceRow[]
  return sources.flatMap((source) => {
    if (!existsSync(source.local_path)) return []
    return walkSourceFiles(realpathSync.native(source.local_path)).map((relativePath) => {
      const absolutePath = resolveConfinedPath(source, relativePath, true)
      return {
        projectSourceId: source.id,
        projectId: source.project_id,
        label: source.label,
        relativePath,
        sizeBytes: statSync(absolutePath).size,
      }
    })
  })
}

function insertBinding(input: {
  runId: string
  step: AutomatedWorkflowRunStep
  bindingName: string
  direction: 'input' | 'output'
  artifactId: string
  artifactVersionId: string
  sourceStepDbId?: string | null
}): void {
  getDatabase().prepare(`INSERT OR IGNORE INTO automated_workflow_step_artifacts
    (id, run_id, step_id, step_attempt, binding_name, direction, artifact_id,
     artifact_version_id, source_step_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), input.runId, input.step.dbId, input.step.attempt, input.bindingName,
      input.direction, input.artifactId, input.artifactVersionId, input.sourceStepDbId ?? null, Date.now())
}

function outputBinding(run: AutomatedWorkflowRunDetail, stepKey: string, outputName: string): WorkflowArtifactBindingRecord {
  const producer = run.steps.find((step) => step.id === stepKey)
  if (!producer) throw new Error(`Managed input references missing step "${stepKey}"`)
  const binding = [...(producer.managed?.bindings ?? [])].reverse().find((candidate) =>
    candidate.direction === 'output' && candidate.bindingName === outputName && candidate.staleAt === null)
  if (!binding) throw new Error(`Managed input "${outputName}" from step "${stepKey}" is not available`)
  return binding
}

function bindDeclaredStepInputs(run: AutomatedWorkflowRunDetail, step: AutomatedWorkflowRunStep): WorkflowArtifactBindingRecord[] {
  const resolved: WorkflowArtifactBindingRecord[] = []
  for (const declaration of step.inputBindings ?? []) {
    if (declaration.source.type !== 'step-output') continue
    const source = outputBinding(run, declaration.source.stepId, declaration.source.outputName)
    insertBinding({
      runId: run.id, step, bindingName: declaration.bindingId, direction: 'input',
      artifactId: source.artifactId, artifactVersionId: source.artifactVersionId,
      sourceStepDbId: source.stepDbId,
    })
    resolved.push(source)
  }
  return resolved
}

export function executeManagedCollectStep(run: AutomatedWorkflowRunDetail, step: AutomatedWorkflowRunStep): void {
  const declarations = (step.inputBindings ?? []).filter((binding) => binding.source.type === 'project-files')
  const deliverable = step.deliverables?.[0]
  if (!deliverable) throw new Error(`Collect step "${step.title}" has no deliverable definition`)
  const captured: Array<{ source: SourceRow; relativePath: string; content: string; sizeBytes: number; checksum: string }> = []
  let totalBytes = 0
  for (const declaration of declarations) {
    if (declaration.source.type !== 'project-files') continue
    const source = resolveSource(run.projectId, declaration.source.projectSourceId)
    const relativePaths = resolveIncludes(source, declaration.source.include)
    if (declaration.required && relativePaths.length === 0) {
      throw new Error(`Required source binding "${declaration.bindingId}" matched no files`)
    }
    for (const relativePath of relativePaths) {
      const absolutePath = resolveConfinedPath(source, relativePath, true)
      const bytes = readFileSync(absolutePath)
      if (bytes.byteLength > MAX_SOURCE_FILE_BYTES) {
        throw new Error(`Source "${relativePath}" exceeds the ${MAX_SOURCE_FILE_BYTES}-byte file limit`)
      }
      totalBytes += bytes.byteLength
      if (totalBytes > MAX_SNAPSHOT_BYTES) throw new Error(`Source snapshot exceeds the ${MAX_SNAPSHOT_BYTES}-byte run limit`)
      captured.push({ source, relativePath, content: bytes.toString('utf8'), sizeBytes: bytes.byteLength, checksum: checksum(bytes) })
    }
  }
  if (captured.length === 0) throw new Error('Collect step did not capture any source files')

  const priorOutput = [...(step.managed?.bindings ?? [])].reverse().find((binding) =>
    binding.direction === 'output' && binding.bindingName === deliverable.name)
  const indexContent = captured.map((file) =>
    `- ${file.source.label}: ${file.relativePath} (${file.sizeBytes} bytes, sha256 ${file.checksum})`).join('\n')
  const written = writeManagedArtifactVersion({
    projectId: run.projectId,
    artifactId: priorOutput?.artifactId,
    title: deliverable.title,
    kind: deliverable.kind,
    description: `Source snapshot for workflow ${run.title}`,
    files: [
      { relativePath: deliverable.primaryPath, mediaType: deliverable.mediaType, role: 'primary', content: `# Source snapshot\n\n${indexContent}\n` },
      ...captured.map((file) => ({
        relativePath: `sources/${file.source.id}/${file.relativePath}`,
        mediaType: file.relativePath.endsWith('.md') ? 'text/markdown' : 'text/plain',
        role: 'source' as const,
        content: file.content,
      })),
    ],
    manifest: {
      workflow: { runId: run.id, stepDbId: step.dbId, stepAttempt: step.attempt, outputName: deliverable.name },
      snapshotAt: Date.now(),
      sources: captured.map((file) => ({ projectSourceId: file.source.id, relativePath: file.relativePath, sizeBytes: file.sizeBytes, checksum: file.checksum })),
    },
  })
  insertBinding({ runId: run.id, step, bindingName: deliverable.name, direction: 'output',
    artifactId: written.artifactId, artifactVersionId: written.versionId })
  getDatabase().prepare(`UPDATE automated_workflow_run_steps SET output = ?, status = 'done', completed_at = ? WHERE id = ?`)
    .run(`Captured ${captured.length} source file${captured.length === 1 ? '' : 's'} as ${deliverable.title}.`, Date.now(), step.dbId)
}

function versionText(versionId: string): { title: string; blocks: string[] } {
  const version = getArtifactVersion(versionId)
  if (!version?.files?.length) throw new Error(`Managed artifact version ${versionId} has no files`)
  const blocks: string[] = []
  for (const file of version.files) {
    const content = readArtifactVersionFile(versionId, file.relativePath)
    if (content == null) throw new Error(`Managed artifact file "${file.relativePath}" is unavailable`)
    blocks.push(`### ${file.relativePath}\n\n${content}`)
  }
  return { title: version.title, blocks }
}

export function buildManagedModelPrompt(run: AutomatedWorkflowRunDetail, step: AutomatedWorkflowRunStep): string {
  const bindings = bindDeclaredStepInputs(run, step)
  const sections = bindings.map((binding) => {
    const content = versionText(binding.artifactVersionId)
    const declaredName = (step.inputBindings ?? []).find((item) =>
      item.source.type === 'step-output' && item.source.stepId === run.steps.find((candidate) => candidate.dbId === binding.stepDbId)?.id)?.bindingId
      ?? binding.bindingName
    return `## Managed input: ${declaredName} (${content.title})\n\n${content.blocks.join('\n\n')}`
  })
  let projectInstructions = ''
  if (step.includeProjectInstructions && run.projectId) {
    const row = getDatabase().prepare('SELECT config_json FROM projects WHERE id = ?').get(run.projectId) as { config_json: string | null } | undefined
    if (row?.config_json) {
      try {
        const config = JSON.parse(row.config_json) as { instructions?: unknown }
        if (typeof config.instructions === 'string' && config.instructions.trim()) {
          projectInstructions = `\n\n## Project instructions\n\n${config.instructions.trim()}`
        }
      } catch {
        throw new Error('Project instructions could not be parsed for this managed step')
      }
    }
  }
  const prompt = `${sections.join('\n\n')}${projectInstructions}\n\n## Your task\n\n${step.prompt}\n\nReturn only the complete deliverable content.`
  if (prompt.length > MAX_MANAGED_PROMPT_CHARS) {
    throw new Error(`Managed inputs for "${step.title}" require ${prompt.length} characters, exceeding the ${MAX_MANAGED_PROMPT_CHARS}-character limit. Reduce the declared source bindings.`)
  }
  return prompt
}

export function commitManagedModelOutput(run: AutomatedWorkflowRunDetail, step: AutomatedWorkflowRunStep, output: string): void {
  const deliverable = step.deliverables?.[0]
  if (!deliverable) throw new Error(`Model step "${step.title}" has no deliverable definition`)
  const priorOutput = [...(step.managed?.bindings ?? [])].reverse().find((binding) =>
    binding.direction === 'output' && binding.bindingName === deliverable.name)
  const inputVersionIds = (getAutomatedWorkflowRun(run.id)?.steps.find((candidate) => candidate.dbId === step.dbId)?.managed?.bindings ?? [])
    .filter((binding) => binding.stepAttempt === step.attempt && binding.direction === 'input')
    .map((binding) => binding.artifactVersionId)
  const written = writeManagedArtifactVersion({
    projectId: run.projectId,
    artifactId: priorOutput?.artifactId,
    title: deliverable.title,
    kind: deliverable.kind,
    description: `Managed output from workflow ${run.title}`,
    files: [{ relativePath: deliverable.primaryPath, mediaType: deliverable.mediaType, role: 'primary', content: output }],
    manifest: {
      workflow: { runId: run.id, stepDbId: step.dbId, stepAttempt: step.attempt, outputName: deliverable.name },
      inputVersionIds,
    },
    sourceConversationId: step.conversationId,
    createdByAgentIds: step.agentId ? [step.agentId] : undefined,
  })
  insertBinding({ runId: run.id, step, bindingName: deliverable.name, direction: 'output',
    artifactId: written.artifactId, artifactVersionId: written.versionId })
  getDatabase().prepare(`UPDATE automated_workflow_run_steps SET output = ?, status = 'done', completed_at = ? WHERE id = ?`)
    .run(output, Date.now(), step.dbId)
}

export function prepareManagedReviewStep(run: AutomatedWorkflowRunDetail, step: AutomatedWorkflowRunStep): void {
  if (!step.reviewSource) throw new Error(`Review step "${step.title}" has no review source`)
  const source = outputBinding(run, step.reviewSource.stepId, step.reviewSource.outputName)
  insertBinding({
    runId: run.id, step, bindingName: step.reviewSource.outputName, direction: 'input',
    artifactId: source.artifactId, artifactVersionId: source.artifactVersionId, sourceStepDbId: source.stepDbId,
  })
  const now = Date.now()
  getDatabase().transaction(() => {
    getDatabase().prepare(`UPDATE automated_workflow_run_steps SET status = 'awaiting_confirmation',
      output = ?, started_at = COALESCE(started_at, ?), completed_at = ? WHERE id = ?`)
      .run(`Review ${source.artifactVersionId}`, now, now, step.dbId)
    getDatabase().prepare(`UPDATE automated_workflow_runs SET status = 'awaiting_confirmation',
      current_step_id = ?, updated_at = ? WHERE id = ?`).run(step.dbId, now, run.id)
    getDatabase().prepare(`INSERT INTO automated_workflow_attention (id, run_id, step_id, kind, created_at)
      VALUES (?, ?, ?, 'review', ?)`).run(randomUUID(), run.id, step.dbId, now)
  })()
}

function currentReviewBinding(run: AutomatedWorkflowRunDetail, step: AutomatedWorkflowRunStep): WorkflowArtifactBindingRecord {
  const binding = [...(step.managed?.bindings ?? [])].reverse().find((candidate) =>
    candidate.stepAttempt === step.attempt && candidate.staleAt === null &&
    (candidate.direction === 'input' || candidate.direction === 'output'))
  if (!binding) throw new Error('The review target is no longer current')
  return binding
}

function invalidateDownstream(run: AutomatedWorkflowRunDetail, changedStepKey: string, at = Date.now()): void {
  const affected = new Set<string>([changedStepKey])
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of run.steps) {
      if (affected.has(candidate.id)) continue
      if ((candidate.dependsOnStepIds ?? []).some((dependency) => affected.has(dependency))) {
        affected.add(candidate.id)
        changed = true
      }
    }
  }
  const db = getDatabase()
  for (const candidate of run.steps) {
    if (!affected.has(candidate.id) || candidate.id === changedStepKey) continue
    db.prepare(`UPDATE automated_workflow_step_artifacts SET stale_at = COALESCE(stale_at, ?)
      WHERE run_id = ? AND step_id = ?`).run(at, run.id, candidate.dbId)
    db.prepare(`UPDATE automated_workflow_reviews SET superseded_at = COALESCE(superseded_at, ?)
      WHERE run_id = ? AND step_id = ?`).run(at, run.id, candidate.dbId)
    db.prepare(`UPDATE automated_workflow_publish_previews SET invalidated_at = COALESCE(invalidated_at, ?)
      WHERE run_id = ? AND step_id = ?`).run(at, run.id, candidate.dbId)
  }
}

export function editManagedWorkflowVersion(input: WorkflowEditVersionInput): AutomatedWorkflowRunDetail {
  if (input.content.length > MAX_SOURCE_FILE_BYTES) throw new Error('Edited Markdown exceeds the 1 MB document limit')
  const run = getAutomatedWorkflowRun(input.runId)
  const step = run?.steps.find((candidate) => candidate.dbId === input.stepDbId)
  if (!run || !step || step.kind !== 'review' || step.status !== 'awaiting_confirmation') throw new Error('Review step is not editable')
  const current = currentReviewBinding(run, step)
  if (current.artifactVersionId !== input.expectedVersionId) throw new Error(`Edit conflict: the current version is ${current.artifactVersionId}`)
  const version = getArtifactVersion(current.artifactVersionId)
  const primary = version?.files?.find((file) => file.role === 'primary') ?? version?.files?.[0]
  if (!version || !primary) throw new Error('Review artifact version is unavailable')
  const written = writeManagedArtifactVersion({
    projectId: run.projectId,
    artifactId: version.artifactId,
    title: version.title,
    kind: 'document',
    description: `Human-edited workflow deliverable (${input.client})`,
    files: [{ relativePath: primary.relativePath, mediaType: primary.mediaType, role: 'primary', content: input.content }],
    manifest: { workflow: { runId: run.id, stepDbId: step.dbId, editedFromVersionId: version.id, editedByClient: input.client } },
    notes: `Edited during workflow review from version ${version.versionNumber}`,
  })
  const now = Date.now()
  getDatabase().transaction(() => {
    getDatabase().prepare(`UPDATE automated_workflow_step_artifacts SET stale_at = COALESCE(stale_at, ?)
      WHERE run_id = ? AND step_id = ? AND stale_at IS NULL`).run(now, run.id, step.dbId)
    getDatabase().prepare(`UPDATE automated_workflow_reviews SET superseded_at = COALESCE(superseded_at, ?)
      WHERE run_id = ? AND step_id = ?`).run(now, run.id, step.dbId)
    getDatabase().prepare('UPDATE automated_workflow_run_steps SET attempt = attempt + 1, output = ? WHERE id = ?')
      .run(input.content, step.dbId)
  })()
  const refreshed = getAutomatedWorkflowRun(run.id)!
  const refreshedStep = refreshed.steps.find((candidate) => candidate.dbId === step.dbId)!
  insertBinding({
    runId: run.id, step: refreshedStep, bindingName: step.reviewSource?.outputName ?? 'reviewed', direction: 'input',
    artifactId: written.artifactId, artifactVersionId: written.versionId, sourceStepDbId: step.dbId,
  })
  invalidateDownstream(refreshed, step.id, now)
  return notifyRunChanged(run.id)
}

export function recordManagedWorkflowReview(input: WorkflowReviewInput): AutomatedWorkflowRunDetail {
  const run = getAutomatedWorkflowRun(input.runId)
  const step = run?.steps.find((candidate) => candidate.dbId === input.stepDbId)
  if (!run || !step || step.kind !== 'review' || step.status !== 'awaiting_confirmation') throw new Error('Review step is not awaiting a decision')
  const current = currentReviewBinding(run, step)
  if (current.artifactVersionId !== input.artifactVersionId) throw new Error(`Review conflict: the current version is ${current.artifactVersionId}`)
  if (step.managed?.isStale) throw new Error('A stale artifact version cannot be reviewed')
  const now = Date.now()
  getDatabase().transaction(() => {
    getDatabase().prepare(`UPDATE automated_workflow_reviews SET superseded_at = COALESCE(superseded_at, ?)
      WHERE run_id = ? AND step_id = ? AND superseded_at IS NULL`).run(now, run.id, step.dbId)
    getDatabase().prepare(`INSERT OR IGNORE INTO automated_workflow_reviews
      (id, run_id, step_id, artifact_version_id, decision, reviewed_by_client, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), run.id, step.dbId, input.artifactVersionId, input.decision, input.client, now)
    getDatabase().prepare(`UPDATE automated_workflow_attention SET resolved_at = COALESCE(resolved_at, ?)
      WHERE run_id = ? AND step_id = ? AND kind = 'review'`).run(now, run.id, step.dbId)
    if (input.decision === 'approved') {
      insertBinding({
        runId: run.id, step, bindingName: step.reviewSource?.outputName ?? 'approved', direction: 'output',
        artifactId: current.artifactId, artifactVersionId: current.artifactVersionId, sourceStepDbId: current.sourceStepDbId,
      })
      getDatabase().prepare(`UPDATE automated_workflow_run_steps SET status = 'done', completed_at = ? WHERE id = ?`).run(now, step.dbId)
      getDatabase().prepare(`UPDATE automated_workflow_runs SET status = 'pending', current_step_id = NULL, updated_at = ? WHERE id = ?`).run(now, run.id)
    } else {
      getDatabase().prepare(`UPDATE automated_workflow_run_steps SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`)
        .run('The deliverable was rejected during review.', now, step.dbId)
      getDatabase().prepare(`UPDATE automated_workflow_runs SET status = 'failed', error = ?, current_step_id = NULL, updated_at = ? WHERE id = ?`)
        .run('A deliverable was rejected during review.', now, run.id)
    }
  })()
  return notifyRunChanged(run.id)
}

function approvedVersionForPublish(run: AutomatedWorkflowRunDetail, step: AutomatedWorkflowRunStep): WorkflowArtifactBindingRecord {
  if (!step.reviewSource) throw new Error('Publish step has no reviewed source')
  const reviewStep = run.steps.find((candidate) => candidate.id === step.reviewSource?.stepId)
  if (!reviewStep) throw new Error('Publish review step not found')
  const binding = outputBinding(run, step.reviewSource.stepId, step.reviewSource.outputName)
  const approved = getDatabase().prepare(`SELECT id FROM automated_workflow_reviews
    WHERE run_id = ? AND step_id = ? AND artifact_version_id = ? AND decision = 'approved' AND superseded_at IS NULL
    ORDER BY reviewed_at DESC LIMIT 1`).get(run.id, reviewStep.dbId, binding.artifactVersionId)
  if (!approved) throw new Error('Publish requires an approved, current artifact version')
  return binding
}

function renderUnifiedDiff(relativePath: string, before: string, after: string): string {
  const header = `--- a/${relativePath}\n+++ b/${relativePath}`
  const hunks = computeLineDiff(before, after).map((hunk) => [
    hunk.header,
    ...hunk.lines.map((line) => `${line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}${line.content}`),
  ].join('\n'))
  return [header, ...hunks].join('\n')
}

function artifactPrimaryContent(versionId: string): { content: string; checksum: string } {
  const version = getArtifactVersion(versionId)
  const primary = version?.files?.find((file) => file.role === 'primary') ?? version?.files?.[0]
  if (!primary) throw new Error('Artifact version has no publishable file')
  const content = readArtifactVersionFile(versionId, primary.relativePath)
  if (content == null) throw new Error('Artifact content is unavailable')
  return { content, checksum: primary.checksum ?? checksum(content) }
}

export function createManagedPublishPreview(input: WorkflowPublishPreviewInput): WorkflowPublishPreview {
  const run = getAutomatedWorkflowRun(input.runId)
  const step = run?.steps.find((candidate) => candidate.dbId === input.stepDbId)
  if (!run || !step || step.kind !== 'publish' || !step.publishDestination) throw new Error('Publish step is not configured')
  const approved = approvedVersionForPublish(run, step)
  if (approved.artifactVersionId !== input.artifactVersionId) throw new Error(`Publish conflict: the approved version is ${approved.artifactVersionId}`)
  const source = resolveSource(run.projectId, step.publishDestination.projectSourceId)
  const relativePath = normalizeRelativePath(step.publishDestination.relativePath)
  const destination = resolveConfinedPath(source, relativePath, false)
  const before = existsSync(destination) ? readFileSync(resolveConfinedPath(source, relativePath, true), 'utf8') : ''
  const after = artifactPrimaryContent(input.artifactVersionId).content
  const now = Date.now()
  const preview: WorkflowPublishPreview = {
    id: randomUUID(), runId: run.id, stepDbId: step.dbId, artifactVersionId: input.artifactVersionId,
    projectSourceId: source.id, relativePath, destinationChecksum: existsSync(destination) ? checksum(before) : null,
    diffText: renderUnifiedDiff(relativePath, before, after), createdAt: now, expiresAt: null, invalidatedAt: null,
  }
  getDatabase().transaction(() => {
    getDatabase().prepare(`UPDATE automated_workflow_publish_previews SET invalidated_at = COALESCE(invalidated_at, ?)
      WHERE run_id = ? AND step_id = ? AND invalidated_at IS NULL`).run(now, run.id, step.dbId)
    getDatabase().prepare(`INSERT INTO automated_workflow_publish_previews
      (id, run_id, step_id, artifact_version_id, project_source_id, relative_path,
       destination_checksum, before_content_ref, diff_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(preview.id, run.id, step.dbId, preview.artifactVersionId, source.id, relativePath,
        preview.destinationChecksum, preview.diffText, now)
  })()
  notifyRunChanged(run.id)
  return preview
}

export function prepareManagedPublishStep(run: AutomatedWorkflowRunDetail, step: AutomatedWorkflowRunStep): WorkflowPublishPreview {
  const approved = approvedVersionForPublish(run, step)
  insertBinding({
    runId: run.id, step, bindingName: step.reviewSource?.outputName ?? 'approved', direction: 'input',
    artifactId: approved.artifactId, artifactVersionId: approved.artifactVersionId, sourceStepDbId: approved.stepDbId,
  })
  const now = Date.now()
  getDatabase().prepare(`UPDATE automated_workflow_run_steps SET status = 'awaiting_confirmation',
    output = ?, started_at = COALESCE(started_at, ?), completed_at = ? WHERE id = ?`)
    .run(`Preparing publish preview for ${step.publishDestination?.relativePath ?? 'destination'}`, now, now, step.dbId)
  getDatabase().prepare(`UPDATE automated_workflow_runs SET status = 'awaiting_confirmation', current_step_id = ?, updated_at = ? WHERE id = ?`)
    .run(step.dbId, now, run.id)
  const preview = createManagedPublishPreview({ runId: run.id, stepDbId: step.dbId, artifactVersionId: approved.artifactVersionId })
  getDatabase().prepare(`INSERT INTO automated_workflow_attention (id, run_id, step_id, kind, created_at)
    VALUES (?, ?, ?, 'publish', ?)`).run(randomUUID(), run.id, step.dbId, now)
  return preview
}

function mapAction(row: Record<string, unknown>): WorkflowPublishAction {
  return {
    id: String(row.id), previewId: String(row.preview_id), idempotencyKey: String(row.idempotency_key),
    status: String(row.status) as WorkflowPublishAction['status'],
    approvedByClient: String(row.approved_by_client) as WorkflowClientKind,
    approvedAt: Number(row.approved_at), startedAt: row.started_at == null ? null : Number(row.started_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    resultChecksum: row.result_checksum == null ? null : String(row.result_checksum),
    error: row.error == null ? null : String(row.error),
  }
}

export function confirmManagedPublish(input: WorkflowPublishConfirmInput): WorkflowPublishAction {
  const db = getDatabase()
  const duplicate = db.prepare('SELECT * FROM automated_workflow_publish_actions WHERE idempotency_key = ?')
    .get(input.idempotencyKey) as Record<string, unknown> | undefined
  if (duplicate) return mapAction(duplicate)
  const run = getAutomatedWorkflowRun(input.runId)
  const step = run?.steps.find((candidate) => candidate.dbId === input.stepDbId)
  const previewRow = db.prepare('SELECT * FROM automated_workflow_publish_previews WHERE id = ? AND run_id = ? AND step_id = ?')
    .get(input.previewId, input.runId, input.stepDbId) as Record<string, unknown> | undefined
  if (!run || !step || step.kind !== 'publish' || !previewRow || previewRow.invalidated_at != null) throw new Error('Publish preview is no longer current')
  const approved = approvedVersionForPublish(run, step)
  if (approved.artifactVersionId !== String(previewRow.artifact_version_id)) throw new Error('The approved artifact version changed after preview')

  const actionId = randomUUID()
  const approvedAt = Date.now()
  db.prepare(`INSERT INTO automated_workflow_publish_actions
    (id, preview_id, idempotency_key, status, approved_by_client, approved_at)
    VALUES (?, ?, ?, 'pending', ?, ?)`)
    .run(actionId, input.previewId, input.idempotencyKey, input.client, approvedAt)
  const source = resolveSource(run.projectId, String(previewRow.project_source_id))
  const relativePath = String(previewRow.relative_path)
  const destination = resolveConfinedPath(source, relativePath, false)
  const beforeExists = existsSync(destination)
  const before = beforeExists ? readFileSync(resolveConfinedPath(source, relativePath, true)) : null
  const currentChecksum = before ? checksum(before) : null
  const previewChecksum = previewRow.destination_checksum == null ? null : String(previewRow.destination_checksum)
  if (currentChecksum !== previewChecksum) {
    const now = Date.now()
    db.prepare(`UPDATE automated_workflow_publish_actions SET status = 'conflicted', completed_at = ?, error = ? WHERE id = ?`)
      .run(now, 'Destination changed after preview. Create a new preview.', actionId)
    db.prepare('UPDATE automated_workflow_publish_previews SET invalidated_at = ? WHERE id = ?').run(now, input.previewId)
    db.prepare(`INSERT INTO automated_workflow_attention (id, run_id, step_id, kind, created_at)
      VALUES (?, ?, ?, 'publish-conflict', ?)`).run(randomUUID(), run.id, step.dbId, now)
    notifyRunChanged(run.id)
    return mapAction(db.prepare('SELECT * FROM automated_workflow_publish_actions WHERE id = ?').get(actionId) as Record<string, unknown>)
  }

  const artifact = artifactPrimaryContent(approved.artifactVersionId)
  mkdirSync(path.dirname(destination), { recursive: true })
  const recoveryDir = path.join(getStorageRoot(), 'workflow-recovery', actionId)
  mkdirSync(recoveryDir, { recursive: true })
  const recoveryPath = before ? path.join(recoveryDir, 'before') : null
  if (before && recoveryPath) {
    const descriptor = openSync(recoveryPath, 'wx')
    try { writeSync(descriptor, before); fsyncSync(descriptor) } finally { closeSync(descriptor) }
  }
  const temporaryPath = path.join(path.dirname(destination), `.nexy-${actionId}.tmp`)
  const descriptor = openSync(temporaryPath, 'wx')
  try { writeSync(descriptor, Buffer.from(artifact.content, 'utf8')); fsyncSync(descriptor) } finally { closeSync(descriptor) }

  db.prepare(`UPDATE automated_workflow_publish_actions SET status = 'publishing', started_at = ?, before_recovery_ref = ? WHERE id = ?`)
    .run(Date.now(), recoveryPath, actionId)
  let replacementSwapPath: string | null = null
  try {
    if (beforeExists) {
      replacementSwapPath = path.join(recoveryDir, 'replace-swap')
      renameSync(destination, replacementSwapPath)
      try { renameSync(temporaryPath, destination) } catch (error) {
        renameSync(replacementSwapPath, destination)
        replacementSwapPath = null
        throw error
      }
    } else renameSync(temporaryPath, destination)
    const resultChecksum = checksum(readFileSync(destination))
    if (resultChecksum !== artifact.checksum) throw new Error('Published file checksum does not match the approved artifact version')
    if (replacementSwapPath && existsSync(replacementSwapPath)) unlinkSync(replacementSwapPath)
    replacementSwapPath = null
    const completedAt = Date.now()
    db.transaction(() => {
      db.prepare(`UPDATE automated_workflow_publish_actions SET status = 'published', completed_at = ?, result_checksum = ?, error = NULL WHERE id = ?`)
        .run(completedAt, resultChecksum, actionId)
      db.prepare(`UPDATE automated_workflow_run_steps SET status = 'done', output = ?, completed_at = ? WHERE id = ?`)
        .run(`Published approved artifact to ${relativePath}`, completedAt, step.dbId)
      db.prepare(`UPDATE automated_workflow_attention SET resolved_at = COALESCE(resolved_at, ?)
        WHERE run_id = ? AND step_id = ? AND kind IN ('publish', 'publish-conflict')`).run(completedAt, run.id, step.dbId)
      const refreshed = getAutomatedWorkflowRun(run.id)!
      const allTerminal = refreshed.steps.every((candidate) => candidate.dbId === step.dbId || candidate.status === 'done' || candidate.status === 'skipped')
      db.prepare(`UPDATE automated_workflow_runs SET status = ?, current_step_id = NULL, error = NULL, updated_at = ? WHERE id = ?`)
        .run(allTerminal ? 'done' : 'pending', completedAt, run.id)
    })()
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    // Keep a failed publication from leaving an unverified destination behind. During a replace,
    // the original stays in the recovery directory until checksum verification succeeds. For a
    // new file, remove the unverified result. The durable recovery copy remains available either
    // way for manual reconciliation after an unexpected process crash.
    let rollbackError: string | null = null
    try {
      if (replacementSwapPath && existsSync(replacementSwapPath)) {
        if (existsSync(destination)) unlinkSync(destination)
        renameSync(replacementSwapPath, destination)
      } else if (!beforeExists && existsSync(destination)) {
        unlinkSync(destination)
      }
    } catch (rollbackFailure) {
      rollbackError = rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure)
    }
    const baseMessage = error instanceof Error ? error.message : String(error)
    const message = rollbackError ? `${baseMessage} Recovery also failed: ${rollbackError}` : baseMessage
    db.prepare(`UPDATE automated_workflow_publish_actions SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`)
      .run(Date.now(), message, actionId)
  }
  notifyRunChanged(run.id)
  return mapAction(db.prepare('SELECT * FROM automated_workflow_publish_actions WHERE id = ?').get(actionId) as Record<string, unknown>)
}

export function getManagedArtifactVersionContent(versionId: string): WorkflowArtifactVersionContent | null {
  const version = getArtifactVersion(versionId)
  if (!version) return null
  const primary = version.files?.find((file) => file.role === 'primary') ?? version.files?.[0]
  if (!primary) return null
  const content = readArtifactVersionFile(versionId, primary.relativePath)
  if (content == null) return null
  const summaries = listArtifactVersionsForArtifact(version.artifactId).map((candidate) => {
    const file = candidate.files?.find((item) => item.role === 'primary') ?? candidate.files?.[0]
    return {
      id: candidate.id, artifactId: candidate.artifactId, versionNumber: candidate.versionNumber,
      title: candidate.title, primaryPath: file?.relativePath ?? '', mediaType: file?.mediaType ?? 'text/plain',
      sizeBytes: file?.sizeBytes ?? 0, checksum: file?.checksum ?? null, createdAt: candidate.createdAt,
    }
  })
  return {
    version: summaries.find((candidate) => candidate.id === versionId)!,
    content,
    manifestJson: version.manifestJson,
    versions: summaries,
  }
}

export function getManagedBindings(runId: string, stepDbId?: string): WorkflowArtifactBindingRecord[] {
  const run = getAutomatedWorkflowRun(runId)
  if (!run) return []
  return run.steps.filter((step) => !stepDbId || step.dbId === stepDbId).flatMap((step) => step.managed?.bindings ?? [])
}

export function resetManagedWorkflowFromStep(runId: string, stepDbId: string): AutomatedWorkflowRunDetail {
  const run = getAutomatedWorkflowRun(runId)
  const requested = run?.steps.find((step) => step.dbId === stepDbId)
  if (!run || !requested || !requested.kind) throw new Error('Managed workflow step not found')
  // "Regenerate" at a review gate means regenerate the deliverable, not merely bind the same
  // rejected version to a fresh review attempt. Start from its declared producer and invalidate
  // the complete transitive chain through review and publish.
  const origin = requested.kind === 'review' && requested.reviewSource
    ? run.steps.find((step) => step.id === requested.reviewSource?.stepId) ?? requested
    : requested
  const affected = new Set<string>([origin.id])
  let changed = true
  while (changed) {
    changed = false
    for (const step of run.steps) {
      if (!affected.has(step.id) && (step.dependsOnStepIds ?? []).some((dependency) => affected.has(dependency))) {
        affected.add(step.id); changed = true
      }
    }
  }
  const now = Date.now()
  getDatabase().transaction(() => {
    for (const step of run.steps) {
      if (!affected.has(step.id)) continue
      getDatabase().prepare(`UPDATE automated_workflow_step_artifacts SET stale_at = COALESCE(stale_at, ?)
        WHERE run_id = ? AND step_id = ?`).run(now, run.id, step.dbId)
      getDatabase().prepare(`UPDATE automated_workflow_reviews SET superseded_at = COALESCE(superseded_at, ?)
        WHERE run_id = ? AND step_id = ?`).run(now, run.id, step.dbId)
      getDatabase().prepare(`UPDATE automated_workflow_publish_previews SET invalidated_at = COALESCE(invalidated_at, ?)
        WHERE run_id = ? AND step_id = ?`).run(now, run.id, step.dbId)
      getDatabase().prepare(`UPDATE automated_workflow_run_steps SET status = 'pending', attempt = attempt + 1,
        output = '', error = NULL, conversation_id = NULL, started_at = NULL, completed_at = NULL WHERE id = ?`).run(step.dbId)
    }
    getDatabase().prepare(`UPDATE automated_workflow_runs SET status = 'pending', current_step_id = NULL,
      error = NULL, updated_at = ? WHERE id = ?`).run(now, run.id)
  })()
  return notifyRunChanged(run.id)
}

export function registerManagedAutomatedWorkflowHandlers(): void {
  safeHandle('automated-workflow-managed:list-sources', (_event, projectId: string) => listManagedWorkflowSources(projectId))
  safeHandle('automated-workflow-managed:get-version', (_event, versionId: string) => getManagedArtifactVersionContent(versionId))
  safeHandle('automated-workflow-managed:get-bindings', (_event, runId: string, stepDbId?: string) => getManagedBindings(runId, stepDbId))
  safeHandle('automated-workflow-managed:edit-version', (_event, input: WorkflowEditVersionInput) =>
    editManagedWorkflowVersion({ ...input, client: 'desktop' }))
  safeHandle('automated-workflow-managed:review', async (_event, input: WorkflowReviewInput) => {
    const detail = recordManagedWorkflowReview({ ...input, client: 'desktop' })
    if (input.decision === 'approved' && detail.status !== 'done') {
      const { advanceAutomatedWorkflowRun } = await import('./automated-workflow-executor')
      return (await advanceAutomatedWorkflowRun(input.runId)) ?? detail
    }
    return detail
  })
  safeHandle('automated-workflow-managed:regenerate', async (_event, runId: string, stepDbId: string) => {
    resetManagedWorkflowFromStep(runId, stepDbId)
    const { advanceAutomatedWorkflowRun } = await import('./automated-workflow-executor')
    return advanceAutomatedWorkflowRun(runId)
  })
  safeHandle('automated-workflow-managed:create-preview', (_event, input: WorkflowPublishPreviewInput) => createManagedPublishPreview(input))
  safeHandle('automated-workflow-managed:confirm-publish', async (_event, input: WorkflowPublishConfirmInput) => {
    const action = confirmManagedPublish({ ...input, client: 'desktop' })
    if (action.status === 'published') {
      const current = getAutomatedWorkflowRun(input.runId)
      if (current?.status === 'pending') {
        const { advanceAutomatedWorkflowRun } = await import('./automated-workflow-executor')
        await advanceAutomatedWorkflowRun(input.runId)
      }
    }
    return action
  })
}
