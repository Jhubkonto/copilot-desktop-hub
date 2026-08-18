import { randomUUID } from 'crypto'
import { BrowserWindow, dialog } from 'electron'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import { parseSkillMarkdown } from './skill-markdown'
import {
  applySkillPackageFiles,
  deleteManagedSkillPackage,
  duplicateSkillPackage,
  exportSkillPackage,
  importSkillPackage,
  loadSkillPackage,
  packageRootFromImport,
  skillForTransport,
  skillEntryMarkdown,
  writeManagedSkillPackage,
} from './skill-packages'
import {
  discoverSkillPackages,
  importDiscoveredSkill,
  projectSkillDiscoveryRoots,
  userSkillDiscoveryRoots,
} from './skill-discovery'
import type { DiscoveredSkill, SkillConfig, SkillPackageFile, ToolConfig } from '../shared/types'

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
    packagePath: typeof input.packagePath === 'string' ? input.packagePath : undefined,
    contentHash: typeof input.contentHash === 'string' ? input.contentHash : undefined,
    scope: input.scope === 'project' || input.scope === 'bundled' ? input.scope : 'user',
    source: input.source === 'filesystem' || input.source === 'codex' || input.source === 'claude' || input.source === 'hermes' || input.source === 'import'
      ? input.source
      : 'nexy',
    validationStatus: input.validationStatus === 'invalid' || input.validationStatus === 'warning' ? input.validationStatus : 'valid',
    frontmatter: input.frontmatter && typeof input.frontmatter === 'object' && !Array.isArray(input.frontmatter)
      ? input.frontmatter as Record<string, unknown>
      : undefined,
    created_at: typeof input.created_at === 'number' ? input.created_at : undefined,
    updated_at: typeof input.updated_at === 'number' ? input.updated_at : undefined,
  }
}

export function rowToSkill(row: SkillRow): SkillConfig {
  const parsed = normalizeSkillConfig(JSON.parse(row.config_json) as Record<string, unknown>)
  let packageConfig: Partial<SkillConfig> = {}
  if (parsed.packagePath && existsSync(parsed.packagePath)) {
    try {
      packageConfig = loadSkillPackage(parsed.packagePath)
    } catch {
      packageConfig = { validationStatus: 'invalid' }
    }
  }
  return {
    ...normalizeSkillConfig({ ...parsed, ...packageConfig, id: row.id }),
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

export function createSkillConfig(input: Partial<SkillConfig>, packageSourcePath?: string): SkillConfig {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  const normalized = normalizeSkillConfig({ ...input, packagePath: undefined, id, created_at: now, updated_at: now })
  let config = packageSourcePath
    ? importSkillPackage(packageSourcePath, normalized)
    : writeManagedSkillPackage(normalized)
  if (!packageSourcePath && Array.isArray(input.packageFiles) && config.packagePath) {
    applySkillPackageFiles(config.packagePath, input.packageFiles as SkillPackageFile[])
    config = writeManagedSkillPackage(normalized, config.packagePath)
  }
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
  const normalized = normalizeSkillConfig({ ...(previous ?? {}), ...input, id, updated_at: now, created_at: previous?.created_at ?? now })
  let config = writeManagedSkillPackage(normalized, previous?.packagePath)
  if (Array.isArray(input.packageFiles) && config.packagePath) {
    applySkillPackageFiles(config.packagePath, input.packageFiles as SkillPackageFile[])
    config = writeManagedSkillPackage(normalized, config.packagePath)
  }
  db.prepare('UPDATE skills SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(config), now, id)
  return config
}

export function upsertSyncedSkillConfig(
  id: string,
  input: Partial<SkillConfig>,
  createdAt: number,
  updatedAt: number,
): SkillConfig {
  const db = getDatabase()
  const existing = db.prepare('SELECT id FROM skills WHERE id = ?').get(id)
  if (existing) {
    const skill = updateSkillConfig(id, input)
    db.prepare('UPDATE skills SET updated_at = ? WHERE id = ?').run(updatedAt, id)
    return { ...skill, updated_at: updatedAt }
  }
  const normalized = normalizeSkillConfig({ ...input, id, created_at: createdAt, updated_at: updatedAt, packagePath: undefined })
  let config = writeManagedSkillPackage(normalized)
  if (Array.isArray(input.packageFiles) && config.packagePath) {
    applySkillPackageFiles(config.packagePath, input.packageFiles as SkillPackageFile[])
    config = writeManagedSkillPackage(normalized, config.packagePath)
  }
  db.prepare('INSERT INTO skills (id, config_json, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id, JSON.stringify(config), createdAt, updatedAt,
  )
  return config
}

export function listSkillConfigsForTransport(): SkillConfig[] {
  return listSkillConfigs().map(skillForTransport)
}

export function getSkillConfigForTransport(id: string): SkillConfig | null {
  const skill = getSkillConfig(id)
  return skill ? skillForTransport(skill) : null
}

export function deleteSkillConfig(id: string): boolean {
  const skill = getSkillConfig(id)
  getDatabase().prepare('DELETE FROM skills WHERE id = ?').run(id)
  deleteManagedSkillPackage(skill?.packagePath)
  return true
}

export function duplicateSkillConfig(id: string): SkillConfig | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined
  if (!row) return null
  const source = rowToSkill(row)
  const now = Date.now()
  const newId = randomUUID()
  const normalized = normalizeSkillConfig({
    ...source,
    id: newId,
    name: `${source.name} (copy)`,
    packagePath: undefined,
    contentHash: undefined,
    created_at: now,
    updated_at: now,
  })
  const config = duplicateSkillPackage(source.packagePath, normalized)
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

/** Attachment now controls availability only. It never grants tools or injects instructions. */
export function applySkillsToAgentConfig(agentId: string, baseConfig: Record<string, unknown>): Record<string, unknown> {
  void agentId
  return baseConfig
}

/** Resolves the enabled on-disk source roots for a project, used for project-scoped skill discovery. */
function projectSourceRoots(projectId: string): string[] {
  if (!projectId.trim()) return []
  const rows = getDatabase()
    .prepare('SELECT local_path FROM project_sources WHERE project_id = ? AND enabled = 1')
    .all(projectId) as { local_path: string }[]
  return rows.map((r) => r.local_path).filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
}

/** Scans standard filesystem locations for skill packages not yet in the managed library. */
export async function discoverSkills(projectId = ''): Promise<DiscoveredSkill[]> {
  const knownHashes = new Set(
    listSkillConfigs().map((s) => s.contentHash).filter((h): h is string => typeof h === 'string'),
  )
  const roots = [...await userSkillDiscoveryRoots(), ...projectSkillDiscoveryRoots(projectSourceRoots(projectId))]
  return discoverSkillPackages(roots, knownHashes)
}

export function registerSkillHandlers(): void {
  const db = getDatabase()

  safeHandle('skill:list', () => listSkillConfigsForTransport())

  safeHandle('skill:get', (_event, id: string) => getSkillConfigForTransport(id))

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
    await writeFile(result.filePath, JSON.stringify(skillForTransport(skill), null, 2), 'utf-8')
    return true
  })

  safeHandle('skill:export-md', async (_event, id: string) => {
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined
    if (!row) return false
    const skill = rowToSkill(row)
    const win = BrowserWindow.getAllWindows()[0]
    if (skill.packagePath && existsSync(skill.packagePath)) {
      const result = await dialog.showOpenDialog(win, {
        title: 'Choose where to export the skill package',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return false
      exportSkillPackage(skill.packagePath, result.filePaths[0])
      return true
    }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${skill.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.SKILL.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, skillEntryMarkdown(skill), 'utf-8')
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
      const packageRoot = isMarkdown ? packageRootFromImport(filePath) : null
      return createSkillConfig(parsed, packageRoot ?? undefined)
    } catch {
      return null
    }
  })

  safeHandle('skill:discover', async (_event, projectId?: string) => discoverSkills(typeof projectId === 'string' ? projectId : ''))

  safeHandle('skill:import-discovered', (_event, discovery: DiscoveredSkill) => {
    if (!discovery || typeof discovery.packagePath !== 'string') return null
    if (!existsSync(discovery.packagePath)) return null
    return importDiscoveredSkill(discovery, {})
  })

  safeHandle('skill:get-agent-links', (_event, agentId: string) => getSkillAgentLinks(agentId))

  safeHandle('skill:attach-to-agent', (_event, agentId: string, skillId: string, attach: boolean) => setSkillAgentAttachment(agentId, skillId, attach))

  safeHandle('skill:reorder-for-agent', (_event, agentId: string, skillIds: string[]) => reorderSkillsForAgent(agentId, skillIds))

  safeHandle('skill:get-agent-usage', () => getSkillAgentUsage())
}
