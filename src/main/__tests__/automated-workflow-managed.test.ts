import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBaseSchema, runMigrations } from '../database-migrations'
import type { AutomatedWorkflowSpec } from '../../shared/types'

const { runAgentTurnMock } = vi.hoisted(() => ({ runAgentTurnMock: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir() },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../safe-handle', () => ({ safeHandle: vi.fn() }))
vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))
vi.mock('../agent-turn-runner', () => ({ runAgentTurn: runAgentTurnMock }))
vi.mock('../automated-workflow-generator', () => ({ getAutomatedWorkflowGeneratorModel: () => 'test-model' }))

let db: Database.Database
let testRoot: string
let sourceRoot: string

vi.mock('../database', () => ({ getDatabase: () => db }))

function managedSpec(sourceId: string): AutomatedWorkflowSpec {
  return {
    title: 'Weekly report', goalSummary: 'Create a reviewed report', assumptions: [],
    steps: [
      {
        id: 'collect', kind: 'collect', title: 'Collect notes', summary: '', prompt: 'Snapshot notes',
        expectedOutput: 'Source snapshot',
        inputBindings: [{ bindingId: 'notes', source: { type: 'project-files', projectSourceId: sourceId, include: ['**/*.md'] }, required: true }],
        deliverables: [{ name: 'notes', title: 'Notes snapshot', kind: 'document', primaryPath: 'index.md', mediaType: 'text/markdown' }],
      },
      {
        id: 'draft', kind: 'model', title: 'Draft report', summary: '', prompt: 'Write the weekly report.',
        expectedOutput: 'Markdown report', model: 'test-model', dependsOnStepIds: ['collect'],
        inputBindings: [{ bindingId: 'source-notes', source: { type: 'step-output', stepId: 'collect', outputName: 'notes' }, required: true }],
        deliverables: [{ name: 'report', title: 'Weekly report', kind: 'document', primaryPath: 'weekly.md', mediaType: 'text/markdown' }],
      },
      {
        id: 'review', kind: 'review', title: 'Review report', summary: '', prompt: 'Review', expectedOutput: 'Approved report',
        dependsOnStepIds: ['draft'], reviewSource: { stepId: 'draft', outputName: 'report' },
      },
      {
        id: 'publish', kind: 'publish', title: 'Publish report', summary: '', prompt: 'Publish', expectedOutput: 'Project file',
        dependsOnStepIds: ['review'], reviewSource: { stepId: 'review', outputName: 'report' },
        publishDestination: { type: 'project-file', projectSourceId: sourceId, relativePath: 'reports/weekly.md', conflictPolicy: 'require-new-preview' },
      },
    ],
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  testRoot = mkdtempSync(path.join(os.tmpdir(), 'nexy-managed-workflow-'))
  sourceRoot = path.join(testRoot, 'source')
  mkdirSync(sourceRoot, { recursive: true })
  writeFileSync(path.join(sourceRoot, 'notes.md'), '# Notes\n\nOriginal source.\n')
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initializeBaseSchema(db)
  runMigrations(db)
  db.prepare("INSERT INTO settings (key, value) VALUES ('artifact_storage_root', ?)").run(path.join(testRoot, 'artifacts'))
  db.prepare("INSERT INTO projects (id, name, color, created_at, updated_at) VALUES ('project-1', 'Project', 'blue', 1, 1)").run()
  db.prepare(`INSERT INTO project_sources
    (id, project_id, label, kind, local_path, enabled, is_primary, created_at, updated_at)
    VALUES ('source-1', 'project-1', 'Workspace', 'workspace-root', ?, 1, 1, 1, 1)`).run(sourceRoot)
})

afterEach(() => {
  db.close()
  rmSync(testRoot, { recursive: true, force: true })
})

describe('managed-artifact automated workflow', () => {
  it('snapshots exact sources, creates an immutable draft, reviews an edit, and publishes it', async () => {
    const { saveAutomatedWorkflowRunFromSpec, getAutomatedWorkflowRun } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, advanceAutomatedWorkflowRun } = await import('../automated-workflow-executor')
    const {
      editManagedWorkflowVersion,
      getManagedArtifactVersionContent,
      recordManagedWorkflowReview,
      confirmManagedPublish,
    } = await import('../automated-workflow-managed')

    runAgentTurnMock.mockResolvedValue('# Weekly report\n\nGenerated from original notes.\n')
    const created = saveAutomatedWorkflowRunFromSpec('project-1', managedSpec('source-1'), 'test-model')
    const awaitingReview = await startAutomatedWorkflowRun(created.id)

    expect(awaitingReview?.steps.map((step) => step.status)).toEqual(['done', 'done', 'awaiting_confirmation', 'pending'])
    expect(runAgentTurnMock).toHaveBeenCalledOnce()
    expect(runAgentTurnMock.mock.calls[0][0].taskContent).toContain('Original source.')
    expect(awaitingReview?.steps[0].managed?.bindings[0].artifactVersionId).toBeTruthy()

    const reviewStep = awaitingReview!.steps[2]
    const originalVersionId = reviewStep.managed!.currentVersion!.id
    const original = getManagedArtifactVersionContent(originalVersionId)!
    expect(original.content).toContain('Generated from original notes.')

    const edited = editManagedWorkflowVersion({
      runId: created.id, stepDbId: reviewStep.dbId, expectedVersionId: originalVersionId,
      content: '# Weekly report\n\nHuman-approved edit.\n', client: 'desktop',
    })
    const editedReview = edited.steps[2]
    expect(editedReview.managed?.currentVersion?.id).not.toBe(originalVersionId)
    expect(getManagedArtifactVersionContent(editedReview.managed!.currentVersion!.id)?.versions).toHaveLength(2)

    recordManagedWorkflowReview({
      runId: created.id, stepDbId: reviewStep.dbId,
      artifactVersionId: editedReview.managed!.currentVersion!.id, decision: 'approved', client: 'desktop',
    })
    const awaitingPublish = await advanceAutomatedWorkflowRun(created.id)
    expect(awaitingPublish?.steps[3].status).toBe('awaiting_confirmation')
    expect(awaitingPublish?.steps[3].managed?.publishPreview?.diffText).toContain('+Human-approved edit.')

    const publishStep = awaitingPublish!.steps[3]
    const action = confirmManagedPublish({
      runId: created.id, stepDbId: publishStep.dbId,
      previewId: publishStep.managed!.publishPreview!.id,
      idempotencyKey: 'publish-once', client: 'desktop',
    })
    expect(action.status).toBe('published')
    expect(readFileSync(path.join(sourceRoot, 'reports', 'weekly.md'), 'utf8')).toContain('Human-approved edit.')
    expect(getAutomatedWorkflowRun(created.id)?.status).toBe('done')
  }, 15_000)

  it('invalidates a publish approval when the destination changes after preview', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, advanceAutomatedWorkflowRun } = await import('../automated-workflow-executor')
    const { recordManagedWorkflowReview, confirmManagedPublish } = await import('../automated-workflow-managed')
    runAgentTurnMock.mockResolvedValue('# Weekly report\n\nGenerated.\n')
    const created = saveAutomatedWorkflowRunFromSpec('project-1', managedSpec('source-1'), 'test-model')
    const review = await startAutomatedWorkflowRun(created.id)
    const reviewStep = review!.steps[2]
    recordManagedWorkflowReview({ runId: created.id, stepDbId: reviewStep.dbId,
      artifactVersionId: reviewStep.managed!.currentVersion!.id, decision: 'approved', client: 'android' })
    const publish = await advanceAutomatedWorkflowRun(created.id)
    const publishStep = publish!.steps[3]
    mkdirSync(path.join(sourceRoot, 'reports'), { recursive: true })
    writeFileSync(path.join(sourceRoot, 'reports', 'weekly.md'), 'External change')
    const action = confirmManagedPublish({ runId: created.id, stepDbId: publishStep.dbId,
      previewId: publishStep.managed!.publishPreview!.id, idempotencyKey: 'conflict', client: 'android' })
    expect(action.status).toBe('conflicted')
    expect(readFileSync(path.join(sourceRoot, 'reports', 'weekly.md'), 'utf8')).toBe('External change')
  })

  it('regenerates the producing model step after a review rejection', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, retryAutomatedWorkflowStep } = await import('../automated-workflow-executor')
    const { recordManagedWorkflowReview } = await import('../automated-workflow-managed')
    runAgentTurnMock
      .mockResolvedValueOnce('# Weekly report\n\nFirst draft.\n')
      .mockResolvedValueOnce('# Weekly report\n\nRegenerated draft.\n')
    const created = saveAutomatedWorkflowRunFromSpec('project-1', managedSpec('source-1'), 'test-model')
    const firstReview = await startAutomatedWorkflowRun(created.id)
    const reviewStep = firstReview!.steps[2]

    const rejected = recordManagedWorkflowReview({
      runId: created.id, stepDbId: reviewStep.dbId,
      artifactVersionId: reviewStep.managed!.currentVersion!.id, decision: 'rejected', client: 'desktop',
    })
    expect(rejected.status).toBe('failed')

    const regenerated = await retryAutomatedWorkflowStep(created.id, reviewStep.dbId)
    expect(runAgentTurnMock).toHaveBeenCalledTimes(2)
    expect(regenerated?.status).toBe('awaiting_confirmation')
    expect(regenerated?.steps[1].attempt).toBe(1)
    expect(regenerated?.steps[2].managed?.currentVersion?.versionNumber).toBe(2)
    expect(regenerated?.steps[2].managed?.currentVersion?.id).not.toBe(reviewStep.managed!.currentVersion!.id)
  })

  it('rejects a publish destination that traverses outside the project source', async () => {
    const { saveAutomatedWorkflowRunFromSpec } = await import('../automated-workflow-runs')
    const { startAutomatedWorkflowRun, advanceAutomatedWorkflowRun } = await import('../automated-workflow-executor')
    const { recordManagedWorkflowReview } = await import('../automated-workflow-managed')
    runAgentTurnMock.mockResolvedValue('# Weekly report\n\nGenerated.\n')
    const spec = managedSpec('source-1')
    spec.steps[3].publishDestination = {
      type: 'project-file', projectSourceId: 'source-1', relativePath: '../escaped.md', conflictPolicy: 'require-new-preview',
    }
    const created = saveAutomatedWorkflowRunFromSpec('project-1', spec, 'test-model')
    const review = await startAutomatedWorkflowRun(created.id)
    const reviewStep = review!.steps[2]
    recordManagedWorkflowReview({
      runId: created.id, stepDbId: reviewStep.dbId,
      artifactVersionId: reviewStep.managed!.currentVersion!.id, decision: 'approved', client: 'desktop',
    })

    const failed = await advanceAutomatedWorkflowRun(created.id)

    expect(failed?.steps[3].status).toBe('failed')
    expect(failed?.steps[3].error).toMatch(/stay inside/i)
    expect(existsSync(path.join(testRoot, 'escaped.md'))).toBe(false)
  })
})
