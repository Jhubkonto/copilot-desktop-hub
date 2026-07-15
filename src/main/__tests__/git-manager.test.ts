import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getChangedFiles } from '../code-change/git-manager'

let repoRoot: string

function git(args: string[]) {
  execFileSync('git', args, { cwd: repoRoot })
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'nexy-git-manager-test-'))
  git(['init', '-q'])
  git(['config', 'user.email', 'test@test.com'])
  git(['config', 'user.name', 'Test'])
})

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true })
})

describe('getChangedFiles', () => {
  it('r1: an unstaged modification to the first (alphabetically) file is reported unstaged, not staged', async () => {
    // Regression test: git status --porcelain lines for an unstaged change start with a literal
    // leading space (" M path"). The old implementation ran the whole multi-line stdout through
    // a single `.trim()`, which stripped that leading space off only the *first* line — shifting
    // its status-column read and its path parsing by one character. So the first changed file in
    // the list always looked staged and its path was mangled (breaking its diff lookup), even
    // though every other line was parsed correctly.
    writeFileSync(join(repoRoot, 'aaa.txt'), 'original\n')
    writeFileSync(join(repoRoot, 'zzz.txt'), 'original\n')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'init'])

    writeFileSync(join(repoRoot, 'aaa.txt'), 'changed\n')

    const files = await getChangedFiles(repoRoot)
    expect(files).toEqual([{ relativePath: 'aaa.txt', staged: false }])
  })

  it('r2: a staged file correctly reports staged: true', async () => {
    writeFileSync(join(repoRoot, 'aaa.txt'), 'original\n')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'init'])

    writeFileSync(join(repoRoot, 'aaa.txt'), 'changed\n')
    git(['add', '-A'])

    const files = await getChangedFiles(repoRoot)
    expect(files).toEqual([{ relativePath: 'aaa.txt', staged: true }])
  })

  it('r3: multiple unstaged files all report the correct path and staged state', async () => {
    writeFileSync(join(repoRoot, 'aaa.txt'), 'original\n')
    writeFileSync(join(repoRoot, 'bbb.txt'), 'original\n')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'init'])

    writeFileSync(join(repoRoot, 'aaa.txt'), 'changed\n')
    writeFileSync(join(repoRoot, 'bbb.txt'), 'changed\n')

    const files = await getChangedFiles(repoRoot)
    expect(files).toEqual([
      { relativePath: 'aaa.txt', staged: false },
      { relativePath: 'bbb.txt', staged: false },
    ])
  })
})
