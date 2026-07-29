import { describe, it, expect } from 'vitest'
import { parseSkillMarkdown, skillToMarkdown, splitFrontmatter } from '../skill-markdown'
import type { SkillConfig } from '../../shared/types'

function makeSkill(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: 'skill-1',
    name: 'Code Reviewer',
    icon: '🔍',
    description: 'Reviews diffs for correctness',
    instructions: 'When reviewing, focus on correctness first.\n\nAvoid style nitpicks.',
    tools: {
      fileEdit: { enabled: true, approval: 'always-ask', instructions: 'Only touch reviewed files' },
      terminal: { enabled: true, approval: 'auto', instructions: '' },
      webFetch: { enabled: false, approval: 'always-ask', instructions: '' },
    },
    mcpServers: ['github'],
    mcpServerTrust: [],
    mcpToolOverrides: [],
    knowledge: [{ title: 'Style guide', content: 'Two-space indent.' }],
    tags: ['review', 'quality'],
    ...overrides,
  }
}

describe('skill-markdown codec', () => {
  it('round-trips a full SkillConfig losslessly', () => {
    const skill = makeSkill()
    const md = skillToMarkdown(skill)
    const parsed = parseSkillMarkdown(md)

    expect(parsed.name).toBe(skill.name)
    expect(parsed.description).toBe(skill.description)
    expect(parsed.icon).toBe(skill.icon)
    expect(parsed.instructions).toBe(skill.instructions)
    expect(parsed.tags).toEqual(skill.tags)
    expect(parsed.mcpServers).toEqual(skill.mcpServers)
    expect(parsed.knowledge).toEqual(skill.knowledge)
    expect(parsed.tools).toEqual(skill.tools)
  })

  it('emits a portable skill name and only auto-approved tools as allowed-tools', () => {
    const md = skillToMarkdown(makeSkill())
    const { frontmatter } = splitFrontmatter(md)
    expect(frontmatter.name).toBe('code-reviewer')
    expect(frontmatter['x-nexy-display-name']).toBe('Code Reviewer')
    expect(frontmatter['allowed-tools']).not.toContain('Read')
    expect(frontmatter['allowed-tools']).toContain('Bash')
    expect(frontmatter['allowed-tools']).not.toContain('WebFetch')
  })

  it('imports an Anthropic-style SKILL.md (frontmatter + body, no nexy extensions)', () => {
    const md = [
      '---',
      'name: PDF Extractor',
      'description: Extracts text from PDF files',
      'allowed-tools: ["Read", "Bash"]',
      '---',
      '',
      'Use pdfplumber to extract text. Prefer the layout mode.',
    ].join('\n')

    const parsed = parseSkillMarkdown(md)
    expect(parsed.name).toBe('PDF Extractor')
    expect(parsed.description).toBe('Extracts text from PDF files')
    expect(parsed.instructions).toBe('Use pdfplumber to extract text. Prefer the layout mode.')
    expect(parsed.tools?.fileEdit.enabled).toBe(true)
    expect(parsed.tools?.terminal.enabled).toBe(true)
    expect(parsed.tools?.webFetch.enabled).toBe(false)
    // Imported tools never carry auto-approval by default.
    expect(parsed.tools?.fileEdit.approval).toBe('always-ask')
  })

  it('supports space-separated and YAML-list allowed-tools values', () => {
    const spaceSeparated = parseSkillMarkdown([
      '---',
      'name: git-helper',
      'description: Helps with Git',
      'allowed-tools: Read Bash(git status *) WebFetch',
      '---',
      'Use the declared tools.',
    ].join('\n'))
    expect(spaceSeparated.tools?.fileEdit.enabled).toBe(true)
    expect(spaceSeparated.tools?.terminal.enabled).toBe(true)
    expect(spaceSeparated.tools?.webFetch.enabled).toBe(true)

    const yamlList = parseSkillMarkdown([
      '---',
      'name: list-tools',
      'description: Uses a YAML list',
      'allowed-tools:',
      '  - Read',
      '  - Bash',
      '---',
      'Use the listed tools.',
    ].join('\n'))
    expect(yamlList.tools?.fileEdit.enabled).toBe(true)
    expect(yamlList.tools?.terminal.enabled).toBe(true)
  })

  it('provides the required description when exporting a legacy Nexy skill without one', () => {
    const { frontmatter } = splitFrontmatter(skillToMarkdown(makeSkill({ description: '' })))
    expect(frontmatter.description).toContain('Use when')
  })

  it('defaults all tool buckets to disabled when no tools are declared', () => {
    const parsed = parseSkillMarkdown('---\nname: Notes\n---\n\nJust take notes.')
    expect(parsed.tools).toBeUndefined()
  })

  it('tolerates a document with no frontmatter (whole doc is instructions)', () => {
    const parsed = parseSkillMarkdown('Just some free-form instructions with no frontmatter.')
    expect(parsed.name).toBeUndefined()
    expect(parsed.instructions).toBe('Just some free-form instructions with no frontmatter.')
  })

  it('tolerates malformed frontmatter (missing closing fence)', () => {
    const parsed = parseSkillMarkdown('---\nname: Broken\ndescription: no close\n\nbody text')
    // Without a closing fence the whole thing is treated as body.
    expect(parsed.instructions).toContain('body text')
  })

  it('unwraps a SKILL.md fenced inside prose', () => {
    const md = [
      'Here is the skill I made:',
      '',
      '```markdown',
      '---',
      'name: Wrapped',
      '---',
      '',
      'Wrapped instructions.',
      '```',
      '',
      'Let me know if you want changes.',
    ].join('\n')
    const parsed = parseSkillMarkdown(md)
    expect(parsed.name).toBe('Wrapped')
    expect(parsed.instructions).toBe('Wrapped instructions.')
  })

  it('parses a Knowledge section into knowledge entries', () => {
    const md = [
      '---',
      'name: Has Knowledge',
      '---',
      '',
      'Body instructions here.',
      '',
      '## Knowledge',
      '',
      '### First',
      '',
      'First fact.',
      '',
      '### Second',
      '',
      'Second fact.',
    ].join('\n')
    const parsed = parseSkillMarkdown(md)
    expect(parsed.instructions).toBe('Body instructions here.')
    expect(parsed.knowledge).toEqual([
      { title: 'First', content: 'First fact.' },
      { title: 'Second', content: 'Second fact.' },
    ])
  })
})
