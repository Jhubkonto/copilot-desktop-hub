/**
 * Git branch/merge housekeeping for Code Changes: list/checkout/create branches, fetch,
 * and merge (with conflict detection). Backs both desktop's git-housekeeping slash commands
 * and Android's `/code` repo panel — same raw `execFile('git', [...])` style as
 * `repo-discovery.ts`, no new dependency.
 */

import { execFile, spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 15000 })
  return stdout.trim()
}

/** Runs a command feeding `stdin` and collecting stdout — for `git credential fill`, which
 *  reads its protocol/host query from stdin rather than argv. */
function execWithStdin(bin: string, args: string[], cwd: string, stdinInput: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd })
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('timed out'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${bin} exited with code ${code}`))
    })
    child.stdin.write(stdinInput)
    child.stdin.end()
  })
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

/** Shared by `mergeBranch` and `pullRepo` — both leave the working tree mid-merge on conflict
 *  (never auto-abort) and report conflicted files with markers for the AI-resolution flow. */
async function runMergeLikeCommand(repoRoot: string, args: string[]): Promise<MergeResult> {
  try {
    const summary = await git(args, repoRoot)
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
 * Merges `sourceBranch` into the current branch. On conflict, the merge is deliberately left
 * mid-merge (not aborted) and the conflicted files (with markers) are returned so the caller
 * can route them through the AI-resolution flow (same investigation/fix pipeline as a normal
 * code-change plan) rather than dumping raw markers on the user.
 */
export async function mergeBranch(repoRoot: string, sourceBranch: string): Promise<MergeResult> {
  return runMergeLikeCommand(repoRoot, ['merge', sourceBranch])
}

/** `git pull` (fetch + merge) against the current branch's upstream — same conflict handling as
 *  `mergeBranch`, since a pull is just a fetch followed by a merge. */
export async function pullRepo(repoRoot: string, remote = 'origin'): Promise<MergeResult> {
  return runMergeLikeCommand(repoRoot, ['pull', remote])
}

export interface ChangedFileEntry {
  relativePath: string
  /** True when the index (X column of `git status --porcelain`) already has this file's changes
   *  staged — i.e. `git commit` alone (no `git add`) would include it. */
  staged: boolean
}

/**
 * Files with uncommitted changes (staged or not) in the repo — the "changed files" view,
 * distinct from `repo-discovery.ts`'s `listRepoFiles` which returns every tracked file.
 */
export async function getChangedFiles(repoRoot: string): Promise<ChangedFileEntry[]> {
  // Deliberately not using the shared `git()` helper here — its whole-string `.trim()` eats the
  // leading status-column space of the *first* line only (e.g. " M foo.kt\n M bar.kt".trim() ==
  // "M foo.kt\n M bar.kt"), which shifted that one line's status/path parsing below by a
  // character and made the first changed file wrongly look staged with a mangled, non-existent
  // path (so its diff came back empty). Every other line is unaffected since trim only strips
  // the very start/end of the whole string — this is why only the first entry was ever wrong.
  const output = await execFileAsync('git', ['status', '--porcelain'], { cwd: repoRoot, timeout: 15000 })
    .then((r) => r.stdout)
    .catch(() => '')
  return output
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      // Porcelain v1: columns 0-1 are XY status, column 2 is a space, path starts at column 3.
      // A rename/copy line reads "R  old/path -> new/path" — only the new path is a real,
      // diff/add-able location, so that's what's surfaced here.
      const statusX = line[0]
      const rawPath = line.slice(3).trim()
      const relativePath = rawPath.includes(' -> ') ? rawPath.split(' -> ')[1] : rawPath
      return { relativePath, staged: statusX !== ' ' && statusX !== '?' }
    })
}

/** Stages the given files (`git add`) without committing — the explicit "Stage" action,
 *  distinct from `commitChanges`, which only auto-stages everything as a convenience fallback
 *  when nothing has been staged yet. */
export async function stageFiles(repoRoot: string, relativePaths: string[]): Promise<{ ok: boolean; error?: string }> {
  if (relativePaths.length === 0) return { ok: true }
  try {
    await git(['add', '--', ...relativePaths], repoRoot)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

/** Reverses `stageFiles` — moves the given files back out of the index without discarding their
 *  working-tree edits (`git reset` for compatibility with older git than `restore --staged`). */
export async function unstageFiles(repoRoot: string, relativePaths: string[]): Promise<{ ok: boolean; error?: string }> {
  if (relativePaths.length === 0) return { ok: true }
  try {
    await git(['reset', '--', ...relativePaths], repoRoot)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

/**
 * `git init` a folder that isn't a repo yet, closing the dead end `resolveCodeChangeRepo` hits
 * when a workspace has no repo anywhere under it. Creates the target directory if it doesn't
 * already exist (a brand-new workspace folder may be genuinely empty).
 */
export async function initRepo(targetDir: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await fs.mkdir(targetDir, { recursive: true })
    await git(['init'], targetDir)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

export interface GitAuthMethod {
  type: 'gh-cli' | 'glab-cli' | 'tea-cli' | 'ssh-key' | 'credential-helper'
  label: string
  detail: string
  available: boolean
}

export interface GitAuthInfo {
  remoteUrl: string | null
  host: string | null
  protocol: 'ssh' | 'https' | null
  methods: GitAuthMethod[]
}

/**
 * Detect-only: reports which auth mechanisms already configured on this machine would satisfy
 * a push/fetch against this repo's remote, without Nexy ever storing or handling a secret
 * itself. Every check shells out to something the user already set up (a provider CLI, the OS
 * credential helper, or an SSH agent) — this never reads or returns the credential value.
 */
export async function detectGitCredentials(repoRoot: string): Promise<GitAuthInfo> {
  const remoteUrl = await git(['remote', 'get-url', 'origin'], repoRoot).catch(() => '')
  if (!remoteUrl) {
    return { remoteUrl: null, host: null, protocol: null, methods: [] }
  }

  let host: string | null = null
  let protocol: 'ssh' | 'https' | null = null
  const sshMatch = /^git@([^:]+):/.exec(remoteUrl) || /^ssh:\/\/(?:[^@]+@)?([^/:]+)/.exec(remoteUrl)
  const httpsMatch = /^https?:\/\/(?:[^@/]+@)?([^/:]+)/.exec(remoteUrl)
  if (sshMatch) {
    host = sshMatch[1]
    protocol = 'ssh'
  } else if (httpsMatch) {
    host = httpsMatch[1]
    protocol = 'https'
  }

  const methods: GitAuthMethod[] = []

  const tryCli = async (bin: string, args: string[], type: GitAuthMethod['type'], label: string) => {
    try {
      const { stdout, stderr } = await execFileAsync(bin, args, { cwd: repoRoot, timeout: 5000 })
      const output = `${stdout}\n${stderr}`.trim()
      methods.push({ type, label, detail: output.split('\n')[0]?.trim() || `${bin} reports an active session`, available: true })
    } catch {
      // Binary missing or not logged in — not an error, just unavailable
    }
  }

  if (host && /github\.com$/i.test(host)) {
    await tryCli('gh', ['auth', 'status'], 'gh-cli', 'GitHub CLI (gh)')
  } else if (host && /gitlab/i.test(host)) {
    await tryCli('glab', ['auth', 'status'], 'glab-cli', 'GitLab CLI (glab)')
  } else if (host) {
    // Unknown/self-hosted host — Gitea's CLI is the most common self-hosted match, worth a
    // best-effort check even though we can't be sure from the hostname alone.
    await tryCli('tea', ['login', 'list'], 'tea-cli', 'Gitea CLI (tea)')
  }

  if (protocol === 'ssh') {
    try {
      const { stdout } = await execFileAsync('ssh-add', ['-l'], { timeout: 5000 })
      const keys = stdout.trim().split('\n').filter(Boolean)
      if (keys.length > 0) {
        methods.push({
          type: 'ssh-key',
          label: 'SSH agent',
          detail: `${keys.length} key${keys.length === 1 ? '' : 's'} loaded in ssh-agent`,
          available: true,
        })
      }
    } catch {
      // No agent running or no keys loaded
    }
  }

  if (protocol === 'https' && host) {
    try {
      // `git credential fill` asks the configured credential helper for a match without ever
      // performing a network request — stdin only needs protocol+host, and we deliberately never
      // read/return the `password=` line it may print back.
      const stdout = await execWithStdin('git', ['credential', 'fill'], repoRoot, `protocol=https\nhost=${host}\n\n`)
      if (/^username=/m.test(stdout)) {
        const usernameMatch = /^username=(.+)$/m.exec(stdout)
        methods.push({
          type: 'credential-helper',
          label: 'Git credential helper',
          detail: usernameMatch ? `Stored credential for ${usernameMatch[1]}` : 'Stored credential found',
          available: true,
        })
      }
    } catch {
      // No credential helper configured, or no match for this host
    }
  }

  return { remoteUrl, host, protocol, methods }
}

/** `git push`; on "no upstream" (a branch that's never been pushed before), retries once with
 *  `--set-upstream origin <branch>` instead of surfacing a raw error the user has to decode. */
export async function pushRepo(repoRoot: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await git(['push'], repoRoot)
    return { ok: true }
  } catch (error) {
    const message = extractGitError(error)
    if (/has no upstream branch|set-upstream/i.test(message)) {
      try {
        const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)
        await git(['push', '--set-upstream', 'origin', branch], repoRoot)
        return { ok: true }
      } catch (retryError) {
        return { ok: false, error: extractGitError(retryError) }
      }
    }
    return { ok: false, error: message }
  }
}

/** Stages the given files (or everything changed, if none given) and commits them. */
export async function commitChanges(
  repoRoot: string,
  message: string,
  files?: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (files && files.length > 0) {
      await git(['add', '--', ...files], repoRoot)
    } else {
      // No explicit file list — if the user already staged something with the "Stage" action,
      // commit exactly that instead of blowing it away with `add -A` (which would silently
      // stage everything else too). Only fall back to "stage everything" when nothing has been
      // staged yet, preserving the old one-tap "just commit it all" convenience.
      const alreadyStaged = (await getChangedFiles(repoRoot)).some((f) => f.staged)
      if (!alreadyStaged) {
        await git(['add', '-A'], repoRoot)
      }
    }
    await git(['commit', '-m', message], repoRoot)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

/** Reverts a single file to its last-committed state — `git checkout -- <path>` for a tracked
 *  file with local edits, or a plain delete for a file git has never seen (`??` in status). */
export async function discardFileChanges(repoRoot: string, relativePath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const status = await git(['status', '--porcelain', '--', relativePath], repoRoot).catch(() => '')
    if (status.trim().startsWith('??')) {
      await fs.unlink(path.join(repoRoot, relativePath))
    } else {
      await git(['checkout', '--', relativePath], repoRoot)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

/** Shelves all current changes (`git stash push`). */
export async function stashChanges(repoRoot: string, message?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push']
    await git(args, repoRoot)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

/** Restores the most recent stash. Conflicts are reported as a plain error (unlike merge/pull,
 *  this doesn't feed the AI-resolution flow) — stash conflicts are rare enough, and the file's
 *  still recoverable via `git stash list`/`git checkout`, that a friendlier error is enough. */
export async function stashPop(repoRoot: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await git(['stash', 'pop'], repoRoot)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

/** Number of stash entries — gates whether a "Stash pop" action should even be shown. */
export async function getStashCount(repoRoot: string): Promise<number> {
  const output = await git(['stash', 'list'], repoRoot).catch(() => '')
  return output.split('\n').filter((line) => line.trim().length > 0).length
}

/** `git branch -d` (or `-D` when `force`), optionally also deleting the remote-tracking branch.
 *  Deleting the currently checked-out branch is rejected by git itself with a clear error, so no
 *  extra guard is needed here beyond what the caller already filters in the branch list UI. */
export async function deleteBranch(
  repoRoot: string,
  branchName: string,
  options: { deleteRemote?: boolean; force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  try {
    await git(['branch', options.force ? '-D' : '-d', branchName], repoRoot)
    if (options.deleteRemote) {
      await git(['push', 'origin', '--delete', branchName], repoRoot)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: extractGitError(error) }
  }
}

export interface FileDiffResult {
  diff: string
  binary: boolean
}

/**
 * Unified diff text for a single changed file, formatted for `NexyDiffContent` (the existing
 * red/green diff renderer already used by ProjectAuditScreen/FileTreeView — reused here rather
 * than building a second diff-rendering component). Untracked files have nothing to diff against
 * in git, so they're rendered as a synthetic all-added hunk instead of an empty result.
 */
export async function getFileDiff(repoRoot: string, relativePath: string): Promise<FileDiffResult> {
  const status = await git(['status', '--porcelain', '--', relativePath], repoRoot).catch(() => '')
  if (status.trim().startsWith('??')) {
    try {
      const content = await fs.readFile(path.join(repoRoot, relativePath), 'utf-8')
      const lines = content.split('\n')
      const body = lines.map((line) => `+${line}`).join('\n')
      return { diff: `@@ -0,0 +1,${lines.length} @@\n${body}`, binary: false }
    } catch {
      return { diff: '', binary: true }
    }
  }

  // A huge (rather than git's default 3-line) context means the unified diff effectively always
  // includes the whole file, unchanged lines and all — so the mobile viewer never has to hide
  // part of the file behind a collapsed hunk boundary the user would need a separate "expand"
  // affordance to reveal. Scrolling (see DiffSection in CodePanelScreen.kt) is enough on its own.
  // This also means the diff output is now roughly the size of the whole file, not just a few
  // lines of context — Node's execFile defaults to a 1MB stdout cap, which a full-context diff
  // of anything but a small file blows past; a silent overflow there looks identical to "no
  // changes" instead of an error, so it needs a much larger explicit maxBuffer here.
  const fullContextArgs = ['diff', '--unified=100000']
  const maxBuffer = 64 * 1024 * 1024
  try {
    const diff = await execFileAsync('git', [...fullContextArgs, 'HEAD', '--', relativePath], { cwd: repoRoot, timeout: 15000, maxBuffer })
    return { diff: diff.stdout, binary: /^Binary files /m.test(diff.stdout) }
  } catch {
    // No HEAD yet (brand-new repo, no commits) — diff against git's well-known empty tree hash.
    try {
      const diff = await execFileAsync(
        'git',
        [...fullContextArgs, '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '--', relativePath],
        { cwd: repoRoot, timeout: 15000, maxBuffer },
      )
      return { diff: diff.stdout, binary: /^Binary files /m.test(diff.stdout) }
    } catch {
      return { diff: '', binary: false }
    }
  }
}
