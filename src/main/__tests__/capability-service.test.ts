import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateConversationCapabilities,
  assertCapabilityProfileValid,
  getProjectCapabilityProfile,
  isBuiltInToolAllowed,
  mergeCapabilityProfiles,
  normalizeCapabilityProfile,
  setProjectCapabilityProfile,
} from '../capability-service'

vi.mock('../mcp', () => ({ getMcpServersWithStatus: () => mockServers }))
vi.mock('../skills', () => ({ getSkillConfig: (id: string) => mockSkills.get(id) ?? null, getSkillConfigsForAgent: () => [], setSkillAgentAttachment: vi.fn() }))

let mockServers: Array<{ id: string }> = []
let mockSkills = new Map<string, { id: string; name: string; validationStatus?: string }>()

/** Minimal projects-table stand-in: one row, config_json read back exactly as written. */
function projectDb(initialConfigJson: string | null) {
  const state = { config_json: initialConfigJson }
  const db = {
    prepare(sql: string) {
      return {
        get: () => (sql.includes('FROM projects') ? { config_json: state.config_json } : undefined),
        run: (configJson: string) => { state.config_json = configJson },
      }
    },
  } as never
  return { db, state }
}

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

  it('keeps a project built-in tool disable as the effective policy ceiling', () => {
    const profile = mergeCapabilityProfiles([
      { version: 1, skillIds: [], mcp: [], builtInTools: { terminal: { enabled: false, approval: 'disabled' } } },
      { version: 1, skillIds: [], mcp: [], builtInTools: { terminal: { enabled: true, approval: 'auto' } } },
    ])

    expect(profile.builtInTools?.terminal).toEqual({ enabled: false, approval: 'disabled' })
    expect(isBuiltInToolAllowed(profile, 'terminal')).toBe(false)
    expect(isBuiltInToolAllowed(profile, 'webFetch')).toBe(true)
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

describe('project capability profiles', () => {
  beforeEach(() => {
    mockServers = [{ id: 'browser' }, { id: 'thingsboard' }]
    mockSkills = new Map([['audit', { id: 'audit', name: 'Audit' }]])
  })

  it('replaces rather than merges, so a grant can actually be revoked', () => {
    const { db, state } = projectDb(JSON.stringify({
      rootDirectory: 'C:/repo',
      capabilityProfile: { version: 1, skillIds: ['audit'], mcp: [{ serverId: 'browser', trust: 'always-ask' }] },
    }))

    const saved = setProjectCapabilityProfile(db, 'project-1', { version: 1, skillIds: [], mcp: [] })

    expect(saved).toEqual({ version: 1, skillIds: [], mcp: [] })
    expect(getProjectCapabilityProfile(db, 'project-1')).toEqual({ version: 1, skillIds: [], mcp: [] })
    // Unrelated project config must survive a capability write.
    expect(JSON.parse(state.config_json!).rootDirectory).toBe('C:/repo')
  })

  it('loosens trust on the project scope, which the additive activation path cannot do', () => {
    const { db } = projectDb(JSON.stringify({
      capabilityProfile: { version: 1, skillIds: [], mcp: [{ serverId: 'browser', trust: 'always-ask' }] },
    }))

    setProjectCapabilityProfile(db, 'project-1', { version: 1, skillIds: [], mcp: [{ serverId: 'browser', trust: 'auto' }] })

    expect(getProjectCapabilityProfile(db, 'project-1').mcp).toEqual([{ serverId: 'browser', trust: 'auto' }])
  })

  it('rejects references that cannot be honoured at execution time', () => {
    expect(() => assertCapabilityProfileValid({ version: 1, skillIds: ['ghost'], mcp: [] }))
      .toThrow('Skill not found: ghost')
    expect(() => assertCapabilityProfileValid({ version: 1, skillIds: [], mcp: [{ serverId: 'ghost', trust: 'auto' }] }))
      .toThrow('MCP server not found: ghost')
    expect(() => assertCapabilityProfileValid({ version: 1, skillIds: ['audit'], mcp: [{ serverId: 'browser', trust: 'auto' }] }))
      .not.toThrow()
  })
})
