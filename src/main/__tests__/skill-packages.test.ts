import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { parseSkillMarkdown, skillToMarkdown } from '../skill-markdown'
import {
  applySkillPackageFiles,
  hashSkillPackage,
  listSkillPackageFiles,
  loadSkillPackage,
  readSkillResource,
  validateSkillPackage,
} from '../skill-packages'
import type { SkillConfig } from '../../shared/types'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempPackage(): string {
  const root = mkdtempSync(join(tmpdir(), 'nexy-skill-package-'))
  roots.push(root)
  return root
}

describe('Agent Skills packages', () => {
  it('parses nested YAML and preserves unknown provider frontmatter', () => {
    const markdown = `---
name: release-notes
description: >-
  Prepare concise release notes when a user asks for a changelog.
license: MIT
metadata:
  nexy:
    tags:
      - release
context: fork
---

# Release notes

Use references/style.md when formatting the result.
`
    const parsed = parseSkillMarkdown(markdown)
    expect(parsed.description).toContain('Prepare concise release notes')
    expect(parsed.frontmatter).toMatchObject({ license: 'MIT', context: 'fork', metadata: { nexy: { tags: ['release'] } } })

    const config = {
      id: 'skill-1', icon: '✨', tags: [], tools: {
        fileEdit: { enabled: false, approval: 'always-ask', instructions: '' },
        terminal: { enabled: false, approval: 'always-ask', instructions: '' },
        webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
      }, mcpServers: [], mcpServerTrust: [], mcpToolOverrides: [], knowledge: [],
      ...parsed,
    } as SkillConfig
    expect(parseSkillMarkdown(skillToMarkdown(config)).frontmatter).toMatchObject({ license: 'MIT', context: 'fork' })
  })

  it('loads and hashes a complete package without flattening support files', () => {
    const root = tempPackage()
    mkdirSync(join(root, 'references'))
    writeFileSync(join(root, 'SKILL.md'), '---\nname: release-notes\ndescription: Use when preparing a changelog.\n---\n\nFollow the style reference.\n')
    writeFileSync(join(root, 'references', 'style.md'), 'Keep headings short.\n')

    const loaded = loadSkillPackage(root)
    expect(loaded.name).toBe('release-notes')
    expect(loaded.validationStatus).toBe('valid')
    expect(loaded.contentHash).toBe(hashSkillPackage(root))
    expect(readSkillResource(root, 'references/style.md')).toContain('headings short')
  })

  it('blocks traversal and reports invalid metadata', () => {
    const root = tempPackage()
    writeFileSync(join(root, 'SKILL.md'), '---\nname: bad skill\ndescription: ""\n---\n')
    expect(() => readSkillResource(root, '../secret.txt')).toThrow(/escapes|relative/)
    expect(validateSkillPackage(parseSkillMarkdown('---\nname: bad skill\ndescription: ""\n---\n'), root).status).toBe('invalid')
  })

  it('round-trips text and binary support files through the portable package payload', () => {
    const source = tempPackage()
    mkdirSync(join(source, 'references'))
    mkdirSync(join(source, 'assets'))
    writeFileSync(join(source, 'SKILL.md'), '---\nname: portable\ndescription: Use for portable tests.\n---\n\nFollow the reference.\n')
    writeFileSync(join(source, 'references', 'guide.md'), 'Keep it short.\n')
    writeFileSync(join(source, 'assets', 'pixel.bin'), Buffer.from([0, 1, 2, 255]))

    const files = listSkillPackageFiles(source)
    expect(files.map(file => [file.relativePath, file.encoding])).toEqual(expect.arrayContaining([
      ['assets/pixel.bin', 'base64'],
      ['references/guide.md', 'utf8'],
      ['SKILL.md', 'utf8'],
    ]))

    const target = tempPackage()
    writeFileSync(join(target, 'SKILL.md'), 'canonical entry')
    applySkillPackageFiles(target, files)
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('canonical entry')
    expect(readFileSync(join(target, 'references', 'guide.md'), 'utf8')).toBe('Keep it short.\n')
    expect(readFileSync(join(target, 'assets', 'pixel.bin'))).toEqual(Buffer.from([0, 1, 2, 255]))
  })

  it('rejects unsafe synchronized package paths before writing', () => {
    const root = tempPackage()
    writeFileSync(join(root, 'SKILL.md'), 'canonical entry')
    expect(() => applySkillPackageFiles(root, [{
      relativePath: '../escape.txt', encoding: 'utf8', content: 'nope', sizeBytes: 4,
    }])).toThrow(/escapes/)
    expect(() => applySkillPackageFiles(root, [{
      relativePath: 'references\\escape.txt', encoding: 'utf8', content: 'nope', sizeBytes: 4,
    }])).toThrow(/POSIX-style/)
  })
})
