import type Database from 'better-sqlite3'
import { getSkillConfig, getSkillConfigsForAgent, setSkillAgentAttachment } from './skills'
import { getMcpServersWithStatus } from './mcp'
import { modelIdSupportsTools } from '../shared/models'
import type {
  CapabilityActivationInput,
  CapabilityPreflight,
  CapabilityPreflightItem,
  CapabilityTrust,
  ConversationCapabilityProfile,
} from '../shared/types'

export const EMPTY_CAPABILITY_PROFILE: ConversationCapabilityProfile = {
  version: 1,
  skillIds: [],
  mcp: [],
}

type CapabilitySource = 'this-chat' | 'agent' | 'project' | 'global'

function isTrust(value: unknown): value is CapabilityTrust {
  return value === 'auto' || value === 'always-ask' || value === 'block'
}

export function normalizeCapabilityProfile(value: unknown): ConversationCapabilityProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_CAPABILITY_PROFILE }
  const raw = value as Record<string, unknown>
  const mcp = Array.isArray(raw.mcp)
    ? raw.mcp.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const row = entry as Record<string, unknown>
      if (typeof row.serverId !== 'string' || !row.serverId.trim()) return []
      return [{ serverId: row.serverId, trust: isTrust(row.trust) ? row.trust : 'always-ask' }]
    })
    : []
  return {
    version: 1,
    skillIds: Array.isArray(raw.skillIds)
      ? [...new Set(raw.skillIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : [],
    mcp: [...new Map(mcp.map((entry) => [entry.serverId, entry])).values()],
  }
}

export function getConversationCapabilityProfile(db: Database.Database, conversationId: string): ConversationCapabilityProfile {
  const row = db.prepare('SELECT capability_profile_json FROM conversations WHERE id = ?').get(conversationId) as
    | { capability_profile_json?: string | null }
    | undefined
  if (!row) throw new Error('Conversation not found')
  try {
    return normalizeCapabilityProfile(row.capability_profile_json ? JSON.parse(row.capability_profile_json) : null)
  } catch {
    return { ...EMPTY_CAPABILITY_PROFILE }
  }
}

export function setConversationCapabilityProfile(
  db: Database.Database,
  conversationId: string,
  profile: ConversationCapabilityProfile,
): ConversationCapabilityProfile {
  const normalized = normalizeCapabilityProfile(profile)
  const exists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId)
  if (!exists) throw new Error('Conversation not found')
  db.prepare('UPDATE conversations SET capability_profile_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(normalized), Date.now(), conversationId)
  return normalized
}

function mergeTrust(left: CapabilityTrust | undefined, right: CapabilityTrust): CapabilityTrust {
  // A narrower restriction always wins. A chat-level activation must not weaken a
  // project/agent block or turn an always-ask server into silent auto execution.
  if (left === 'block' || right === 'block') return 'block'
  if (left === 'always-ask' || right === 'always-ask') return 'always-ask'
  return 'auto'
}

export function mergeCapabilityProfiles(profiles: ConversationCapabilityProfile[]): ConversationCapabilityProfile {
  const skillIds = [...new Set(profiles.flatMap((profile) => profile.skillIds))]
  const mcp = new Map<string, { serverId: string; trust: CapabilityTrust }>()
  for (const profile of profiles) {
    for (const entry of profile.mcp) {
      const previous = mcp.get(entry.serverId)
      mcp.set(entry.serverId, {
        serverId: entry.serverId,
        trust: mergeTrust(previous?.trust, entry.trust),
      })
    }
  }
  return normalizeCapabilityProfile({ version: 1, skillIds, mcp: [...mcp.values()] })
}

export function getProjectCapabilityProfile(db: Database.Database, projectId: string): ConversationCapabilityProfile {
  const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as { config_json: string | null } | undefined
  if (!row) throw new Error('Project not found')
  try {
    const config = row.config_json ? JSON.parse(row.config_json) as Record<string, unknown> : {}
    return normalizeCapabilityProfile(config.capabilityProfile)
  } catch {
    return { ...EMPTY_CAPABILITY_PROFILE }
  }
}

export function setProjectCapabilityProfile(db: Database.Database, projectId: string, profile: ConversationCapabilityProfile): ConversationCapabilityProfile {
  const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as { config_json: string | null } | undefined
  if (!row) throw new Error('Project not found')
  let config: Record<string, unknown> = {}
  try {
    config = row.config_json ? JSON.parse(row.config_json) as Record<string, unknown> : {}
  } catch { /* repair malformed legacy config while preserving the project */ }
  const normalized = normalizeCapabilityProfile(profile)
  db.prepare('UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify({ ...config, capabilityProfile: normalized }), Date.now(), projectId)
  return normalized
}

function agentCapabilityProfile(db: Database.Database, agentId: string): ConversationCapabilityProfile {
  const row = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId) as { config_json: string } | undefined
  if (!row) throw new Error('Agent not found')
  let config: Record<string, unknown> = {}
  try { config = JSON.parse(row.config_json) as Record<string, unknown> } catch { /* treat as empty */ }
  const serverIds = Array.isArray(config.mcpServers)
    ? config.mcpServers.filter((id): id is string => typeof id === 'string')
    : []
  const trustRows = db.prepare('SELECT server_id, trust FROM agent_mcp_server_trust WHERE agent_id = ?').all(agentId) as { server_id: string; trust: string }[]
  const trustMap = new Map(trustRows.map((row) => [row.server_id, isTrust(row.trust) ? row.trust : 'always-ask' as const]))
  return normalizeCapabilityProfile({
    version: 1,
    skillIds: getSkillConfigsForAgent(agentId).map((skill) => skill.id),
    mcp: serverIds.map((serverId) => ({ serverId, trust: trustMap.get(serverId) ?? 'always-ask' })),
  })
}

function conversationScopeIds(db: Database.Database, conversationId: string): { projectId: string | null; agentId: string | null } {
  const row = db.prepare('SELECT project_id, agent_id FROM conversations WHERE id = ?').get(conversationId) as
    | { project_id: string | null; agent_id: string | null }
    | undefined
  if (!row) throw new Error('Conversation not found')
  return { projectId: row.project_id, agentId: row.agent_id }
}

/** Resolves chat, project, and agent sources into the profile consumed by execution. */
export function getEffectiveCapabilityProfile(db: Database.Database, conversationId: string): ConversationCapabilityProfile {
  const { projectId, agentId } = conversationScopeIds(db, conversationId)
  const profiles = [getConversationCapabilityProfile(db, conversationId)]
  if (projectId) profiles.push(getProjectCapabilityProfile(db, projectId))
  if (agentId) profiles.push(agentCapabilityProfile(db, agentId))
  return mergeCapabilityProfiles(profiles)
}

/**
 * Rejects references that cannot be honoured at execution time. Shared by every writer so a
 * profile persisted from Project Settings is held to the same bar as one activated from a chat.
 */
export function assertCapabilityProfileValid(profile: ConversationCapabilityProfile): void {
  for (const skillId of profile.skillIds) {
    const skill = getSkillConfig(skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)
    if (skill.validationStatus === 'invalid') throw new Error(`Skill is invalid: ${skill.name}`)
  }
  const configuredServers = new Set(getMcpServersWithStatus().map((server) => server.id))
  for (const entry of profile.mcp) {
    if (!configuredServers.has(entry.serverId)) throw new Error(`MCP server not found: ${entry.serverId}`)
  }
}

export function activateConversationCapabilities(
  db: Database.Database,
  conversationId: string,
  input: CapabilityActivationInput,
): ConversationCapabilityProfile {
  getConversationCapabilityProfile(db, conversationId)
  const requestedSkillIds = input.skillIds ?? []
  const requestedMcp = input.mcp ?? []
  const requestedProfile = normalizeCapabilityProfile({
    version: 1,
    skillIds: requestedSkillIds,
    mcp: requestedMcp.map((entry) => ({ serverId: entry.serverId, trust: entry.trust ?? 'always-ask' as const })),
  })
  assertCapabilityProfileValid(requestedProfile)
  const scope = input.scope ?? 'chat'
  if (scope === 'chat') {
    // Chat scope is an explicit override. The submitted checkbox state must be
    // authoritative so Android/WS activation can also remove a capability.
    return setConversationCapabilityProfile(db, conversationId, requestedProfile)
  }

  const scopeIds = conversationScopeIds(db, conversationId)
  const targetId = input.targetId ?? (scope === 'project' ? scopeIds.projectId : scopeIds.agentId)
  if (!targetId) throw new Error(`Choose a ${scope} before activating this capability.`)

  if (scope === 'project') {
    setProjectCapabilityProfile(db, targetId, mergeCapabilityProfiles([getProjectCapabilityProfile(db, targetId), requestedProfile]))
  } else {
    const row = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(targetId) as { config_json: string } | undefined
    if (!row) throw new Error('Agent not found')
    let config: Record<string, unknown> = {}
    try { config = JSON.parse(row.config_json) as Record<string, unknown> } catch { /* repair malformed legacy config */ }
    const existingServers = Array.isArray(config.mcpServers)
      ? config.mcpServers.filter((id): id is string => typeof id === 'string')
      : []
    const nextServers = [...new Set([...existingServers, ...requestedProfile.mcp.map((entry) => entry.serverId)])]
    config.mcpServers = nextServers
    db.prepare('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(config), Date.now(), targetId)
    for (const entry of requestedProfile.mcp) {
      db.prepare('INSERT OR REPLACE INTO agent_mcp_server_trust (agent_id, server_id, trust) VALUES (?, ?, ?)')
        .run(targetId, entry.serverId, entry.trust)
    }
    for (const skillId of requestedProfile.skillIds) setSkillAgentAttachment(targetId, skillId, true)
  }

  // Keep the response scoped to the conversation record. Inherited project/agent entries are
  // exposed by capabilities:resolve; returning them here would make a later "This chat" save
  // accidentally copy every inherited capability into the chat override.
  return getConversationCapabilityProfile(db, conversationId)
}

export function resolveConversationCapabilities(
  db: Database.Database,
  conversationId: string,
  modelId?: string | null,
): CapabilityPreflight {
  const profile = getEffectiveCapabilityProfile(db, conversationId)
  const scopeIds = conversationScopeIds(db, conversationId)
  const chatProfile = getConversationCapabilityProfile(db, conversationId)
  const projectProfile = scopeIds.projectId ? getProjectCapabilityProfile(db, scopeIds.projectId) : EMPTY_CAPABILITY_PROFILE
  const agentProfile = scopeIds.agentId ? agentCapabilityProfile(db, scopeIds.agentId) : EMPTY_CAPABILITY_PROFILE
  const sourceForSkill = new Map<string, CapabilitySource>()
  for (const skillId of agentProfile.skillIds) sourceForSkill.set(skillId, 'agent')
  for (const skillId of projectProfile.skillIds) sourceForSkill.set(skillId, 'project')
  for (const skillId of chatProfile.skillIds) sourceForSkill.set(skillId, 'this-chat')
  const sourceForMcp = new Map<string, CapabilitySource>()
  for (const entry of agentProfile.mcp) sourceForMcp.set(entry.serverId, 'agent')
  for (const entry of projectProfile.mcp) sourceForMcp.set(entry.serverId, 'project')
  for (const entry of chatProfile.mcp) sourceForMcp.set(entry.serverId, 'this-chat')
  const serversById = new Map(getMcpServersWithStatus().map((server) => [server.id, server]))
  const items: CapabilityPreflightItem[] = []
  for (const skillId of profile.skillIds) {
    const skill = getSkillConfig(skillId)
    if (!skill) {
      items.push({ kind: 'skill', id: skillId, label: skillId, status: 'missing', detail: 'Import this skill before using it.', provenance: sourceForSkill.get(skillId) ?? 'global' })
      continue
    }
    if (skill.validationStatus === 'invalid') {
      items.push({ kind: 'skill', id: skillId, label: skill.name, status: 'invalid', detail: 'The skill package failed validation.', provenance: sourceForSkill.get(skillId) ?? 'global' })
      continue
    }
    const required = skill.runtimeRequirements?.browser?.requiredCapabilities ?? []
    if (required.length > 0) {
      const browserConfigured = profile.mcp.some((entry) => {
        const server = serversById.get(entry.serverId)
        return entry.trust !== 'block' && Boolean(server && /playwright|chromium|browser/i.test(`${server.id} ${server.name}`))
      })
      items.push({
        kind: 'skill',
        id: skillId,
        label: skill.name,
        status: browserConfigured ? 'ready' : 'missing',
        detail: browserConfigured
          ? 'Skill imported; browser capability requirements are listed below.'
          : 'Skill is imported, but it needs a browser capability such as Playwright (Chromium).',
        provenance: sourceForSkill.get(skillId) ?? 'global',
        requiredCapabilities: required,
      })
    } else {
      items.push({ kind: 'skill', id: skillId, label: skill.name, status: 'ready', detail: 'Skill imported and validated.', provenance: sourceForSkill.get(skillId) ?? 'global' })
    }
  }
  for (const entry of profile.mcp) {
    const server = serversById.get(entry.serverId)
    if (!server) {
      items.push({ kind: 'mcp', id: entry.serverId, label: entry.serverId, status: 'missing', detail: 'Add this MCP server in the MCP workspace.', provenance: sourceForMcp.get(entry.serverId) ?? 'global' })
      continue
    }
    const status = server.status === 'connected' && server.toolCount > 0 ? 'ready'
      : server.status === 'error' ? 'invalid'
        : 'disconnected'
    items.push({ kind: 'mcp', id: entry.serverId, label: server.name, status, detail: status === 'ready' ? `${server.toolCount} tools available; trust is ${entry.trust}.` : server.error ?? 'Connect this MCP server before using it.', provenance: sourceForMcp.get(entry.serverId) ?? 'global' })
  }
  if (profile.mcp.length > 0) {
    const row = db.prepare('SELECT model FROM conversations WHERE id = ?').get(conversationId) as { model: string | null } | undefined
    const selectedModel = modelId ?? row?.model ?? null
    items.push({
      kind: 'model',
      id: selectedModel ?? 'default',
      label: selectedModel ?? 'Current model',
      status: modelIdSupportsTools(selectedModel) ? 'ready' : 'unsupported',
      detail: modelIdSupportsTools(selectedModel) ? 'This model can use tools.' : 'Choose a tool-capable model for MCP capabilities.',
      provenance: 'global',
    })
  }
  return {
    conversationId,
    profile,
    scopeProfiles: {
      chat: chatProfile,
      project: scopeIds.projectId ? projectProfile : null,
      agent: scopeIds.agentId ? agentProfile : null,
    },
    items,
    ready: items.every((item) => item.status === 'ready'),
    desktopOnly: profile.mcp.length > 0,
  }
}

export function getConversationMcpServerIds(db: Database.Database, conversationId: string): string[] {
  return getEffectiveCapabilityProfile(db, conversationId).mcp
    .filter((entry) => entry.trust !== 'block')
    .map((entry) => entry.serverId)
}
