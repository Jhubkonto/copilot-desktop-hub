/**
 * Code Changes orchestration layer: composite actions that advance through the 6-step wizard.
 * Each action owns a multi-step sequence and updates the `step` column atomically.
 */

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
import { broadcastToMobile } from '../ws-server'
import { createConversationRecord } from '../conversation-handlers'
import { createErrorReport } from '../error-report-handlers'
import type { ErrorReportEntry } from '../../shared/types'

/**
 * Creates a dedicated project-scoped conversation for a new Code Changes request
 * (the "chat-hijack" entry point) plus its backing `error_reports` row, targeting
 * one repo under the project's workspace.
 */
export function startCodeChangeConversation(
  projectId: string,
  workspaceRoot: string,
  repoRelativePath: string,
): { conversationId: string; reportId: string } {
  const conversation = createConversationRecord(null, projectId, 'Code Change')
  getDatabase()
    .prepare("UPDATE conversations SET kind = 'code-change' WHERE id = ?")
    .run(conversation.id)

  const result = createErrorReport({
    title: 'Code Change',
    description: 'Pending description',
    includeLog: false,
    includeScreenshot: false,
    requestType: 'edit',
    origin: 'chat',
    projectId,
    conversationId: conversation.id,
    workspaceRoot,
  })

  getDatabase()
    .prepare('UPDATE error_reports SET repo_relative_path = ? WHERE id = ?')
    .run(repoRelativePath, result.reportId)

  return { conversationId: conversation.id, reportId: result.reportId }
}

/**
 * Updates the step column for a code change request.
 * Single point of truth for step transitions.
 */
export function advanceStep(reportId: string, nextStep: 'describe' | 'plan-review' | 'executing' | 'verifying' | 'final-review' | 'attention'): void {
  const now = Date.now()
  getDatabase()
    .prepare('UPDATE error_reports SET step = ?, updated_at = ? WHERE id = ?')
    .run(nextStep, now, reportId)

  // Broadcast step change to mobile clients
  broadcastToMobile({
    event: 'code-change:step-updated',
    data: { reportId, step: nextStep },
  })
}

/**
 * Step 2→3: User submits a natural-language description.
 * Invokes the planner (investigator), lands on `plan-review`.
 */
export async function submitDescription(
  win: BrowserWindow,
  reportId: string,
  description?: string,
  revisionNotes?: string,
): Promise<void> {
  const report = getDatabase()
    .prepare('SELECT * FROM error_reports WHERE id = ?')
    .get(reportId) as ErrorReportEntry | undefined

  if (!report) throw new Error(`Report ${reportId} not found`)
  if (report.step !== 'describe') throw new Error(`Cannot submit description from step ${report.step}`)

  if (description?.trim()) {
    getDatabase()
      .prepare('UPDATE error_reports SET title = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(description.trim().slice(0, 80) || 'Code change', description.trim(), Date.now(), reportId)
  }

  try {
    const result = await runInvestigation(win, reportId, {
      onChunk: (chunk: string) => {
        // Stream investigation progress to clients
        broadcastToMobile({
          event: 'code-change:investigation-chunk',
          data: { reportId, chunk },
        })
      },
      onActivity: (activity) => {
        broadcastToMobile({
          event: 'code-change:investigation-activity',
          data: { reportId, activity },
        })
      },
    }, revisionNotes)

    if (result.status === 'done') {
      // Investigation succeeded; move to plan-review for user confirmation
      advanceStep(reportId, 'plan-review')
    } else {
      // Investigation failed; move to attention state for user to revise
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
}

/**
 * Step 3→4→5→6: User accepts the plan. Composite action chains:
 *   accept plan → generate patch (execute) → apply patch → verify.
 * On success: advances through executing → verifying → final-review, auto-commits.
 * On failure: returns to attention state with error, user can revise from step 3.
 */
export async function acceptPlanAndExecute(
  win: BrowserWindow,
  reportId: string,
): Promise<void> {
  const report = getDatabase()
    .prepare('SELECT * FROM error_reports WHERE id = ?')
    .get(reportId) as ErrorReportEntry | undefined

  if (!report) throw new Error(`Report ${reportId} not found`)
  if (report.step !== 'plan-review') throw new Error(`Cannot accept plan from step ${report.step}`)

  try {
    // Step 3→4: Start execution
    advanceStep(reportId, 'executing')
    broadcastToMobile({
      event: 'code-change:status',
      data: { reportId, status: 'Generating patch...' },
    })

    // Run patch generation (fix-agent)
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

    // Step 4→5: Move to verification
    advanceStep(reportId, 'verifying')
    broadcastToMobile({
      event: 'code-change:status',
      data: { reportId, status: 'Verifying changes...' },
    })

    // Run verification
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

    // Step 5→6: Auto-commit and move to final-review
    advanceStep(reportId, 'final-review')
    broadcastToMobile({
      event: 'code-change:status',
      data: { reportId, status: 'Creating commit...' },
    })

    // Generate commit message via LLM
    const commitMessage = await generateCommitMessage(reportId)

    // Auto-commit
    const commitResult = await commitRemoteEditFix(reportId, commitMessage)
    if (!commitResult.committed) {
      // Commit failed but we still move to final-review (user can review and manually commit)
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
 * Step 3 (loop-back): User revises the plan with additional notes.
 * Snapshots current plan to `code_change_plan_revisions`, re-invokes planner, returns to plan-review.
 */
export async function revisePlan(
  win: BrowserWindow,
  reportId: string,
  revisionNotes: string,
): Promise<void> {
  const report = getDatabase()
    .prepare('SELECT * FROM error_reports WHERE id = ?')
    .get(reportId) as ErrorReportEntry | undefined

  if (!report) throw new Error(`Report ${reportId} not found`)
  if (report.step !== 'plan-review' && report.step !== 'attention') {
    throw new Error(`Cannot revise plan from step ${report.step}`)
  }

  const db = getDatabase()

  try {
    // Snapshot the current plan to revision history
    if (report.investigation_markdown) {
      const revisionStmt = db.prepare(`
        INSERT INTO code_change_plan_revisions (
          id, report_id, revision_number, revision_notes,
          plan_markdown, affected_files, outcome, created_at
        ) SELECT
          lower(hex(randomblob(16))), ?,
          COALESCE((SELECT MAX(revision_number) FROM code_change_plan_revisions WHERE report_id = ?), 0) + 1,
          ?,
          ?, ?,
          CASE WHEN ? = 'attention' THEN 'execution-failed' ELSE 'superseded' END,
          ?
        WHERE 1=1
      `)
      revisionStmt.run(
        reportId,
        reportId,
        report.investigation_revision_notes || '',
        report.investigation_markdown || '',
        report.investigation_affected_files || '[]',
        report.step,
        Date.now(),
      )
    }

    // Return to describe step to re-run planning
    advanceStep(reportId, 'describe')

    // Re-run investigation with revision notes (description text is unchanged on a revise)
    await submitDescription(win, reportId, undefined, revisionNotes)
  } catch (error) {
    advanceStep(reportId, 'attention')
    broadcastToMobile({
      event: 'code-change:error',
      data: { reportId, error: error instanceof Error ? error.message : 'Unknown error during revision' },
    })
    throw error
  }
}

/**
 * Step 6: Push the committed changes to the remote.
 * Manual action, available only in final-review.
 */
export async function pushCurrentCommit(reportId: string): Promise<void> {
  const report = getDatabase()
    .prepare('SELECT * FROM error_reports WHERE id = ?')
    .get(reportId) as ErrorReportEntry | undefined

  if (!report) throw new Error(`Report ${reportId} not found`)
  if (report.step !== 'final-review') throw new Error(`Cannot push from step ${report.step}`)

  try {
    const result = await pushRemoteEditFix(reportId)
    if (!result.pushed) {
      broadcastToMobile({
        event: 'code-change:error',
        data: { reportId, error: result.error ?? 'Push failed' },
      })
      throw new Error(result.error ?? 'Push failed')
    }

    broadcastToMobile({
      event: 'code-change:pushed',
      data: { reportId, message: 'Changes pushed successfully' },
    })
  } catch (error) {
    broadcastToMobile({
      event: 'code-change:error',
      data: { reportId, error: error instanceof Error ? error.message : 'Unknown error during push' },
    })
    throw error
  }
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
    // Try to generate a meaningful message using the investigation markdown
    const markdown = report.investigation_markdown || ''
    const frontMatterMatch = /^---\n([\s\S]*?)\n---\n?/.exec(markdown)
    const frontMatter = frontMatterMatch?.[1] ?? ''

    // Extract affected files to provide context
    const affectedFilesMatch = /affected_files:\s*\[(.*?)\]/s.exec(frontMatter)
    const affectedFiles = affectedFilesMatch?.[1] ? affectedFilesMatch[1].split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '')) : []

    // Generate a brief, conventional commit message
    let message = `feat: ${title}`
    if (affectedFiles.length > 0 && affectedFiles.length <= 3) {
      message += `\n\nAffected files:\n${affectedFiles.map(f => `- ${f}`).join('\n')}`
    }

    return message
  } catch {
    // Fallback to simple message
    return `fix: ${title}`
  }
}

/**
 * Look up the code change request backing a given (dedicated) conversation.
 * Used by clients that only know the conversation id (e.g. when re-opening
 * a code-change conversation) and need to resolve its reportId/step.
 */
export function getReportForConversation(conversationId: string): ErrorReportEntry | null {
  const report = getDatabase()
    .prepare('SELECT * FROM error_reports WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(conversationId) as ErrorReportEntry | undefined
  return report ?? null
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
