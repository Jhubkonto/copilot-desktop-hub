import { execFile } from 'child_process'
import { promisify } from 'util'
import type { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { safeHandle } from '../safe-handle'
import { broadcastToMobile } from '../ws-server'
import { getWorkspacePath, resolveInsideWorkspace } from './investigator'
import { updateHistoryEntry } from './history'
import type {
  ErrorReportEntry,
  RemoteEditGitCommitResult,
  RemoteEditGitEvent,
  RemoteEditGitFile,
  RemoteEditGitFileStatus,
  RemoteEditGitPrepareResult,
  RemoteEditGitPushResult,
  RemoteEditGitStatus,
  RemoteEditStagedFileEntry,
} from '../../shared/types'

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd = getWorkspacePath()): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 15000 })
  return stdout.trim()
}

function classifyStatus(indexStatus: string, worktreeStatus: string): RemoteEditGitFileStatus {
  if (indexStatus === '?' || worktreeStatus === '?') return 'untracked'
  if (indexStatus === 'A' || worktreeStatus === 'A') return 'added'
  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted'
  if (indexStatus === 'R' || worktreeStatus === 'R') return 'renamed'
  if (indexStatus === 'M' || worktreeStatus === 'M') return 'modified'
  return 'unknown'
}

function parseStatusPorcelain(output: string): { branch: string | null; ahead: number; behind: number; files: RemoteEditGitFile[] } {
  const lines = output.split('\n').filter(Boolean)
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const files: RemoteEditGitFile[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const branchPart = line.slice(3)
      branch = branchPart.split('...')[0]?.trim() || null
      const aheadMatch = /ahead (\d+)/.exec(branchPart)
      const behindMatch = /behind (\d+)/.exec(branchPart)
      ahead = aheadMatch ? Number(aheadMatch[1]) : 0
      behind = behindMatch ? Number(behindMatch[1]) : 0
      continue
    }

    const indexStatus = line[0] ?? ' '
    const worktreeStatus = line[1] ?? ' '
    const rawPath = line.slice(3).trim()
    const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath
    files.push({
      path,
      indexStatus,
      worktreeStatus,
      status: classifyStatus(indexStatus, worktreeStatus),
    })
  }

  return { branch, ahead, behind, files }
}

export async function getRemoteEditGitStatus(reportId?: string): Promise<RemoteEditGitStatus> {
  const workspacePath = getWorkspacePath()
  try {
    await git(['rev-parse', '--show-toplevel'], workspacePath)
    const [statusOut, commitSha] = await Promise.all([
      git(['status', '--porcelain=v1', '-b'], workspacePath),
      git(['rev-parse', '--short', 'HEAD'], workspacePath).catch(() => ''),
    ])
    const parsed = parseStatusPorcelain(statusOut)
    return {
      reportId,
      isRepo: true,
      branch: parsed.branch,
      commitSha: commitSha || null,
      dirty: parsed.files.length > 0,
      ahead: parsed.ahead,
      behind: parsed.behind,
      files: parsed.files,
    }
  } catch (error) {
    return {
      reportId,
      isRepo: false,
      branch: null,
      commitSha: null,
      dirty: false,
      ahead: 0,
      behind: 0,
      files: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function readReport(reportId: string): ErrorReportEntry | null {
  return getDatabase()
    .prepare('SELECT * FROM error_reports WHERE id = ?')
    .get(reportId) as ErrorReportEntry | undefined ?? null
}

function getAppliedFiles(report: ErrorReportEntry): string[] {
  const staged = JSON.parse(report.fix_staged_files || '[]') as RemoteEditStagedFileEntry[]
  return staged.map((file) => file.relativePath).filter(Boolean)
}

function validateWorkspaceFiles(files: string[]): void {
  const workspacePath = getWorkspacePath()
  for (const file of files) {
    resolveInsideWorkspace(workspacePath, file)
  }
}

function latestVerificationPassed(reportId: string): boolean {
  const row = getDatabase()
    .prepare('SELECT status FROM remote_edit_verification_runs WHERE report_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(reportId) as { status: string } | undefined
  return row?.status === 'success'
}

export async function prepareRemoteEditCommit(reportId: string): Promise<RemoteEditGitPrepareResult> {
  const report = readReport(reportId)
  const status = await getRemoteEditGitStatus(reportId)
  const files = report ? getAppliedFiles(report) : []
  const suggestedMessage = report ? `fix: remote-edit ${report.title}` : 'fix: remote-edit update'

  let reason: string | undefined
  if (!status.isRepo) reason = status.error ?? 'Workspace is not a git repository'
  else if (!report) reason = 'Report was not found'
  else if (report.fix_status !== 'applied') reason = 'Fix must be applied before committing'
  else if (!latestVerificationPassed(reportId)) reason = 'Verification must pass before committing'
  else if (files.length === 0) reason = 'No applied files are available to commit'

  return {
    reportId,
    status,
    suggestedMessage,
    files,
    canCommit: !reason,
    reason,
  }
}

export async function commitRemoteEditFix(reportId: string, message: string): Promise<RemoteEditGitCommitResult> {
  const prepared = await prepareRemoteEditCommit(reportId)
  if (!prepared.canCommit) {
    return { reportId, committed: false, commitSha: null, status: prepared.status, error: prepared.reason }
  }

  const trimmedMessage = message.trim()
  if (trimmedMessage.length < 5) {
    return { reportId, committed: false, commitSha: null, status: prepared.status, error: 'Commit message is too short' }
  }

  try {
    validateWorkspaceFiles(prepared.files)
    await git(['add', '--', ...prepared.files])
    await git(['commit', '-m', trimmedMessage])
    const commitSha = await git(['rev-parse', '--short', 'HEAD']).catch(() => null)
    const status = await getRemoteEditGitStatus(reportId)
    return { reportId, committed: true, commitSha, status }
  } catch (error) {
    return {
      reportId,
      committed: false,
      commitSha: null,
      status: await getRemoteEditGitStatus(reportId),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function pushRemoteEditFix(reportId: string): Promise<RemoteEditGitPushResult> {
  try {
    await git(['push'])
    return { reportId, pushed: true, status: await getRemoteEditGitStatus(reportId) }
  } catch (error) {
    return {
      reportId,
      pushed: false,
      status: await getRemoteEditGitStatus(reportId),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function emitGitEvent(win: BrowserWindow | undefined, event: RemoteEditGitEvent): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('remote-edit:git-event', event)
  }
  broadcastToMobile({ event: 'remote-edit:git-event', data: event })
}

export function registerRemoteEditGitHandlers(mainWindow?: BrowserWindow): void {
  safeHandle('remote-edit:git-status', (_event, reportId?: string) => getRemoteEditGitStatus(reportId))

  safeHandle('remote-edit:git-prepare-commit', async (_event, reportId: string) => {
    const result = await prepareRemoteEditCommit(reportId)
    emitGitEvent(mainWindow, {
      reportId,
      type: 'prepare',
      label: result.canCommit ? 'Ready to commit remote-edit fix' : result.reason ?? 'Unable to prepare commit',
      status: result.status,
      error: result.reason,
    })
    return result
  })

  safeHandle('remote-edit:git-commit', async (_event, reportId: string, message: string) => {
    emitGitEvent(mainWindow, { reportId, type: 'commit', label: 'Committing remote-edit fix' })
    const result = await commitRemoteEditFix(reportId, message)
    emitGitEvent(mainWindow, {
      reportId,
      type: 'commit',
      label: result.committed ? `Committed ${result.commitSha ?? ''}`.trim() : result.error ?? 'Commit failed',
      status: result.status,
      commitSha: result.commitSha,
      error: result.error,
    })
    if (result.committed) {
      updateHistoryEntry(reportId, { committed: true, commitSha: result.commitSha ?? null, status: 'committed' })
    }
    return result
  })

  safeHandle('remote-edit:git-push', async (_event, reportId: string) => {
    emitGitEvent(mainWindow, { reportId, type: 'push', label: 'Pushing remote-edit fix' })
    const result = await pushRemoteEditFix(reportId)
    emitGitEvent(mainWindow, {
      reportId,
      type: 'push',
      label: result.pushed ? 'Push complete' : result.error ?? 'Push failed',
      status: result.status,
      error: result.error,
    })
    if (result.pushed) {
      updateHistoryEntry(reportId, { pushed: true, status: 'pushed' })
    }
    return result
  })
}
