import { describe, expect, it } from 'vitest'
import { normalizeSkillConfig } from '../skills'

describe('skills', () => {
  it('normalizes partial skill configs with safe defaults', () => {
    const skill = normalizeSkillConfig({
      name: '  Review Helper  ',
      tools: {
        fileEdit: true,
        terminal: { enabled: true, approval: 'auto', instructions: 'Run focused tests.' },
      },
      knowledge: [{ title: 'Scope', content: 'Keep changes small.' }],
      tags: ['review', 7],
    } as Record<string, unknown>)

    expect(skill.name).toBe('Review Helper')
    expect(skill.icon).toBe('✨')
    expect(skill.tools.fileEdit).toEqual({
      enabled: true,
      approval: 'always-ask',
      instructions: '',
    })
    expect(skill.tools.terminal).toEqual({
      enabled: true,
      approval: 'auto',
      instructions: 'Run focused tests.',
    })
    expect(skill.tools.webFetch.enabled).toBe(false)
    expect(skill.knowledge).toEqual([{ title: 'Scope', content: 'Keep changes small.' }])
    expect(skill.tags).toEqual(['review'])
  })
})
