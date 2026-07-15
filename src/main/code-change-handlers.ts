/**
 * IPC handlers for the Code Changes feature: independent AI-workflow actions
 * (describe/execute/push/undo/status) plus git housekeeping (branch/checkout/fetch/merge),
 * each invoked directly by a slash command rather than gated behind a wizard step.
 */

import type { BrowserWindow } from 'electron'
import { safeHandle } from './safe-handle'
import {
  submitDescription,
  acceptPlanAndExecute,
  pushCurrentCommit,
  undoCodeChange,
  getRevisionHistory,
  getReportForConversation,
  getReportSummary,
  resolveCodeChangeRepo,
} from './code-change/step-flow'
import { getProjectRootDirectory } from './project-handlers'
import {
  listBranches,
  checkoutBranch,
  createBranch,
  fetchRepo,
  mergeBranch,
  getChangedFiles,
  initRepo,
  detectGitCredentials,
  pullRepo,
  pushRepo,
  commitChanges,
  discardFileChanges,
  stashChanges,
  stashPop,
  getStashCount,
  deleteBranch,
  getFileDiff,
} from './code-change/git-manager'
import path from 'path'
import { discoverReposInWorkspace, listRepoFiles } from './code-change/repo-discovery'
import { getDatabase } from './database'
import type { ErrorReportEntry } from '../shared/types'

export function registerCodeChangeHandlers(mainWindow?: BrowserWindow): void {
  if (!mainWindow) return

  /** Creates or reuses the current conversation's report and (re-)runs the investigation. */
  safeHandle(
    'code-change:submit-description',
    async (_event, conversationId: string, projectId: string, description: string, repoRelativePath?: string) => {
      return submitDescription(mainWindow, conversationId, projectId, description, { repoRelativePath })
    },
  )

  /** Runs the current plan: generate patch → apply → verify → auto-commit. */
  safeHandle('code-change:accept-plan', async (_event, reportId: string) => {
    await acceptPlanAndExecute(mainWindow, reportId)
  })

  /** Retrieve plan revision history (each re-describe snapshots the prior plan). */
  safeHandle('code-change:get-plan-revisions', (_event, reportId: string) => {
    return getRevisionHistory(reportId)
  })

  /** List all git repos discovered under a workspace root. */
  safeHandle('code-change:list-repos', async (_event, workspaceRoot: string) => {
    try {
      const repos = await discoverReposInWorkspace(workspaceRoot)
      return repos.map((r) => ({ relativePath: r.relativePath, branch: r.branch, dirty: r.dirty }))
    } catch (error) {
      console.error('Failed to discover repos:', error)
      return []
    }
  })

  /** List every tracked file in a repo. */
  safeHandle('code-change:list-repo-files', async (_event, repoRoot: string) => {
    try {
      return await listRepoFiles(repoRoot)
    } catch (error) {
      console.error('Failed to list repo files:', error)
      return []
    }
  })

  /** List files with uncommitted changes in a repo. */
  safeHandle('code-change:list-changed-files', async (_event, repoRoot: string) => {
    try {
      return await getChangedFiles(repoRoot)
    } catch (error) {
      console.error('Failed to list changed files:', error)
      return []
    }
  })

  /** Push whatever has been committed for this report. */
  safeHandle('code-change:git-push', async (_event, reportId: string) => {
    await pushCurrentCommit(reportId)
  })

  /** Undo the most recent applied fix by restoring pre-fix file backups. */
  safeHandle('code-change:undo', async (_event, reportId: string) => {
    return undoCodeChange(reportId)
  })

  /** Get the current report for a conversation, if any (backs /code-plan). */
  safeHandle('code-change:get-report-for-conversation', (_event, conversationId: string) => {
    return getReportForConversation(conversationId)
  })

  /** Get a status summary (report + git-repo health) for a conversation (backs /code-status). */
  safeHandle('code-change:get-status', async (_event, conversationId: string) => {
    return getReportSummary(conversationId)
  })

  /** Get a report by id directly. */
  safeHandle('code-change:get-report', (_event, reportId: string) => {
    const report = getDatabase()
      .prepare('SELECT * FROM error_reports WHERE id = ?')
      .get(reportId) as ErrorReportEntry | undefined
    return report || null
  })

  /**
   * Resolves which repo under a project's workspace a slash command should target, given an
   * optional repo path argument. Lets the renderer avoid ever needing to know the raw
   * workspace root — it only ever deals in projectId + an optional repo argument.
   */
  safeHandle('code-change:resolve-repo', async (_event, projectId: string, repoRelativePath?: string) => {
    const workspaceRoot = getProjectRootDirectory(projectId)
    if (!workspaceRoot) return { ok: false as const, reason: 'no-repo' as const }
    return resolveCodeChangeRepo(workspaceRoot, repoRelativePath)
  })

  // --- Git housekeeping ---

  safeHandle('code-change:list-branches', async (_event, repoRoot: string) => {
    return listBranches(repoRoot)
  })

  safeHandle('code-change:checkout-branch', async (_event, repoRoot: string, branchName: string) => {
    return checkoutBranch(repoRoot, branchName)
  })

  safeHandle('code-change:new-branch', async (_event, repoRoot: string, branchName: string, fromRef?: string) => {
    return createBranch(repoRoot, branchName, fromRef)
  })

  safeHandle('code-change:fetch', async (_event, repoRoot: string, remote?: string) => {
    return fetchRepo(repoRoot, remote)
  })

  safeHandle('code-change:merge-branch', async (_event, repoRoot: string, sourceBranch: string) => {
    return mergeBranch(repoRoot, sourceBranch)
  })

  /** `git init` a workspace (or subfolder) that has no repo yet. Takes a projectId, not a raw
   *  path, mirroring `code-change:resolve-repo` — the renderer never needs to know the
   *  workspace root directly. */
  safeHandle('code-change:init-repo', async (_event, projectId: string, relativePath?: string) => {
    const workspaceRoot = getProjectRootDirectory(projectId)
    if (!workspaceRoot) return { ok: false as const, error: 'This project has no workspace folder configured.' }
    const targetDir = relativePath ? path.join(workspaceRoot, relativePath) : workspaceRoot
    return initRepo(targetDir)
  })

  /** Detect (never store) which already-configured auth this machine would use to push/fetch. */
  safeHandle('code-change:detect-credentials', async (_event, repoRoot: string) => {
    return detectGitCredentials(repoRoot)
  })

  safeHandle('code-change:pull', async (_event, repoRoot: string, remote?: string) => {
    return pullRepo(repoRoot, remote)
  })

  safeHandle('code-change:push-branch', async (_event, repoRoot: string) => {
    return pushRepo(repoRoot)
  })

  safeHandle('code-change:commit', async (_event, repoRoot: string, message: string, files?: string[]) => {
    return commitChanges(repoRoot, message, files)
  })

  safeHandle('code-change:discard-file', async (_event, repoRoot: string, relativePath: string) => {
    return discardFileChanges(repoRoot, relativePath)
  })

  safeHandle('code-change:stash', async (_event, repoRoot: string, message?: string) => {
    return stashChanges(repoRoot, message)
  })

  safeHandle('code-change:stash-pop', async (_event, repoRoot: string) => {
    return stashPop(repoRoot)
  })

  safeHandle('code-change:stash-count', async (_event, repoRoot: string) => {
    return getStashCount(repoRoot)
  })

  safeHandle(
    'code-change:delete-branch',
    async (_event, repoRoot: string, branchName: string, options?: { deleteRemote?: boolean; force?: boolean }) => {
      return deleteBranch(repoRoot, branchName, options)
    },
  )

  safeHandle('code-change:file-diff', async (_event, repoRoot: string, relativePath: string) => {
    return getFileDiff(repoRoot, relativePath)
  })
}
