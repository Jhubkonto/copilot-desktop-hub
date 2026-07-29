import { randomUUID } from 'crypto'
import { BrowserWindow, dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import { parseSkillMarkdown, skillToMarkdown } from './skill-markdown'
import type { AgentConfig, SkillConfig, ToolConfig } from '../shared/types'

interface SkillRow {
  id: string
  config_json: string
  created_at: number
  updated_at: number
}

const DEFAULT_TOOL: ToolConfig = { enabled: false, approval: 'always-ask', instructions: '' }

function normaliseToolConfig(raw: unknown): ToolConfig {
  if (typeof raw === 'boolean') return { ...DEFAULT_TOOL, enabled: raw }
  const r = (raw ?? {}) as Partial<ToolConfig>
  return {
    enabled: r.enabled === true,
    approval: r.approval === 'auto' || r.approval === 'disabled' ? r.approval : 'always-ask',
    instructions: typeof r.instructions === 'string' ? r.instructions : '',
  }
}

export function normalizeSkillConfig(input: Partial<SkillConfig> & Record<string, unknown>): SkillConfig {
  const tools = (input.tools && typeof input.tools === 'object' ? input.tools : {}) as Record<string, unknown>
  return {
    id: typeof input.id === 'string' ? input.id : '',
    name: String(input.name || 'New Skill').trim().slice(0, 100),
    icon: typeof input.icon === 'string' && input.icon.trim() ? input.icon.trim().slice(0, 8) : '✨',
    description: typeof input.description === 'string' ? input.description : '',
    instructions: typeof input.instructions === 'string' ? input.instructions : '',
    tags: Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === 'string') : [],
    tools: {
      fileEdit: normaliseToolConfig(tools.fileEdit),
      terminal: normaliseToolConfig(tools.terminal),
      webFetch: normaliseToolConfig(tools.webFetch),
    },
    mcpServers: Array.isArray(input.mcpServers)
      ? input.mcpServers.filter((id): id is string => typeof id === 'string')
      : [],
    mcpToolOverrides: Array.isArray(input.mcpToolOverrides) ? input.mcpToolOverrides as SkillConfig['mcpToolOverrides'] : [],
    mcpServerTrust: Array.isArray(input.mcpServerTrust) ? input.mcpServerTrust as SkillConfig['mcpServerTrust'] : [],
    knowledge: Array.isArray(input.knowledge) ? input.knowledge as SkillConfig['knowledge'] : [],
    created_at: typeof input.created_at === 'number' ? input.created_at : undefined,
    updated_at: typeof input.updated_at === 'number' ? input.updated_at : undefined,
  }
}

export function rowToSkill(row: SkillRow): SkillConfig {
  const parsed = normalizeSkillConfig(JSON.parse(row.config_json) as Record<string, unknown>)
  return {
    ...parsed,
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function listSkillConfigs(): SkillConfig[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM skills ORDER BY created_at ASC').all() as SkillRow[]
  return rows.map(rowToSkill)
}

export function getSkillConfig(id: string): SkillConfig | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined
  return row ? rowToSkill(row) : null
}

export function createSkillConfig(input: Partial<SkillConfig>): SkillConfig {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  const config = normalizeSkillConfig({ ...input, id, created_at: now, updated_at: now })
  db.prepare('INSERT INTO skills (id, config_json, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    JSON.stringify(config),
    now,
    now,
  )
  return config
}

export function findSkillConfigByName(name: string): SkillConfig | null {
  const target = name.trim().toLowerCase()
  if (!target) return null
  return listSkillConfigs().find((s) => s.name.trim().toLowerCase() === target) ?? null
}

/**
 * Creates a skill, or updates the existing skill with the same (case-insensitive) name.
 * Used by model-driven skill capture (`save_skill`) so re-saving a skill updates it in place
 * rather than piling up duplicates. Returns whether a new row was created.
 */
export function upsertSkillConfigByName(input: Partial<SkillConfig>): { skill: SkillConfig; created: boolean } {
  const name = String(input.name ?? '').trim()
  const existing = name ? findSkillConfigByName(name) : null
  if (existing) {
    return { skill: updateSkillConfig(existing.id, input), created: false }
  }
  return { skill: createSkillConfig(input), created: true }
}

export function updateSkillConfig(id: string, input: Partial<SkillConfig>): SkillConfig {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined
  const now = Date.now()
  const previous = row ? rowToSkill(row) : null
  const config = normalizeSkillConfig({ ...(previous ?? {}), ...input, id, updated_at: now, created_at: previous?.created_at ?? now })
  db.prepare('UPDATE skills SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(config), now, id)
  return config
}

export function deleteSkillConfig(id: string): boolean {
  getDatabase().prepare('DELETE FROM skills WHERE id = ?').run(id)
  return true
}

export function duplicateSkillConfig(id: string): SkillConfig | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined
  if (!row) return null
  const source = rowToSkill(row)
  const now = Date.now()
  const newId = randomUUID()
  const config = normalizeSkillConfig({ ...source, id: newId, name: `${source.name} (copy)`, created_at: now, updated_at: now })
  db.prepare('INSERT INTO skills (id, config_json, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    newId,
    JSON.stringify(config),
    now,
    now,
  )
  return config
}

export function getSkillAgentLinks(agentId: string): { skill_id: string; sort_order: number }[] {
  return getDatabase()
    .prepare('SELECT skill_id, sort_order FROM agent_skills WHERE agent_id = ? ORDER BY sort_order ASC, attached_at ASC')
    .all(agentId) as { skill_id: string; sort_order: number }[]
}

export function setSkillAgentAttachment(agentId: string, skillId: string, attach: boolean): boolean {
  const db = getDatabase()
  if (!attach) {
    db.prepare('DELETE FROM agent_skills WHERE agent_id = ? AND skill_id = ?').run(agentId, skillId)
    return true
  }
  const maxRow = db.prepare('SELECT MAX(sort_order) as m FROM agent_skills WHERE agent_id = ?').get(agentId) as { m: number | null }
  db.prepare('INSERT OR REPLACE INTO agent_skills (agent_id, skill_id, sort_order, attached_at) VALUES (?, ?, ?, ?)')
    .run(agentId, skillId, (maxRow.m ?? -1) + 1, Date.now())
  return true
}

export function reorderSkillsForAgent(agentId: string, skillIds: string[]): boolean {
  const db = getDatabase()
  const update = db.prepare('UPDATE agent_skills SET sort_order = ? WHERE agent_id = ? AND skill_id = ?')
  const tx = db.transaction((ids: string[]) => {
    ids.forEach((skillId, index) => update.run(index, agentId, skillId))
  })
  tx(skillIds)
  return true
}

export function getSkillAgentUsage(): { skill_id: string; agent_count: number }[] {
  return getDatabase().prepare(`
    SELECT skill_id, COUNT(*) as agent_count
    FROM agent_skills
    GROUP BY skill_id
  `).all() as { skill_id: string; agent_count: number }[]
}

export function getSkillConfigsForAgent(agentId: string): SkillConfig[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT s.*
    FROM agent_skills ask
    JOIN skills s ON s.id = ask.skill_id
    WHERE ask.agent_id = ?
    ORDER BY ask.sort_order ASC, ask.attached_at ASC
  `).all(agentId) as SkillRow[]
  return rows.map(rowToSkill)
}

function mergeToolConfig(base: ToolConfig, skill: ToolConfig): ToolConfig {
  if (!skill.enabled && !skill.instructions.trim()) return base
  const enabled = base.enabled || skill.enabled
  const approval = enabled && base.approval === 'disabled' && skill.enabled
    ? skill.approval === 'disabled' ? 'always-ask' : skill.approval
    : base.enabled ? base.approval : skill.approval
  return {
    enabled,
    approval: enabled && approval === 'disabled' ? 'always-ask' : approval,
    instructions: [skill.instructions, base.instructions].filter((v) => v.trim()).join('\n\n'),
  }
}

export function applySkillsToAgentConfig(agentId: string, baseConfig: Record<string, unknown>): Record<string, unknown> {
  const skills = getSkillConfigsForAgent(agentId)
  if (skills.length === 0) return baseConfig

  const config = { ...baseConfig } as unknown as AgentConfig
  const tools = config.tools ?? {
    fileEdit: { ...DEFAULT_TOOL },
    terminal: { ...DEFAULT_TOOL },
    webFetch: { ...DEFAULT_TOOL },
  }

  config.tools = {
    fileEdit: mergeToolConfig(tools.fileEdit, skills.reduce((acc, skill) => mergeToolConfig(acc, skill.tools.fileEdit), { ...DEFAULT_TOOL })),
    terminal: mergeToolConfig(tools.terminal, skills.reduce((acc, skill) => mergeToolConfig(acc, skill.tools.terminal), { ...DEFAULT_TOOL })),
    webFetch: mergeToolConfig(tools.webFetch, skills.reduce((acc, skill) => mergeToolConfig(acc, skill.tools.webFetch), { ...DEFAULT_TOOL })),
  }

  const skillInstructions = skills
    .filter((skill) => skill.instructions.trim() || skill.knowledge.length > 0)
    .map((skill) => {
      const knowledge = skill.knowledge.length > 0
        ? `\n\nKnowledge:\n${skill.knowledge.map((item) => `- ${item.title}: ${item.content}`).join('\n')}`
        : ''
      return `## ${skill.icon} ${skill.name}\n${skill.instructions.trim()}${knowledge}`.trim()
    })
    .join('\n\n')

  if (skillInstructions) {
    config.systemPrompt = [config.systemPrompt, `Attached skills:\n\n${skillInstructions}`]
      .filter((v) => typeof v === 'string' && v.trim())
      .join('\n\n')
  }

  config.mcpServers = Array.from(new Set([...(config.mcpServers ?? []), ...skills.flatMap((skill) => skill.mcpServers)]))
  return config as unknown as Record<string, unknown>
}

export function registerSkillHandlers(): void {
  const db = getDatabase()

  safeHandle('skill:list', () => listSkillConfigs())

  safeHandle('skill:get', (_event, id: string) => getSkillConfig(id))

  safeHandle('skill:create', (_event, input: Partial<SkillConfig>) => createSkillConfig(input))

  safeHandle('skill:update', (_event, id: string, input: Partial<SkillConfig>) => updateSkillConfig(id, input))

  safeHandle('skill:delete', (_event, id: string) => deleteSkillConfig(id))

  safeHandle('skill:duplicate', (_event, id: string) => duplicateSkillConfig(id))

  safeHandle('skill:export', async (_event, id: string) => {
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined
    if (!row) return false
    const skill = rowToSkill(row)
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${skill.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.skill.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, JSON.stringify(skill, null, 2), 'utf-8')
    return true
  })

  safeHandle('skill:export-md', async (_event, id: string) => {
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined
    if (!row) return false
    const skill = rowToSkill(row)
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${skill.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.SKILL.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, skillToMarkdown(skill), 'utf-8')
    return true
  })

  safeHandle('skill:import', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Skill', extensions: ['json', 'md'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Markdown', extensions: ['md'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const filePath = result.filePaths[0]
      const content = await readFile(filePath, 'utf-8')
      // Route by extension, with a content sniff fallback: a `.md`/SKILL.md file (or any file
      // whose content is not JSON) is parsed via the SKILL.md codec; otherwise treat it as JSON.
      const isMarkdown = /\.md$/i.test(filePath) || !content.trimStart().startsWith('{')
      const parsed = isMarkdown
        ? parseSkillMarkdown(content)
        : (JSON.parse(content) as Record<string, unknown>)
      return createSkillConfig(parsed)
    } catch {
      return null
    }
  })

  safeHandle('skill:get-agent-links', (_event, agentId: string) => getSkillAgentLinks(agentId))

  safeHandle('skill:attach-to-agent', (_event, agentId: string, skillId: string, attach: boolean) => setSkillAgentAttachment(agentId, skillId, attach))

  safeHandle('skill:reorder-for-agent', (_event, agentId: string, skillIds: string[]) => reorderSkillsForAgent(agentId, skillIds))

  safeHandle('skill:get-agent-usage', () => getSkillAgentUsage())
}
