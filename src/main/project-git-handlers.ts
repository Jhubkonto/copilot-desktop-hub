import path from 'path'
import { getProjectRootDirectory, detectProjectWorkspaceMetadata } from './project-handlers'
import { safeHandle } from './safe-handle'
import {
  checkoutBranch,
  commitChanges,
  createBranch,
  deleteBranch,
  detectGitCredentials,
  discardFileChanges,
  fetchRepo,
  getChangedFiles,
  getFileDiff,
  getStashCount,
  initRepo,
  listBranches,
  mergeBranch,
  pullRepo,
  pushRepo,
  stageFiles,
  stashChanges,
  stashPop,
  unstageFiles,
} from './code-change/git-manager'
import { discoverReposInWorkspace, listRepoFiles } from './code-change/repo-discovery'

export type ResolveProjectRepoResult =
  | { ok: true; repoRoot: string; relativePath: string }
  | { ok: false; reason: 'no-repo' | 'ambiguous'; candidates?: string[] }

export async function resolveProjectRepo(
  workspaceRoot: string,
  repoRelativePath?: string,
): Promise<ResolveProjectRepoResult> {
  if (repoRelativePath) {
    const candidateRoot = path.join(workspaceRoot, repoRelativePath)
    const metadata = detectProjectWorkspaceMetadata(candidateRoot)
    return metadata?.isGitRepo
      ? { ok: true, repoRoot: metadata.repoRoot ?? candidateRoot, relativePath: repoRelativePath }
      : { ok: false, reason: 'no-repo' }
  }
  const repos = await discoverReposInWorkspace(workspaceRoot)
  if (repos.length === 0) return { ok: false, reason: 'no-repo' }
  if (repos.length === 1) {
    return { ok: true, repoRoot: repos[0].repoRoot, relativePath: repos[0].relativePath }
  }
  return { ok: false, reason: 'ambiguous', candidates: repos.map((repo) => repo.relativePath) }
}

export function registerProjectGitHandlers(): void {
  safeHandle('project-git:list-repos', async (_event, workspaceRoot: string) => {
    const repos = await discoverReposInWorkspace(workspaceRoot)
    return repos.map((repo) => ({ relativePath: repo.relativePath, branch: repo.branch, dirty: repo.dirty }))
  })
  safeHandle('project-git:list-repo-files', (_event, repoRoot: string) => listRepoFiles(repoRoot))
  safeHandle('project-git:list-changed-files', (_event, repoRoot: string) => getChangedFiles(repoRoot))
  safeHandle('project-git:resolve-repo', async (_event, projectId: string, repoRelativePath?: string) => {
    const workspaceRoot = getProjectRootDirectory(projectId)
    return workspaceRoot ? resolveProjectRepo(workspaceRoot, repoRelativePath) : { ok: false as const, reason: 'no-repo' as const }
  })
  safeHandle('project-git:list-branches', (_event, repoRoot: string) => listBranches(repoRoot))
  safeHandle('project-git:checkout-branch', (_event, repoRoot: string, branchName: string) => checkoutBranch(repoRoot, branchName))
  safeHandle('project-git:new-branch', (_event, repoRoot: string, branchName: string, fromRef?: string) => createBranch(repoRoot, branchName, fromRef))
  safeHandle('project-git:fetch', (_event, repoRoot: string, remote?: string) => fetchRepo(repoRoot, remote))
  safeHandle('project-git:merge-branch', (_event, repoRoot: string, sourceBranch: string) => mergeBranch(repoRoot, sourceBranch))
  safeHandle('project-git:init-repo', async (_event, projectId: string, relativePath?: string) => {
    const workspaceRoot = getProjectRootDirectory(projectId)
    if (!workspaceRoot) return { ok: false as const, error: 'This project has no workspace folder configured.' }
    return initRepo(relativePath ? path.join(workspaceRoot, relativePath) : workspaceRoot)
  })
  safeHandle('project-git:detect-credentials', (_event, repoRoot: string) => detectGitCredentials(repoRoot))
  safeHandle('project-git:pull', (_event, repoRoot: string, remote?: string) => pullRepo(repoRoot, remote))
  safeHandle('project-git:push', (_event, repoRoot: string) => pushRepo(repoRoot))
  safeHandle('project-git:commit', (_event, repoRoot: string, message: string, files?: string[]) => commitChanges(repoRoot, message, files))
  safeHandle('project-git:discard-file', (_event, repoRoot: string, relativePath: string) => discardFileChanges(repoRoot, relativePath))
  safeHandle('project-git:stage-files', (_event, repoRoot: string, relativePaths: string[]) => stageFiles(repoRoot, relativePaths))
  safeHandle('project-git:unstage-files', (_event, repoRoot: string, relativePaths: string[]) => unstageFiles(repoRoot, relativePaths))
  safeHandle('project-git:stash', (_event, repoRoot: string, message?: string) => stashChanges(repoRoot, message))
  safeHandle('project-git:stash-pop', (_event, repoRoot: string) => stashPop(repoRoot))
  safeHandle('project-git:stash-count', (_event, repoRoot: string) => getStashCount(repoRoot))
  safeHandle('project-git:delete-branch', (_event, repoRoot: string, branchName: string, options?: { deleteRemote?: boolean; force?: boolean }) => deleteBranch(repoRoot, branchName, options))
  safeHandle('project-git:file-diff', (_event, repoRoot: string, relativePath: string) => getFileDiff(repoRoot, relativePath))
}
