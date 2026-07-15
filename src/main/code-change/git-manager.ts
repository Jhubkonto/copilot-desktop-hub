/**
 * Git branch/merge housekeeping for Code Changes: list/checkout/create branches, fetch,
 * and merge (with conflict detection). Backs both desktop's git-housekeeping slash commands
 * and Android's `/code` repo panel — same raw `execFile('git', [...])` style as
 * `repo-discovery.ts`, no new dependency.
 */

import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 15000 })
  return stdout.trim()
}

function extractGitError(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const stderr = String((error as { stderr?: unknown }).stderr || '').trim()
    if (stderr) return stderr
  }
  return error instanceof Error ? error.message : 'Unknown git error'
}

export interface BranchList {
  current: string
  local: string[]
  remote: string[]
}

export async function listBranches(repoRoot: string): Promise<BranchList> {
  const current = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).catch(() => '(detached)')
  const localRaw = await git(['branch', '--list'], repoRoot).catch(() => '')
  const remoteRaw = await git(['branch', '-r'], repoRoot).catch(() => '')
  const parse = (raw: string) =>
    raw
      .split('\n')
      .map((line) => line.replace(/^\*?\s*/, '').trim())
      .filter((line) => line.length > 0 && !line.includes('->'))
      // Claude Code's EnterWorktree tool checks out a real branch named "worktree-<slug>" for
      // each agent worktree it creates under .claude/worktrees/ — internal session scratch
      // branches, not something a user managing their project's own branches would ever want to
      // see/checkout/merge here (same reasoning as excluding .claude/ from repo discovery).
      .filter((branch) => !branch.startsWith('worktree-'))
  return { current, local: parse(localRaw), remote: parse(remoteRaw) }
}

export async function checkoutBranch(repoRoot: string, branchName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await git(['checkout', branchName], repoRoot)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

export async function createBranch(
  repoRoot: string,
  branchName: string,
  fromRef?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const args = fromRef ? ['checkout', '-b', branchName, fromRef] : ['checkout', '-b', branchName]
    await git(args, repoRoot)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

export async function fetchRepo(repoRoot: string, remote = 'origin'): Promise<{ ok: boolean; error?: string }> {
  try {
    await git(['fetch', remote], repoRoot)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

export interface ConflictedFile {
  relativePath: string
  content: string
}

export interface MergeResult {
  ok: boolean
  conflicted: boolean
  conflictedFiles?: ConflictedFile[]
  error?: string
  summary?: string
}

/**
 * Merges `sourceBranch` into the current branch. On conflict, the merge is deliberately left
 * mid-merge (not aborted) and the conflicted files (with markers) are returned so the caller
 * can route them through the AI-resolution flow (same investigation/fix pipeline as a normal
 * code-change plan) rather than dumping raw markers on the user.
 */
export async function mergeBranch(repoRoot: string, sourceBranch: string): Promise<MergeResult> {
  try {
    const summary = await git(['merge', sourceBranch], repoRoot)
    return { ok: true, conflicted: false, summary }
  } catch (error) {
    const statusOutput = await git(['status', '--porcelain'], repoRoot).catch(() => '')
    const conflictedPaths = statusOutput
      .split('\n')
      .filter((line) => /^(UU|AA|DD|AU|UA|UD|DU)\s/.test(line))
      .map((line) => line.slice(3).trim())

    if (conflictedPaths.length > 0) {
      const conflictedFiles: ConflictedFile[] = []
      for (const relativePath of conflictedPaths) {
        try {
          const content = await fs.readFile(path.join(repoRoot, relativePath), 'utf-8')
          conflictedFiles.push({ relativePath, content })
        } catch {
          // Binary/deleted/unreadable — still reported as conflicted, just without inline content
        }
      }
      return { ok: false, conflicted: true, conflictedFiles, error: 'Merge produced conflicts' }
    }

    return { ok: false, conflicted: false, error: extractGitError(error) }
  }
}

/**
 * Files with uncommitted changes (staged or not) in the repo — the "changed files" view,
 * distinct from `repo-discovery.ts`'s `listRepoFiles` which returns every tracked file.
 */
export async function getChangedFiles(repoRoot: string): Promise<string[]> {
  const output = await git(['status', '--porcelain'], repoRoot).catch(() => '')
  return output
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0)
}
