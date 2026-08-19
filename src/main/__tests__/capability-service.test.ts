import { describe, expect, it, vi } from 'vitest'
import { activateConversationCapabilities, mergeCapabilityProfiles, normalizeCapabilityProfile } from '../capability-service'

vi.mock('../mcp', () => ({ getMcpServersWithStatus: () => [] }))
vi.mock('../skills', () => ({ getSkillConfig: () => null, getSkillConfigsForAgent: () => [], setSkillAgentAttachment: vi.fn() }))

describe('conversation capability profiles', () => {
  it('normalizes unknown and duplicate references without retaining secrets', () => {
    expect(normalizeCapabilityProfile({
      version: 99,
      skillIds: ['skill-a', 'skill-a', 42, ''],
      mcp: [
        { serverId: 'browser', trust: 'auto', apiKey: 'must-not-survive' },
        { serverId: 'browser', trust: 'not-a-tier' },
        { serverId: '', trust: 'block' },
      ],
    })).toEqual({
      version: 1,
      skillIds: ['skill-a'],
      mcp: [{ serverId: 'browser', trust: 'always-ask' }],
    })
  })

  it('defaults MCP trust to always-ask', () => {
    expect(normalizeCapabilityProfile({ mcp: [{ serverId: 'browser' }] }).mcp)
      .toEqual([{ serverId: 'browser', trust: 'always-ask' }])
  })

  it('keeps inherited restrictions when scopes are combined', () => {
    expect(mergeCapabilityProfiles([
      { version: 1, skillIds: ['agent-skill'], mcp: [{ serverId: 'browser', trust: 'always-ask' }] },
      { version: 1, skillIds: ['project-skill'], mcp: [{ serverId: 'browser', trust: 'auto' }] },
      { version: 1, skillIds: ['chat-skill'], mcp: [{ serverId: 'blocked', trust: 'block' }] },
    ])).toEqual({
      version: 1,
      skillIds: ['agent-skill', 'project-skill', 'chat-skill'],
      mcp: [
        { serverId: 'browser', trust: 'always-ask' },
        { serverId: 'blocked', trust: 'block' },
      ],
    })
  })

  it('replaces the chat profile when activation submits an empty selection', () => {
    const updates: string[] = []
    const db = {
      prepare(sql: string) {
        return {
          get: () => sql.includes('capability_profile_json')
            ? { capability_profile_json: JSON.stringify({ version: 1, skillIds: ['old'], mcp: [] }) }
            : { id: 'conversation-1' },
          run: (profile: string) => { updates.push(profile) },
        }
      },
    } as never

    const result = activateConversationCapabilities(db, 'conversation-1', { scope: 'chat', skillIds: [], mcp: [] })
    expect(result).toEqual({ version: 1, skillIds: [], mcp: [] })
    expect(JSON.parse(updates[0])).toEqual({ version: 1, skillIds: [], mcp: [] })
  })
})
