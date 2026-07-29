import type { SkillBuiltinToolConfig, SkillConfig } from '../shared/types'

/**
 * Bidirectional codec between Nexy's internal `SkillConfig` and the cross-provider
 * Agent-Skill `SKILL.md` interchange format (YAML-ish frontmatter + Markdown body).
 *
 * The standard frontmatter keys (`name`, `description`, `allowed-tools`) are what other
 * LLM ecosystems have converged on, so an externally-authored `SKILL.md` imports cleanly.
 * Nexy-specific fields that have no standard equivalent ride as namespaced `x-nexy-*`
 * frontmatter keys, so a Nexy skill round-trips losslessly and standard parsers ignore them.
 */

const FRONTMATTER_FENCE = '---'

type ToolBucket = 'fileEdit' | 'terminal' | 'webFetch'

// Representative, industry-recognisable tool names emitted per enabled bucket. On import,
// any name is matched back to a bucket by case-insensitive substring (see TOOL_NAME_MATCHERS).
const BUCKET_EXPORT_NAMES: Record<ToolBucket, string[]> = {
  fileEdit: ['Read', 'Write', 'Edit'],
  terminal: ['Bash'],
  webFetch: ['WebFetch'],
}

const TOOL_NAME_MATCHERS: { bucket: ToolBucket; needles: string[] }[] = [
  { bucket: 'fileEdit', needles: ['read', 'write', 'edit', 'file'] },
  { bucket: 'terminal', needles: ['bash', 'terminal', 'shell', 'exec', 'command'] },
  { bucket: 'webFetch', needles: ['fetch', 'web', 'http', 'url'] },
]

function matchToolBucket(name: string): ToolBucket | null {
  const lower = name.toLowerCase()
  for (const { bucket, needles } of TOOL_NAME_MATCHERS) {
    if (needles.some((n) => lower.includes(n))) return bucket
  }
  return null
}

// ── Minimal frontmatter value (de)serialisation ─────────────────────────────
// Values are serialised as JSON when they are arrays/objects and as bare strings
// otherwise, so the parser can rely on JSON.parse for the structured cases and fall
// back to a quote-stripped scalar for everything else. This keeps the format flat
// (one `key: value` per line) while still round-tripping arrays and the tools object.

function serialiseValue(value: unknown): string {
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value)
  }
  const str = String(value)
  // JSON strings are valid YAML scalars. Quote values that YAML could reinterpret or truncate.
  if (
    /^[[{]|^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(str) ||
    /[:#\n\r]/.test(str) ||
    str !== str.trim()
  ) return JSON.stringify(str)
  return str
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  if (/^[[{"]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // Tolerate a loose inline array like [a, b, c] (unquoted items).
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return trimmed
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
      return trimmed.replace(/^"|"$/g, '')
    }
  }
  return trimmed
}

interface ParsedMarkdown {
  frontmatter: Record<string, unknown>
  body: string
}

/**
 * Splits a `SKILL.md` document into its frontmatter map and Markdown body. Tolerant of a
 * missing frontmatter block (whole document becomes the body) and of a model wrapping the
 * document in surrounding prose or a fenced code block.
 */
export function splitFrontmatter(md: string): ParsedMarkdown {
  const text = stripCodeFence(md).replace(/\r\n/g, '\n')
  const lines = text.split('\n')

  // Find the opening fence (first non-empty line must be `---`).
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (lines[i]?.trim() !== FRONTMATTER_FENCE) {
    return { frontmatter: {}, body: text.trim() }
  }

  const frontmatter: Record<string, unknown> = {}
  let closed = false
  let j = i + 1
  for (; j < lines.length; j++) {
    if (lines[j].trim() === FRONTMATTER_FENCE) {
      closed = true
      break
    }
    const line = lines[j]
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (!key) continue
    const rawValue = line.slice(colon + 1)
    if (rawValue.trim() === '') {
      const list: string[] = []
      while (j + 1 < lines.length) {
        const item = lines[j + 1].match(/^\s+-\s+(.+?)\s*$/)
        if (!item) break
        list.push(String(parseValue(item[1])))
        j++
      }
      frontmatter[key] = list
    } else {
      frontmatter[key] = parseValue(rawValue)
    }
  }

  if (!closed) return { frontmatter: {}, body: text.trim() }
  const body = lines.slice(j + 1).join('\n').trim()
  return { frontmatter, body }
}

/** If the document is wrapped in a ```markdown fenced block, unwrap the last such block. */
function stripCodeFence(md: string): string {
  const fenceMatch = md.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/gi)
  if (!fenceMatch || fenceMatch.length === 0) return md
  const last = fenceMatch[fenceMatch.length - 1]
  const inner = last.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/```\s*$/, '')
  // Only treat it as a wrapper if the inner content itself looks like a SKILL.md doc.
  return inner.trimStart().startsWith(FRONTMATTER_FENCE) ? inner : md
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function allowedToolNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value !== 'string') return []
  const names: string[] = []
  let current = ''
  let depth = 0
  for (const char of value.trim()) {
    if (/\s/.test(char) && depth === 0) {
      if (current) names.push(current)
      current = ''
      continue
    }
    current += char
    if (char === '(') depth++
    else if (char === ')' && depth > 0) depth--
  }
  if (current) names.push(current)
  return names
}

// ── Knowledge section (readable Markdown body form) ─────────────────────────
const KNOWLEDGE_HEADING = '## Knowledge'

function extractKnowledgeSection(body: string): { body: string; knowledge: { title: string; content: string }[] } {
  const idx = body.indexOf(KNOWLEDGE_HEADING)
  if (idx === -1) return { body, knowledge: [] }
  const before = body.slice(0, idx).trim()
  const section = body.slice(idx + KNOWLEDGE_HEADING.length)
  const knowledge: { title: string; content: string }[] = []
  // Each entry is a `### Title` heading followed by its content up to the next `###`.
  const parts = section.split(/\n(?=### )/)
  for (const part of parts) {
    const m = part.match(/^\s*###\s+(.*)\n?([\s\S]*)$/)
    if (m) {
      const title = m[1].trim()
      const content = m[2].trim()
      if (title) knowledge.push({ title, content })
    }
  }
  return { body: before, knowledge }
}

/**
 * Parses an externally- or Nexy-authored `SKILL.md` into a partial `SkillConfig`.
 * `x-nexy-tools` (full tool config) takes precedence over `allowed-tools` when present;
 * otherwise tool buckets are enabled best-effort from `allowed-tools` names and default
 * to disabled — an imported skill never silently grants a tool it didn't clearly request.
 */
export function parseSkillMarkdown(md: string): Partial<SkillConfig> {
  const { frontmatter, body } = splitFrontmatter(md)
  const fm = frontmatter

  const { body: instructions, knowledge: bodyKnowledge } = extractKnowledgeSection(body)

  const result: Partial<SkillConfig> = {}
  const displayName = fm['x-nexy-display-name'] ?? fm.name
  if (typeof displayName === 'string' && displayName.trim()) result.name = displayName.trim()
  if (typeof fm.description === 'string') result.description = fm.description
  if (instructions) result.instructions = instructions

  const icon = fm['x-nexy-icon'] ?? fm.icon
  if (typeof icon === 'string' && icon.trim()) result.icon = icon.trim()

  const tags = asStringArray(fm['x-nexy-tags'] ?? fm.tags)
  if (tags.length) result.tags = tags

  const mcpServers = asStringArray(fm['x-nexy-mcp-servers'] ?? fm['mcp-servers'])
  if (mcpServers.length) result.mcpServers = mcpServers

  // Tools: prefer the lossless x-nexy-tools blob, else derive from allowed-tools.
  const xTools = fm['x-nexy-tools']
  if (xTools && typeof xTools === 'object' && !Array.isArray(xTools)) {
    result.tools = normaliseToolsBlob(xTools as Record<string, unknown>)
  } else {
    const allowed = allowedToolNames(fm['allowed-tools'] ?? fm.allowedTools ?? fm.tools)
    if (allowed.length) result.tools = toolsFromAllowedNames(allowed)
  }

  const knowledge = bodyKnowledge.length ? bodyKnowledge : parseKnowledgeBlob(fm['x-nexy-knowledge'])
  if (knowledge.length) result.knowledge = knowledge

  return result
}

function toolBucket(enabled: boolean, prev?: Partial<SkillBuiltinToolConfig>): SkillBuiltinToolConfig {
  return {
    enabled,
    approval: prev?.approval === 'auto' || prev?.approval === 'disabled' ? prev.approval : 'always-ask',
    instructions: typeof prev?.instructions === 'string' ? prev.instructions : '',
  }
}

function toolsFromAllowedNames(names: string[]): SkillConfig['tools'] {
  const enabled: Record<ToolBucket, boolean> = { fileEdit: false, terminal: false, webFetch: false }
  for (const name of names) {
    const bucket = matchToolBucket(name)
    if (bucket) enabled[bucket] = true
  }
  return {
    fileEdit: toolBucket(enabled.fileEdit),
    terminal: toolBucket(enabled.terminal),
    webFetch: toolBucket(enabled.webFetch),
  }
}

function normaliseToolsBlob(blob: Record<string, unknown>): SkillConfig['tools'] {
  const pick = (key: ToolBucket): SkillBuiltinToolConfig => {
    const raw = (blob[key] ?? {}) as Partial<SkillBuiltinToolConfig>
    return toolBucket(raw.enabled === true, raw)
  }
  return { fileEdit: pick('fileEdit'), terminal: pick('terminal'), webFetch: pick('webFetch') }
}

function parseKnowledgeBlob(value: unknown): { title: string; content: string }[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (v): v is { title: string; content: string } =>
      typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).title === 'string' && typeof (v as Record<string, unknown>).content === 'string',
  )
}

function toolsAreDefault(tools: SkillConfig['tools']): boolean {
  return (['fileEdit', 'terminal', 'webFetch'] as ToolBucket[]).every((k) => {
    const t = tools[k]
    return !t.enabled && t.approval === 'always-ask' && !t.instructions.trim()
  })
}

function allowedToolsFrom(tools: SkillConfig['tools']): string[] {
  const names: string[] = []
  for (const bucket of ['fileEdit', 'terminal', 'webFetch'] as ToolBucket[]) {
    // In Claude Code, allowed-tools means pre-approved, not merely enabled. Export only
    // Nexy tools that carry the same auto-approval semantics.
    if (tools[bucket].enabled && tools[bucket].approval === 'auto') {
      names.push(...BUCKET_EXPORT_NAMES[bucket])
    }
  }
  return names
}

function portableSkillName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  const withoutReservedWords = slug
    .replace(/(^|-)(?:anthropic|claude)(?=-|$)/g, '$1assistant')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return withoutReservedWords || 'nexy-skill'
}

/**
 * Serialises a `SkillConfig` to a portable `SKILL.md` document. Standard frontmatter keys
 * first, then `x-nexy-*` extensions for Nexy-specific fields, then the Markdown instructions
 * body, then a `## Knowledge` section. Round-trips losslessly through `parseSkillMarkdown`.
 */
export function skillToMarkdown(config: SkillConfig): string {
  const lines: string[] = [FRONTMATTER_FENCE]

  const portableName = portableSkillName(config.name)
  lines.push(`name: ${serialiseValue(portableName)}`)
  lines.push(`description: ${serialiseValue(
    config.description.trim() ||
    `Reusable guidance for ${config.name}. Use when the task matches this skill's instructions.`,
  )}`)

  const allowed = allowedToolsFrom(config.tools)
  if (allowed.length) lines.push(`allowed-tools: ${serialiseValue(allowed)}`)

  // x-nexy extensions.
  if (config.name !== portableName) lines.push(`x-nexy-display-name: ${serialiseValue(config.name)}`)
  if (config.icon) lines.push(`x-nexy-icon: ${serialiseValue(config.icon)}`)
  if (config.tags.length) lines.push(`x-nexy-tags: ${serialiseValue(config.tags)}`)
  if (config.mcpServers.length) lines.push(`x-nexy-mcp-servers: ${serialiseValue(config.mcpServers)}`)
  // Emit the full tool config only when it carries information beyond the derived allowed-tools
  // (a non-default approval or per-tool instructions), so simple skills stay clean.
  if (!toolsAreDefault(config.tools)) lines.push(`x-nexy-tools: ${serialiseValue(config.tools)}`)

  lines.push(FRONTMATTER_FENCE, '')

  if (config.instructions.trim()) lines.push(config.instructions.trim(), '')

  if (config.knowledge.length) {
    lines.push(KNOWLEDGE_HEADING, '')
    for (const entry of config.knowledge) {
      lines.push(`### ${entry.title}`, '', entry.content.trim(), '')
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
