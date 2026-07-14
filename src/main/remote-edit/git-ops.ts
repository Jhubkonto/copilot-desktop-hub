import { execFile } from 'child_process'
import { promisify } from 'util'
import type { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import { safeHandle } from '../safe-handle'
import { broadcastToMobile } from '../ws-server'
import { getWorkspacePathForReport, resolveInsideWorkspace } from './investigator'
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

type GitFailureInfo = {
  message: string
  authRequired: boolean
  authHelp?: string
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 15000 })
  return stdout.trim()
}

export function classifyGitFailure(error: unknown): GitFailureInfo {
  const stderr = typeof error === 'object' && error !== null && 'stderr' in error && typeof (error as { stderr?: unknown }).stderr === 'string'
    ? (error as { stderr: string }).stderr
    : ''
  const stdout = typeof error === 'object' && error !== null && 'stdout' in error && typeof (error as { stdout?: unknown }).stdout === 'string'
    ? (error as { stdout: string }).stdout
    : ''
  const message = error instanceof Error ? error.message : String(error)
  const combined = `${message}\n${stderr}\n${stdout}`.toLowerCase()
  const authRequired =
    combined.includes('authentication failed') ||
    combined.includes('could not read username') ||
    combined.includes('permission denied (publickey)') ||
    combined.includes('repository not found') ||
    combined.includes('fatal: could not read from remote repository') ||
    combined.includes('fatal: authentication') ||
    combined.includes('access denied')
  const noUpstream =
    combined.includes('has no upstream branch') ||
    combined.includes('no configured push destination')
  const nonFastForward =
    combined.includes('non-fast-forward') ||
    combined.includes('fetch first')

  return {
    message: stderr.trim() || message,
    authRequired,
    authHelp: authRequired
      ? 'Authentication failed. Sign in with your system credential manager or the provider CLI used by this remote, confirm you have repository access, then retry.'
      : noUpstream
        ? 'This branch has no upstream. Run `git push --set-upstream <remote> <branch>` once in the connected workspace, then retry.'
        : nonFastForward
          ? 'The remote contains newer commits. Fetch and integrate them in the connected workspace, rerun verification, then push again.'
          : undefined,
  }
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
      const parsedBranch = branchPart.split('...')[0]?.trim() || null
      branch = parsedBranch === 'HEAD (no branch)' ? null : parsedBranch
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
  if (!reportId) {
    return {
      reportId,
      isRepo: false,
      branch: null,
      commitSha: null,
      dirty: false,
      ahead: 0,
      behind: 0,
      files: [],
      error: 'No report specified',
    }
  }
  const workspacePath = getWorkspacePathForReport(reportId)
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

function validateWorkspaceFiles(reportId: string, files: string[]): void {
  const workspacePath = getWorkspacePathForReport(reportId)
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
  const suggestedMessage = report ? `fix: ${report.title}` : 'fix: apply code change'

  let reason: string | undefined
  if (!status.isRepo) reason = status.error ?? 'Workspace is not a git repository'
  else if (!status.branch) reason = 'The repository is in detached HEAD state. Check out or create a branch before committing.'
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
    const workspacePath = getWorkspacePathForReport(reportId)
    validateWorkspaceFiles(reportId, prepared.files)
    await git(['add', '--', ...prepared.files], workspacePath)
    await git(['commit', '-m', trimmedMessage], workspacePath)
    const commitSha = await git(['rev-parse', '--short', 'HEAD'], workspacePath).catch(() => null)
    const status = await getRemoteEditGitStatus(reportId)
    return { reportId, committed: true, commitSha, status }
  } catch (error) {
    const failure = classifyGitFailure(error)
    return {
      reportId,
      committed: false,
      commitSha: null,
      status: await getRemoteEditGitStatus(reportId),
      error: failure.message,
      authRequired: failure.authRequired,
      authHelp: failure.authHelp,
    }
  }
}

export async function pushRemoteEditFix(reportId: string): Promise<RemoteEditGitPushResult> {
  try {
    await git(['push'], getWorkspacePathForReport(reportId))
    return { reportId, pushed: true, status: await getRemoteEditGitStatus(reportId) }
  } catch (error) {
    const failure = classifyGitFailure(error)
    return {
      reportId,
      pushed: false,
      status: await getRemoteEditGitStatus(reportId),
      error: failure.message,
      authRequired: failure.authRequired,
      authHelp: failure.authHelp,
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

  safeHandle('remote-edit:git-push', async (_event, reportId: string) => {
    emitGitEvent(mainWindow, { reportId, type: 'push', label: 'Pushing code changes' })
    const result = await pushRemoteEditFix(reportId)
    emitGitEvent(mainWindow, {
      reportId,
      type: 'push',
      label: result.pushed ? 'Push complete' : result.error ?? 'Push failed',
      status: result.status,
      error: result.error,
      authRequired: result.authRequired,
      authHelp: result.authHelp,
    })
    if (result.pushed) {
      updateHistoryEntry(reportId, { pushed: true, status: 'pushed' })
    }
    return result
  })
}
