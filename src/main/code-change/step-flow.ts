/**
 * Code Changes orchestration layer: independent actions invoked directly by slash commands
 * (desktop) or the WS equivalents (Android). No conversation is hijacked and no fixed step
 * order is enforced — each action only checks the data precondition it actually needs.
 */

import path from 'path'
import type { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import {
  runInvestigation,
} from '../remote-edit/investigator'
import {
  runFix,
} from '../remote-edit/fix-agent'
import {
  runVerification,
} from '../remote-edit/verifier'
import {
  commitRemoteEditFix,
  pushRemoteEditFix,
} from '../remote-edit/git-ops'
import { prepareReload, rollbackHeal } from '../remote-edit/recovery'
import { broadcastToMobile } from '../ws-server'
import { createErrorReport } from '../error-report-handlers'
import { getProjectRootDirectory, detectProjectWorkspaceMetadata } from '../project-handlers'
import { discoverReposInWorkspace } from './repo-discovery'
import type { ErrorReportEntry } from '../../shared/types'

export type ResolveRepoResult =
  | { ok: true; repoRoot: string; relativePath: string }
  | { ok: false; reason: 'no-repo' | 'ambiguous'; candidates?: string[] }

/**
 * Resolves which git repo under a project's workspace an action should target.
 *
 * A project's `workspace_root` is just the folder the user pointed the project at — it is
 * not guaranteed to itself be a git repo, even when one or more repos exist underneath it
 * (e.g. a workspace root containing `frontend/` and `backend/` as two separately-initialized
 * repos, with the root itself never `git init`'d). So this walks the workspace for any repo
 * anywhere underneath it rather than checking the root directory alone.
 */
export async function resolveCodeChangeRepo(
  workspaceRoot: string,
  repoRelativePath?: string,
): Promise<ResolveRepoResult> {
  if (repoRelativePath) {
    const candidateRoot = path.join(workspaceRoot, repoRelativePath)
    const metadata = detectProjectWorkspaceMetadata(candidateRoot)
    if (!metadata?.isGitRepo) {
      return { ok: false, reason: 'no-repo' }
    }
    return { ok: true, repoRoot: metadata.repoRoot ?? candidateRoot, relativePath: repoRelativePath }
  }

  const repos = await discoverReposInWorkspace(workspaceRoot)
  if (repos.length === 0) {
    return { ok: false, reason: 'no-repo' }
  }
  if (repos.length === 1) {
    return { ok: true, repoRoot: repos[0].repoRoot, relativePath: repos[0].relativePath }
  }
  return { ok: false, reason: 'ambiguous', candidates: repos.map((r) => r.relativePath) }
}

async function resolveRepoOrThrow(
  workspaceRoot: string,
  repoRelativePath?: string,
): Promise<{ repoRoot: string; relativePath: string }> {
  const result = await resolveCodeChangeRepo(workspaceRoot, repoRelativePath)
  if (!result.ok) {
    if (result.reason === 'ambiguous') {
      throw new Error(
        `Multiple git repos found in this workspace: ${result.candidates!.join(', ')}. Specify which one and try again.`,
      )
    }
    if (repoRelativePath) {
      // The user (or an earlier report) named a specific repo path — the workspace may well have
      // other valid repos, so the generic "nothing found anywhere" message would be misleading.
      throw new Error(
        `"${repoRelativePath}" isn't a git repository under this project's workspace. Check the path and try again.`,
      )
    }
    throw new Error(
      "No git repository was found under this project's workspace. Initialize one (git init) in the folder you want to work in, then try again.",
    )
  }
  return { repoRoot: result.repoRoot, relativePath: result.relativePath }
}

/**
 * Updates the step column for a code change request. Purely descriptive status now (surfaced
 * by /code-status) — it is no longer used to gate which actions are callable.
 */
export function advanceStep(reportId: string, nextStep: 'describe' | 'plan-review' | 'executing' | 'verifying' | 'final-review' | 'attention'): void {
  const now = Date.now()
  getDatabase()
    .prepare('UPDATE error_reports SET step = ?, updated_at = ? WHERE id = ?')
    .run(nextStep, now, reportId)

  broadcastToMobile({
    event: 'code-change:step-updated',
    data: { reportId, step: nextStep },
  })
}

function snapshotPlanRevision(report: ErrorReportEntry): void {
  if (!report.investigation_markdown) return
  getDatabase()
    .prepare(`
      INSERT INTO code_change_plan_revisions (
        id, report_id, revision_number, revision_notes,
        plan_markdown, affected_files, outcome, created_at
      ) SELECT
        lower(hex(randomblob(16))), ?,
        COALESCE((SELECT MAX(revision_number) FROM code_change_plan_revisions WHERE report_id = ?), 0) + 1,
        ?, ?, ?, 'superseded', ?
    `)
    .run(
      report.id,
      report.id,
      report.investigation_revision_notes || '',
      report.investigation_markdown || '',
      report.investigation_affected_files || '[]',
      Date.now(),
    )
}

/**
 * Creates (or reuses the existing) code change report for this conversation and runs the
 * investigation against the given description. Re-running this on a conversation that already
 * has a report is not a distinct "revise" action — it just snapshots the previous plan into
 * revision history and re-investigates with the new text.
 */
export async function submitDescription(
  win: BrowserWindow,
  conversationId: string,
  projectId: string,
  description: string,
  opts: { repoRelativePath?: string; revisionNotes?: string } = {},
): Promise<{ reportId: string }> {
  const workspaceRoot = getProjectRootDirectory(projectId)
  if (!workspaceRoot) {
    throw new Error('This project does not have a configured workspace.')
  }

  const db = getDatabase()
  const existingReport = db
    .prepare('SELECT * FROM error_reports WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(conversationId) as ErrorReportEntry | undefined

  const resolved = await resolveRepoOrThrow(
    workspaceRoot,
    opts.repoRelativePath ?? existingReport?.repo_relative_path,
  )

  let reportId: string
  const trimmedDescription = description.trim()

  if (!existingReport) {
    const result = createErrorReport({
      title: trimmedDescription.slice(0, 80) || 'Code change',
      description: trimmedDescription,
      includeLog: false,
      includeScreenshot: false,
      requestType: 'edit',
      origin: 'chat',
      projectId,
      conversationId,
      workspaceRoot,
    })
    reportId = result.reportId
    db.prepare('UPDATE error_reports SET repo_relative_path = ? WHERE id = ?').run(resolved.relativePath, reportId)
  } else {
    reportId = existingReport.id
    snapshotPlanRevision(existingReport)
    db.prepare(
      'UPDATE error_reports SET title = ?, description = ?, repo_relative_path = ?, updated_at = ? WHERE id = ?',
    ).run(
      trimmedDescription.slice(0, 80) || 'Code change',
      trimmedDescription,
      resolved.relativePath,
      Date.now(),
      reportId,
    )
    advanceStep(reportId, 'describe')
  }

  try {
    const result = await runInvestigation(win, reportId, {
      onChunk: (chunk: string) => {
        broadcastToMobile({ event: 'code-change:investigation-chunk', data: { reportId, chunk } })
      },
      onActivity: (activity) => {
        broadcastToMobile({ event: 'code-change:investigation-activity', data: { reportId, activity } })
      },
    }, opts.revisionNotes)

    if (result.status === 'done') {
      advanceStep(reportId, 'plan-review')
    } else {
      advanceStep(reportId, 'attention')
      broadcastToMobile({
        event: 'code-change:error',
        data: { reportId, error: result.error ?? 'Investigation failed' },
      })
    }
  } catch (error) {
    advanceStep(reportId, 'attention')
    broadcastToMobile({
      event: 'code-change:error',
      data: { reportId, error: error instanceof Error ? error.message : 'Unknown error during investigation' },
    })
    throw error
  }

  return { reportId }
}

/**
 * Runs the current plan: generate the patch, apply it, verify it, and auto-commit.
 * Only precondition: a plan (investigation) must already exist for this report.
 */
export async function acceptPlanAndExecute(
  win: BrowserWindow,
  reportId: string,
): Promise<void> {
  const report = getDatabase()
    .prepare('SELECT * FROM error_reports WHERE id = ?')
    .get(reportId) as ErrorReportEntry | undefined

  if (!report) throw new Error(`Report ${reportId} not found`)
  if (!report.investigation_markdown) throw new Error('No plan yet — run /code-change first.')

  try {
    advanceStep(reportId, 'executing')
    broadcastToMobile({ event: 'code-change:status', data: { reportId, status: 'Generating patch...' } })

    const fixResult = await runFix(win, reportId, {
      onEvent: () => {
        // Events are emitted via broadcastToMobile by fix-agent itself
      },
    })

    if (fixResult.status === 'error') {
      advanceStep(reportId, 'attention')
      broadcastToMobile({
        event: 'code-change:error',
        data: { reportId, error: fixResult.error ?? 'Patch generation failed' },
      })
      return
    }

    advanceStep(reportId, 'verifying')
    broadcastToMobile({ event: 'code-change:status', data: { reportId, status: 'Verifying changes...' } })

    const verifyResult = await runVerification(reportId, () => {
      // Events are emitted via broadcastToMobile by verifier itself
    })

    if (verifyResult.status === 'failed') {
      advanceStep(reportId, 'attention')
      broadcastToMobile({
        event: 'code-change:error',
        data: { reportId, error: verifyResult.error ?? 'Verification failed' },
      })
      return
    }

    advanceStep(reportId, 'final-review')
    broadcastToMobile({ event: 'code-change:status', data: { reportId, status: 'Creating commit...' } })

    const commitMessage = await generateCommitMessage(reportId)
    const commitResult = await commitRemoteEditFix(reportId, commitMessage)
    if (!commitResult.committed) {
      broadcastToMobile({
        event: 'code-change:warning',
        data: { reportId, warning: `Could not auto-commit: ${commitResult.error ?? 'Unknown error'}` },
      })
    }

    broadcastToMobile({
      event: 'code-change:completed',
      data: { reportId, message: 'Code changes completed successfully' },
    })
  } catch (error) {
    advanceStep(reportId, 'attention')
    broadcastToMobile({
      event: 'code-change:error',
      data: { reportId, error: error instanceof Error ? error.message : 'Unknown error during execution' },
    })
    throw error
  }
}

/**
 * Pushes whatever has been committed for this report. No step precondition — git itself is
 * the source of truth (e.g. it errors with "nothing to push" if there's no commit yet), so
 * that real error surfaces to the user instead of an artificial gate short-circuiting it.
 */
export async function pushCurrentCommit(reportId: string): Promise<void> {
  const report = getDatabase()
    .prepare('SELECT * FROM error_reports WHERE id = ?')
    .get(reportId) as ErrorReportEntry | undefined

  if (!report) throw new Error(`Report ${reportId} not found`)

  try {
    const result = await pushRemoteEditFix(reportId)
    if (!result.pushed) {
      broadcastToMobile({ event: 'code-change:error', data: { reportId, error: result.error ?? 'Push failed' } })
      throw new Error(result.error ?? 'Push failed')
    }

    broadcastToMobile({ event: 'code-change:pushed', data: { reportId, message: 'Changes pushed successfully' } })
  } catch (error) {
    broadcastToMobile({
      event: 'code-change:error',
      data: { reportId, error: error instanceof Error ? error.message : 'Unknown error during push' },
    })
    throw error
  }
}

/**
 * Undoes the most recent applied fix for this report by restoring the pre-fix file backups,
 * reusing the existing recovery plumbing (prepare + rollback) as-is.
 */
export async function undoCodeChange(reportId: string): Promise<{ rolledBack: boolean; error?: string }> {
  const prepared = await prepareReload(reportId)
  if (!prepared.canReload || !prepared.recovery) {
    return { rolledBack: false, error: prepared.reason ?? 'Nothing to undo' }
  }
  return rollbackHeal(prepared.recovery.id)
}

/**
 * Generate a commit message using the LLM.
 * Falls back to a simple auto-generated message if LLM call fails.
 */
async function generateCommitMessage(reportId: string): Promise<string> {
  const report = getDatabase()
    .prepare('SELECT title, investigation_markdown FROM error_reports WHERE id = ?')
    .get(reportId) as { title: string; investigation_markdown: string | null } | undefined

  if (!report) throw new Error(`Report ${reportId} not found`)

  const title = report.title || 'Code changes'

  try {
    const markdown = report.investigation_markdown || ''
    const frontMatterMatch = /^---\n([\s\S]*?)\n---\n?/.exec(markdown)
    const frontMatter = frontMatterMatch?.[1] ?? ''

    const affectedFilesMatch = /affected_files:\s*\[(.*?)\]/s.exec(frontMatter)
    const affectedFiles = affectedFilesMatch?.[1] ? affectedFilesMatch[1].split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '')) : []

    let message = `feat: ${title}`
    if (affectedFiles.length > 0 && affectedFiles.length <= 3) {
      message += `\n\nAffected files:\n${affectedFiles.map(f => `- ${f}`).join('\n')}`
    }

    return message
  } catch {
    return `fix: ${title}`
  }
}

/**
 * Look up the code change request attached to a conversation, if any.
 */
export function getReportForConversation(conversationId: string): ErrorReportEntry | null {
  const report = getDatabase()
    .prepare('SELECT * FROM error_reports WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(conversationId) as ErrorReportEntry | undefined
  return report ?? null
}

/**
 * Backs /code-status: the current report plus a fresh check that its resolved repo is still
 * a valid git repo (it may have been deleted/moved since the report was created).
 */
export async function getReportSummary(conversationId: string): Promise<{
  report: ErrorReportEntry | null
  gitRepo: { ok: boolean; relativePath?: string; reason?: string }
}> {
  const report = getReportForConversation(conversationId)
  if (!report || !report.workspace_root) return { report, gitRepo: { ok: false } }

  const resolved = await resolveCodeChangeRepo(report.workspace_root, report.repo_relative_path)
  return {
    report,
    gitRepo: resolved.ok
      ? { ok: true, relativePath: resolved.relativePath }
      : { ok: false, reason: resolved.reason },
  }
}

/**
 * Get revision history for a code change request.
 */
export function getRevisionHistory(reportId: string): Array<{
  revision_number: number
  revision_notes: string | null
  plan_markdown: string
  outcome: string
  created_at: number
}> {
  return getDatabase()
    .prepare(`
      SELECT revision_number, revision_notes, plan_markdown, outcome, created_at
      FROM code_change_plan_revisions
      WHERE report_id = ?
      ORDER BY revision_number DESC
    `)
    .all(reportId) as Array<{
      revision_number: number
      revision_notes: string | null
      plan_markdown: string
      outcome: string
      created_at: number
    }>
}
