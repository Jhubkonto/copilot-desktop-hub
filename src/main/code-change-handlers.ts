/**
 * IPC handlers for the Code Changes (6-step wizard) feature.
 * These handlers use the orchestration layer (step-flow.ts) to manage composite actions.
 */

import type { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import {
  submitDescription,
  acceptPlanAndExecute,
  revisePlan,
  pushCurrentCommit,
  getRevisionHistory,
  advanceStep,
} from './code-change/step-flow'
import { getDatabase } from './database'
import type { ErrorReportEntry } from '../shared/types'

export function registerCodeChangeHandlers(mainWindow?: BrowserWindow): void {
  if (!mainWindow) return

  /**
   * Step 2→3: Submit the natural-language description.
   * Invokes the planner, lands on `plan-review` on success or `attention` on failure.
   */
  safeHandle('code-change:submit-description', async (_event, reportId: string) => {
    await submitDescription(mainWindow, reportId)
  })

  /**
   * Step 3→4→5→6: Accept plan and execute the full change.
   * Composite action chains: accept → generate patch → apply → verify → auto-commit.
   * On failure, returns to `attention` state.
   */
  safeHandle('code-change:accept-plan', async (_event, reportId: string) => {
    await acceptPlanAndExecute(mainWindow, reportId)
  })

  /**
   * Step 3 (loop-back): Revise the plan with additional notes.
   * Snapshots current plan to revision history, re-invokes planner.
   */
  safeHandle('code-change:revise-plan', async (_event, reportId: string, revisionNotes: string) => {
    await revisePlan(mainWindow, reportId, revisionNotes)
  })

  /**
   * Retrieve revision history for a code change (loop-backs from step 3).
   */
  safeHandle('code-change:get-plan-revisions', (_event, reportId: string) => {
    return getRevisionHistory(reportId)
  })

  /**
   * Step 1: List all repositories in a workspace.
   * Enables multi-repo selection for workspaces with multiple repos under the root.
   */
  safeHandle('code-change:list-repos', async (_event, workspaceRoot: string) => {
    try {
      const { discoverReposInWorkspace } = await import('./code-change/repo-discovery')
      const repos = await discoverReposInWorkspace(workspaceRoot)
      return repos.map(r => ({ relativePath: r.relativePath, branch: r.branch }))
    } catch (error) {
      console.error('Failed to discover repos:', error)
      return []
    }
  })

  /**
   * Step 1: List files in a repository.
   * Enables file-tree browsing for the selected repo before describing the change.
   */
  safeHandle('code-change:list-repo-files', async (_event, repoRoot: string) => {
    try {
      const { listRepoFiles } = await import('./code-change/repo-discovery')
      return await listRepoFiles(repoRoot)
    } catch (error) {
      console.error('Failed to list repo files:', error)
      return []
    }
  })

  /**
   * Step 6: Push the committed changes to remote.
   * Manual action available only in final-review.
   */
  safeHandle('code-change:git-push', async (_event, reportId: string) => {
    await pushCurrentCommit(reportId)
  })

  /**
   * Get the current step and details for a code change request.
   * Useful for syncing UI state when a conversation is reopened.
   */
  safeHandle('code-change:get-report', (_event, reportId: string) => {
    const report = getDatabase()
      .prepare('SELECT * FROM error_reports WHERE id = ?')
      .get(reportId) as ErrorReportEntry | undefined
    return report || null
  })
}
