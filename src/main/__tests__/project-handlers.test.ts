import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectProjectWorkspaceMetadata, parseProjectConfig } from '../project-handlers'

const testRoot = path.join(tmpdir(), 'nexy-project-workspace-test')

function removeTestRoot(): void {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

describe('project workspace detection', () => {
  beforeEach(() => {
    removeTestRoot()
    mkdirSync(testRoot, { recursive: true })
  })

  afterEach(() => {
    removeTestRoot()
  })

  it('detects git repo metadata and coding markers', () => {
    const repoPath = path.join(testRoot, 'repo')
    mkdirSync(path.join(repoPath, 'src'), { recursive: true })
    writeFileSync(path.join(repoPath, 'package.json'), '{"name":"repo"}\n', 'utf8')
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'pipe' })
    git(repoPath, ['config', 'user.email', 'nexy@example.test'])
    git(repoPath, ['config', 'user.name', 'Nexy Test'])
    git(repoPath, ['add', '.'])
    git(repoPath, ['commit', '-m', 'init'])
    writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export const value = 1\n', 'utf8')

    const detected = detectProjectWorkspaceMetadata(repoPath)

    expect(detected).toEqual(expect.objectContaining({
      rootDirectory: repoPath,
      exists: true,
      isLikelyCodingWorkspace: true,
      isGitRepo: true,
      branch: expect.any(String),
      dirty: true,
      codingMarkers: expect.arrayContaining(['package.json', 'src']),
    }))
  })

  it('returns safe fallback metadata for a non-git directory', () => {
    const dirPath = path.join(testRoot, 'notes')
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(path.join(dirPath, 'README.md'), '# Notes\n', 'utf8')

    const detected = detectProjectWorkspaceMetadata(dirPath)

    expect(detected).toEqual(expect.objectContaining({
      rootDirectory: dirPath,
      exists: true,
      isLikelyCodingWorkspace: false,
      isGitRepo: false,
      branch: null,
      dirty: false,
      codingMarkers: [],
    }))
  })

  it('parses coding workspace fields from stored config', () => {
    const config = parseProjectConfig(JSON.stringify({
      rootDirectory: '/tmp/project',
      codingWorkspace: true,
      workspaceInfo: {
        rootDirectory: '/tmp/project',
        exists: true,
        isLikelyCodingWorkspace: true,
        codingMarkers: ['package.json'],
        isGitRepo: true,
        repoRoot: '/tmp/project',
        branch: 'main',
        dirty: false,
        scannedAt: 1,
      },
    }))

    expect(config).toEqual(expect.objectContaining({
      codingWorkspace: true,
      workspaceInfo: expect.objectContaining({
        isGitRepo: true,
        branch: 'main',
      }),
    }))
  })
})
