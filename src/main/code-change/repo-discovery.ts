/**
 * Multi-repo discovery for Code Changes workspaces.
 * Scans a workspace root for .git directories/files and returns available repos.
 */

import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface RepoDescriptor {
  relativePath: string
  repoRoot: string
  branch: string
  dirty: boolean
}

/**
 * Discover all git repositories under a workspace root.
 * Handles both directory-style .git (regular repos) and file-style .git (worktrees).
 * Bounded to prevent scanning deep/large directory trees.
 */
export async function discoverReposInWorkspace(rootDirectory: string): Promise<RepoDescriptor[]> {
  const repos: RepoDescriptor[] = []
  const maxDepth = 3
  const maxDirs = 1000
  let dirCount = 0

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || dirCount > maxDirs) return

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        dirCount++
        if (dirCount > maxDirs) break

        const fullPath = path.join(dir, entry.name)

        // Check if this is a .git file or directory
        if (entry.name === '.git') {
          try {
            const isDir = entry.isDirectory()

            if (isDir || entry.isFile()) {
              // The repo's relative path is relative to its containing folder, not to the .git
              // entry itself — `path.relative(rootDirectory, fullPath)` would incorrectly include
              // the trailing "/.git" component (e.g. "frontend/.git" instead of "frontend"), which
              // callers that round-trip this value back through `path.join(workspaceRoot, ...)`
              // (resolving which repo a project Git command targets) would resolve to a path
              // inside the git internals directory instead of the repo root.
              const repoRelativePath = path.relative(rootDirectory, dir)
              // Resolve the actual repo info
              const descriptor = await getRepoInfo(fullPath, rootDirectory, repoRelativePath)
              if (descriptor) {
                repos.push(descriptor)
              }
            }
          } catch (err) {
            // Silently skip repos we can't read
            console.debug(`Skipping repo at ${fullPath}:`, err)
          }
          continue
        }

        // Recurse into directories (but skip common unneeded paths)
        if (entry.isDirectory() && depth < maxDepth) {
          const skip = [
            'node_modules',
            '.venv',
            'venv',
            'env',
            '__pycache__',
            '.cache',
            'build',
            'dist',
            '.next',
            'out',
            '.turbo',
            '.git', // Already handled above
            // Claude Code's own tooling directory — agent worktrees created under
            // .claude/worktrees/* are real git worktrees (each with its own .git file), but
            // they're internal session scratch space, not a repo of the user's project. Without
            // this exclusion, a lingering agent worktree makes an otherwise single-repo workspace
            // look ambiguous and blocks Git commands with a disambiguation prompt the user has no
            // real way to resolve (worktree paths aren't something they'd ever intentionally target).
            '.claude',
          ]
          if (!skip.includes(entry.name)) {
            await scan(fullPath, depth + 1)
          }
        }
      }
    } catch (err) {
      // Silently skip unreadable directories
      console.debug(`Could not read directory ${dir}:`, err)
    }
  }

  // Start scan from root
  await scan(rootDirectory, 0)

  return repos
}

/**
 * Get repo info (branch, dirty status) for a discovered .git location.
 * Returns null if the location is not a valid git repo.
 */
async function getRepoInfo(
  gitPath: string,
  workspaceRoot: string,
  relativePath: string,
): Promise<RepoDescriptor | null> {
  try {
    let repoRoot: string

    // For .git files (worktrees), read the gitdir path
    const stats = await fs.stat(gitPath)
    if (stats.isFile()) {
      const content = await fs.readFile(gitPath, 'utf-8')
      const gitdirMatch = /gitdir:\s*(.+)/.exec(content.trim())
      if (!gitdirMatch) return null
      let gitdir = gitdirMatch[1].trim()
      if (!path.isAbsolute(gitdir)) {
        gitdir = path.resolve(path.dirname(gitPath), gitdir)
      }
      repoRoot = path.dirname(gitPath)
    } else {
      // Regular .git directory
      repoRoot = path.dirname(gitPath)
    }

    // Get current branch
    let branch = 'main'
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: repoRoot,
        timeout: 5000,
      })
      branch = stdout.trim()
    } catch (err) {
      console.debug(`Could not get branch for ${repoRoot}:`, err)
      branch = '(detached)'
    }

    // Check if dirty
    let dirty = false
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: repoRoot,
        timeout: 5000,
      })
      dirty = stdout.trim().length > 0
    } catch (err) {
      console.debug(`Could not get status for ${repoRoot}:`, err)
    }

    return {
      relativePath: relativePath.replace(/[\\]/g, '/'), // Normalize to forward slashes
      repoRoot,
      branch,
      dirty,
    }
  } catch (err) {
    console.debug(`Failed to get repo info for ${gitPath}:`, err)
    return null
  }
}

/**
 * List all files in a repository, relative to the repo root.
 * Used for the step 1 file browser.
 */
export async function listRepoFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files'], {
      cwd: repoRoot,
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
    })
    return stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
  } catch (err) {
    console.error(`Failed to list files for ${repoRoot}:`, err)
    return []
  }
}
