import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ upsert: vi.fn() }))

vi.mock('../skills', () => ({
  upsertSkillConfigByName: state.upsert,
}))

import {
  persistSkillCapture,
  prepareSkillCapture,
  requestsSkillCapture,
} from '../skill-service'

describe('skill capture service', () => {
  beforeEach(() => state.upsert.mockReset())

  it('requires explicit skill retention intent', () => {
    expect(requestsSkillCapture('Explain how skills work')).toBe(false)
    expect(requestsSkillCapture('Create a reusable skill and save it into Nexy')).toBe(true)
    expect(requestsSkillCapture('Import this SKILL.md into my library')).toBe(true)
  })

  it('prepares structured skill content and rejects missing instructions', () => {
    expect(prepareSkillCapture({ name: 'demo', instructions: 'Do the work.' })).toMatchObject({
      name: 'demo',
      imported: false,
    })
    expect(prepareSkillCapture({ name: 'demo' })).toEqual({
      error: 'A skill needs instructions (provide `instructions` or a `markdown` body).',
    })
  })

  it('parses markdown and adds common provenance tags exactly once', () => {
    const prepared = prepareSkillCapture({
      markdown: '---\nname: demo\ndescription: Demo\n---\n\n# Demo\n\nDo the work.',
    })
    expect('error' in prepared).toBe(false)
    if ('error' in prepared) return

    state.upsert.mockReturnValue({ skill: { id: 'skill-1', name: 'demo' }, created: true })
    expect(persistSkillCapture({ ...prepared, partial: { ...prepared.partial, tags: ['imported'] } })).toEqual({
      skill: { id: 'skill-1', name: 'demo' },
      created: true,
    })
    expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'demo',
      tags: ['imported', 'auto-captured'],
    }))
  })
})
