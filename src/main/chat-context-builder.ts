import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs'
import { basename, relative, resolve, isAbsolute } from 'path'
import { spawn } from 'child_process'
import { nativeImage } from 'electron'
import type { WebContents } from 'electron'
import type { Database } from 'better-sqlite3'
import { getAgentConfig } from './agents'
import { listDirectoryEntries } from './file-handlers'
import { parseProjectConfig } from './project-handlers'
import { getRelevantWikiEntries, formatWikiSection } from './wiki-context'
import { insertWikiEntry } from './wiki-handlers'
import { requestApproval } from './tools'
import { inferProjectAuditTarget, recordProjectAuditChange } from './project-audit'
import { computeLineDiff } from './remote-edit/fix-agent'
import { getSkillConfigsForAgent } from './skills'
import { extractKeywords } from './rating-handlers'
import { findSimilarRatedStrategies } from './rating-retrieval'
import type { ToolDefinition } from './provider-types'
import { debugLog } from './debug-mode'
import { NEXY_HELP_CONTENT } from './nexy-help'

export type InlineHandler = (
  args: Record<string, unknown>
) => Promise<{ success: boolean; result?: string; error?: string }>

export type MobileChatActivity =
  | { state: 'thinking'; label: string }
  | { state: 'tool'; label: string; toolName?: string; serverName?: string }
  | { state: 'approval'; label: string; toolName?: string }
  | { state: 'complete'; label: string }
  | { state: 'error'; label: string }

export type ChatContextOptions = {
  attachments?: { id: string; name: string; path: string; size: number }[]
  images?: { id: string; name: string; dataUrl: string }[]
  agentId?: string
  projectId?: string
  conversationModel?: string
  fullAutoApprove?: boolean
  terminalSandboxBypass?: boolean
}

export type BuiltContext = {
  augmentedContent: string
  attachedImages: { id: string; name: string; dataUrl: string }[]
  injectedRootDirectory: string | null
  wikiProjectId: string | null
  wikiToolDefs: ToolDefinition[]
  wikiInlineHandlers: Map<string, InlineHandler>
  fileToolDefs: ToolDefinition[]
  fileInlineHandlers: Map<string, InlineHandler>
}

/**
 * Resolves a model-supplied relative path against the project root and verifies the
 * result stays inside it, preventing a BYOK model from writing/reading files elsewhere
 * on disk (e.g. via "../../" traversal) using only the root directory as authorization.
 */
function resolveWithinRoot(rootDirectory: string, requestedPath: string): string | null {
  const candidate = isAbsolute(requestedPath) ? requestedPath : resolve(rootDirectory, requestedPath)
  const resolved = resolve(candidate)
  const rel = relative(resolve(rootDirectory), resolved)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return resolved
  return null
}

// Session-scoped cache for directory listings. Keyed by project ID.
// Entries are invalidated when the project's rootDirectory changes.
const dirListingCache = new Map<string, { rootDirectory: string; block: string }>()

export function clearDirListingCache(): void {
  dirListingCache.clear()
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

function generateThumbnail(dataUrl: string): string | undefined {
  try {
    const ni = nativeImage.createFromDataURL(dataUrl)
    if (ni.isEmpty()) return undefined
    const thumb = ni.resize({ width: 120 }).toJPEG(70)
    return `data:image/jpeg;base64,${thumb.toString('base64')}`
  } catch {
    return undefined
  }
}

function estimateDataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.split(',', 2)[1] ?? ''
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

export type StoredAttachment = {
  id: string
  name: string
  size: number
  path?: string
  type?: 'file' | 'image'
  source?: 'desktop' | 'mobile' | 'pasted'
  thumbnailDataUrl?: string
}

export function buildStoredAttachments(
  attachments: ChatContextOptions['attachments'],
  images: ChatContextOptions['images'],
): StoredAttachment[] {
  return [
    ...(attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      path: attachment.path,
      size: attachment.size,
      type: 'file' as const,
      source: 'desktop' as const,
    })),
    ...(images ?? []).map((image) => {
      const thumbnailDataUrl = generateThumbnail(image.dataUrl)
      return {
        id: image.id,
        name: image.name,
        size: estimateDataUrlBytes(image.dataUrl),
        type: 'image' as const,
        source: 'mobile' as const,
        ...(thumbnailDataUrl !== undefined ? { thumbnailDataUrl } : {}),
      }
    }),
  ]
}

export async function buildChatContext(
  db: Database,
  conversationId: string,
  content: string,
  options: ChatContextOptions,
  webContents: WebContents,
  sendActivity: (a: MobileChatActivity) => void,
): Promise<BuiltContext> {
  const { attachments, images: pastedImages = [], agentId, projectId, fullAutoApprove, terminalSandboxBypass } = options

  // ── Attachment and image processing ────────────────────────────────────────
  const attachedImages: { id: string; name: string; dataUrl: string }[] = [...pastedImages]
  let augmentedContent = content

  if (attachments && attachments.length > 0) {
    let fileContext = ''
    for (const att of attachments) {
      if (!att.path) {
        fileContext += `File: ${att.name} (stored attachment metadata only)\n\n`
        continue
      }
      const ext = att.name.split('.').pop()?.toLowerCase() ?? ''
      if (IMAGE_EXTENSIONS.has(ext)) {
        try {
          const buf = readFileSync(att.path)
          const mime = IMAGE_MIME[ext]
          attachedImages.push({
            id: att.id,
            name: att.name,
            dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
          })
        } catch {
          fileContext += `File: ${att.name} (could not read image)\n\n`
        }
      } else {
        try {
          const fileContent = readFileSync(att.path, 'utf-8')
          fileContext += `File: ${att.name}\n\`\`\`\n${fileContent}\n\`\`\`\n\n`
        } catch {
          fileContext += `File: ${att.name} (could not read file)\n\n`
        }
      }
    }
    if (fileContext) augmentedContent = fileContext + content
  }

  // ── Baseline product grounding (unconditional — not gated on a custom agent having its own
  // system prompt) ────────────────────────────────────────────────────────────
  // The agent system-prompt block below only fires when the active agent has a configured
  // systemPrompt; a plain conversation with no custom agent gets none of that context. Observed
  // failure mode: asked "how do I change code from here?" or "is there a feature for X?", a chat
  // agent with no grounding hallucinated a generic Read/Edit/Write/Glob/Grep/Bash tool workflow
  // (Claude Code CLI's own tool names, not anything that exists in this app) and then couldn't
  // answer a basic "does this app have that feature" follow-up at all.
  //
  // Injected as plain text on the first message only (mirrors the wiki auto-injection below) —
  // it stays in the conversation's history for every later turn without being resent as fresh
  // input tokens every single turn. A callable tool was tried first and reverted: making a tool
  // unconditionally available flips every BYOK conversation's hasToolLoop check on globally
  // (chat-provider-dispatch.ts), routing even simple chats through the MCP tool-loop path instead
  // of plain streaming — a much bigger behavior change than intended, and it broke thinking-delta
  // streaming outright. Plain prepended text has no such side effect.
  // The current user message is already persisted by the time this runs (see chat-handlers.ts),
  // so the first-ever message in a conversation reads back as count === 1 — matching the wiki
  // auto-injection's own check below, not 0.
  const isFirstMessage = (
    db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?').get(conversationId) as { count: number }
  ).count === 1
  if (isFirstMessage) {
    augmentedContent = `[Nexy app reference — background context, not something to repeat verbatim to the user:\n\n${NEXY_HELP_CONTENT}]\n\n${augmentedContent}`
  }

  // ── Agent system prompt injection ──────────────────────────────────────────
  const convRow = db
    .prepare('SELECT agent_id FROM conversations WHERE id = ?')
    .get(conversationId) as { agent_id: string | null } | undefined

  const effectiveAgentId = agentId ?? convRow?.agent_id ?? null
  if (effectiveAgentId) {
    const invokedSkills = getSkillConfigsForAgent(effectiveAgentId)
    if (invokedSkills.length > 0) {
      const insertSkillInvocation = db.prepare(
        'INSERT OR IGNORE INTO conversation_skill_invocations (id, conversation_id, skill_id, agent_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      for (const skill of invokedSkills) {
        insertSkillInvocation.run(randomUUID(), conversationId, skill.id, effectiveAgentId, Date.now())
      }
    }

    const agentCfg = getAgentConfig(effectiveAgentId)
    if (agentCfg?.systemPrompt) {
      let systemPromptText = agentCfg.systemPrompt as string

      if (systemPromptText.includes('{{scratchpad}}')) {
        const scratchpadRow = db
          .prepare(
            "SELECT file_path FROM agent_knowledge_files WHERE agent_id = ? AND file_path LIKE '%-scratchpad.md' LIMIT 1",
          )
          .get(effectiveAgentId) as { file_path: string } | undefined
        const scratchpadContent =
          scratchpadRow?.file_path && existsSync(scratchpadRow.file_path)
            ? readFileSync(scratchpadRow.file_path, 'utf-8')
            : ''
        systemPromptText = systemPromptText.replace(/\{\{scratchpad\}\}/g, scratchpadContent)
      }

      const memoryBlock = agentCfg.memory ? `\n\n## Agent Memory\n${agentCfg.memory}` : ''

      const knowledgeRows = db
        .prepare(
          "SELECT file_path FROM agent_knowledge_files WHERE agent_id = ? AND inject_mode = 'always' ORDER BY sort_order ASC",
        )
        .all(effectiveAgentId) as { file_path: string }[]
      const knowledgeBlocks: string[] = []
      for (const kf of knowledgeRows) {
        if (!existsSync(kf.file_path)) continue
        const raw = readFileSync(kf.file_path, 'utf-8')
        const fileName = basename(kf.file_path)
        if (raw.length > 32000) {
          const truncated = raw.split('\n').slice(0, 100).join('\n')
          knowledgeBlocks.push(
            `### ${fileName}\n${truncated}\n\n<!-- [Knowledge file truncated — ${Math.ceil(raw.length / 4)} tokens total] -->`,
          )
        } else {
          knowledgeBlocks.push(`### ${fileName}\n${raw}`)
        }
      }
      const knowledgeBlock =
        knowledgeBlocks.length > 0
          ? `\n\n## Knowledge Files\n${knowledgeBlocks.join('\n\n---\n\n')}`
          : ''

      const toolLines: string[] = []
      const tc = agentCfg?.tools as {
        fileEdit?: { enabled?: boolean; instructions?: string }
        terminal?: { enabled?: boolean; instructions?: string }
        webFetch?: { enabled?: boolean; instructions?: string }
      } | null
      if (tc?.fileEdit?.enabled && tc.fileEdit.instructions) {
        toolLines.push(`- **File Edit**: ${tc.fileEdit.instructions}`)
      }
      if (tc?.terminal?.enabled && tc.terminal.instructions) {
        toolLines.push(`- **Terminal**: ${tc.terminal.instructions}`)
      }
      if (tc?.webFetch?.enabled && tc.webFetch.instructions) {
        toolLines.push(`- **Web Fetch**: ${tc.webFetch.instructions}`)
      }
      const mcpOverrides = db
        .prepare(
          "SELECT tool_name, server_id, instructions FROM agent_mcp_tool_overrides WHERE agent_id=? AND enabled=1 AND instructions != ''",
        )
        .all(effectiveAgentId) as { tool_name: string; server_id: string; instructions: string }[]
      for (const o of mcpOverrides) {
        toolLines.push(`- **${o.tool_name}** (via ${o.server_id}): ${o.instructions}`)
      }
      const guidelinesBlock =
        toolLines.length > 0 ? `\n\n## Tool Usage Guidelines\n${toolLines.join('\n')}` : ''

      augmentedContent = `[System Instructions]\n${systemPromptText}${memoryBlock}${knowledgeBlock}${guidelinesBlock}\n[/System Instructions]\n\n${augmentedContent}`
    }
  }

  // ── Project context injection ──────────────────────────────────────────────
  let injectedRootDirectory: string | null = null
  let wikiProjectId: string | null = null

  const convProjectId =
    projectId ??
    (
      db
        .prepare('SELECT project_id FROM conversations WHERE id = ?')
        .get(conversationId) as { project_id: string | null } | undefined
    )?.project_id ??
    null

  if (convProjectId) {
    wikiProjectId = convProjectId
    const projRow = db
      .prepare('SELECT config_json FROM projects WHERE id = ?')
      .get(convProjectId) as { config_json: string | null } | undefined
    const projCfg = parseProjectConfig(projRow?.config_json ?? null)

    if (projCfg.instructionsEnabled && projCfg.instructions.trim()) {
      let instructions = projCfg.instructions
      for (const { key, value } of projCfg.variables) {
        instructions = instructions.replaceAll(`{{${key}}}`, value)
      }
      for (const { key, value } of projCfg.variables) {
        augmentedContent = augmentedContent.replaceAll(`{{${key}}}`, value)
      }

      const projectBlock = `[Project Context]\n${instructions}\n[/Project Context]`
      switch (projCfg.instructionMode) {
        case 'prepend':
          augmentedContent = `${projectBlock}\n\n${augmentedContent}`
          break
        case 'append': {
          const splitMarker = '\n\n'
          const splitIdx = augmentedContent.indexOf(splitMarker)
          if (splitIdx !== -1) {
            augmentedContent =
              augmentedContent.slice(0, splitIdx) +
              splitMarker +
              projectBlock +
              splitMarker +
              augmentedContent.slice(splitIdx + splitMarker.length)
          } else {
            augmentedContent = `${augmentedContent}\n\n${projectBlock}`
          }
          break
        }
        case 'replace':
        case 'standalone':
          augmentedContent = `${projectBlock}\n\n${content}`
          break
      }
    }

    if (projCfg.strategyRetrievalEnabled) {
      const similarStrategies = findSimilarRatedStrategies({
        agentId: effectiveAgentId,
        model: options.conversationModel ?? null,
        projectId: convProjectId,
        keywords: extractKeywords(content),
      })
      if (similarStrategies.length > 0) {
        const strategyLines = similarStrategies.map((s) => {
          const agent = s.snapshot.agentName ? ` using ${s.snapshot.agentName}` : ''
          const tools = s.snapshot.toolNames.length > 0 ? ` — tools: ${s.snapshot.toolNames.join(', ')}` : ''
          const note = s.note ? ` — note: "${s.note}"` : ''
          return `- Rated ${s.rating}/5${agent}${tools}${note}`
        })
        const strategyBlock =
          `[Similar Past Strategies]\n` +
          `These past conversations in this project were rated highly for similar work:\n` +
          `${strategyLines.join('\n')}\n` +
          `[/Similar Past Strategies]`
        augmentedContent = `${strategyBlock}\n\n${augmentedContent}`
      }
    }

    if (projCfg.rootDirectory && existsSync(projCfg.rootDirectory)) {
      injectedRootDirectory = projCfg.rootDirectory
      debugLog('chat', `context-builder: injecting directory listing for ${projCfg.rootDirectory}`)
      const cached = dirListingCache.get(convProjectId)
      let structureBlock: string
      if (cached && cached.rootDirectory === projCfg.rootDirectory) {
        structureBlock = cached.block
      } else {
        const entries = listDirectoryEntries(projCfg.rootDirectory, 3, '')
        const lines = entries.map((e) => (e.type === 'dir' ? `${e.relativePath}/` : e.relativePath))
        structureBlock =
          `[Project File Structure]\n` +
          `The following file tree has already been retrieved from the project root directory (${projCfg.rootDirectory}). ` +
          `Use it to answer questions about the project structure — do NOT say you cannot access the file system.\n` +
          `\`\`\`\n${lines.join('\n')}\n\`\`\`\n` +
          `[/Project File Structure]`
        dirListingCache.set(convProjectId, {
          rootDirectory: projCfg.rootDirectory,
          block: structureBlock,
        })
      }
      augmentedContent = `${structureBlock}\n\n${augmentedContent}`
    } else if (projCfg.rootDirectory) {
      debugLog('chat', `context-builder: rootDirectory set but path not found on disk: ${JSON.stringify(projCfg.rootDirectory)}`)
    } else {
      debugLog('chat', `context-builder: no rootDirectory configured for project ${convProjectId}`)
    }

    const inScopeRules = projCfg.inScope ?? []
    const outOfScopeRules = projCfg.outOfScope ?? []
    const milestonesArr = projCfg.milestones ?? []
    const activeMilestone = milestonesArr.find((m) => m.status === 'active')
    if (activeMilestone || inScopeRules.length > 0 || outOfScopeRules.length > 0) {
      const scopeLines: string[] = []
      if (activeMilestone) {
        const desc = activeMilestone.description ? ` — ${activeMilestone.description}` : ''
        scopeLines.push(`Active Milestone: ${activeMilestone.title}${desc}`)
      }
      if (inScopeRules.length > 0) {
        scopeLines.push('In Scope:')
        for (const r of inScopeRules) {
          scopeLines.push(`  - ${r.description}${r.pathGlob ? ` (${r.pathGlob})` : ''}`)
        }
      }
      if (outOfScopeRules.length > 0) {
        scopeLines.push('Out of Scope (do NOT work on these):')
        for (const r of outOfScopeRules) {
          scopeLines.push(`  - ${r.description}${r.pathGlob ? ` (${r.pathGlob})` : ''}`)
        }
      }
      const scopeBlock = `[Project Scope]\n${scopeLines.join('\n')}\n[/Project Scope]`
      augmentedContent = `${scopeBlock}\n\n${augmentedContent}`
    }

    // Team awareness block — inject when project has ≥2 agents, orchestration disabled
    const projCfgRaw = projRow?.config_json
      ? (() => {
          try {
            return JSON.parse(projRow.config_json) as Record<string, unknown>
          } catch {
            return {}
          }
        })()
      : {}
    const orchAlreadyEnabled = projCfgRaw.orchestrationEnabled === true
    if (!orchAlreadyEnabled) {
      const teamRows = db
        .prepare(
          'SELECT pa.agent_id, pa.is_primary, a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? ORDER BY pa.is_primary DESC, pa.sort_order ASC',
        )
        .all(convProjectId) as { agent_id: string; is_primary: number; config_json: string }[]

      if (teamRows.length >= 2) {
        const projName =
          (
            db.prepare('SELECT name FROM projects WHERE id = ?').get(convProjectId) as
              | { name: string }
              | undefined
          )?.name ?? 'this project'
        const memberLines = teamRows.map((r) => {
          const cfg = (() => {
            try {
              return JSON.parse(r.config_json) as Record<string, unknown>
            } catch {
              return {}
            }
          })()
          const name = typeof cfg.name === 'string' ? cfg.name : 'Agent'
          const icon = typeof cfg.icon === 'string' ? cfg.icon : '🤖'
          const role = r.is_primary ? ' (primary — currently speaking)' : ''
          return `  - ${icon} ${name}${role}`
        })
        const teamBlock =
          `[Project Team — "${projName}"]\n` +
          `This conversation is part of a project with the following agents:\n` +
          memberLines.join('\n') +
          '\n' +
          `Orchestration is currently disabled, so you cannot autonomously delegate tasks.\n` +
          `If asked about delegation or other agents, be honest: the user can switch agents manually\n` +
          `or enable orchestration in the project settings to allow automatic delegation.\n` +
          `[/Project Team]`
        augmentedContent = `${teamBlock}\n\n${augmentedContent}`
      }
    }
  }

  // Auto-inject relevant wiki entries on the first message
  const wikiMsgCount = db
    .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
    .get(conversationId) as { count: number }
  if (wikiMsgCount.count === 1 && convProjectId) {
    const wikiEntries = getRelevantWikiEntries(db, convProjectId, content)
    if (wikiEntries.length > 0) {
      const wikiBlock = formatWikiSection(wikiEntries)
      augmentedContent = `${wikiBlock}\n\n${augmentedContent}`
      if (!webContents.isDestroyed()) {
        webContents.send('chat:wiki-injected', { count: wikiEntries.length })
      }
    }
  }

  // ── Wiki inline tools ──────────────────────────────────────────────────────
  const wikiToolDefs: ToolDefinition[] = []
  const wikiInlineHandlers = new Map<string, InlineHandler>()

  if (wikiProjectId) {
    wikiToolDefs.push(
      {
        type: 'function' as const,
        function: {
          name: 'search_project_wiki',
          description:
            'Search the project wiki for relevant knowledge, decisions, procedures, or facts. Use this when the user asks about project-specific information that may have been documented.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Keywords or question to search for in the project wiki',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'create_wiki_entry',
          description:
            'Save a new entry to the project wiki. Use this to preserve important facts, decisions, or procedures. Always requires explicit user approval before saving.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short descriptive title for the wiki entry' },
              body: { type: 'string', description: 'Full content of the wiki entry in markdown' },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tags to categorize the entry',
              },
            },
            required: ['title', 'body'],
          },
        },
      },
    )

    const capturedProjectId = wikiProjectId
    const capturedDb = db
    const capturedWebContents = webContents

    wikiInlineHandlers.set('search_project_wiki', async (args) => {
      sendActivity({
        state: 'tool',
        label: 'Searching project wiki',
        toolName: 'search_project_wiki',
        serverName: 'Project Wiki',
      })
      const query = typeof args.query === 'string' ? args.query : String(args.query ?? '')
      const entries = getRelevantWikiEntries(capturedDb, capturedProjectId, query)
      if (entries.length === 0)
        return { success: true, result: 'No relevant wiki entries found for this query.' }
      return { success: true, result: formatWikiSection(entries) }
    })

    wikiInlineHandlers.set('create_wiki_entry', async (args) => {
      if (capturedWebContents.isDestroyed())
        return { success: false, error: 'Window closed — cannot request approval' }
      sendActivity({
        state: 'approval',
        label: 'Waiting for wiki approval',
        toolName: 'create_wiki_entry',
      })
      const approved = await requestApproval(
        capturedWebContents,
        'create_wiki_entry',
        args,
        `Save wiki entry: "${args.title}"`,
        { noRemember: true },
      )
      if (!approved) return { success: false, error: 'User declined wiki entry creation' }
      const title = typeof args.title === 'string' ? args.title : String(args.title ?? '')
      const body = typeof args.body === 'string' ? args.body : String(args.body ?? '')
      const tags = Array.isArray(args.tags) ? (args.tags as string[]).map(String) : []
      insertWikiEntry(capturedDb, capturedProjectId, title, body, tags, { conversationId })
      sendActivity({
        state: 'tool',
        label: 'Saved wiki entry',
        toolName: 'create_wiki_entry',
        serverName: 'Project Wiki',
      })
      return { success: true, result: `Wiki entry "${title}" saved to the project wiki.` }
    })
  }

  // ── Project file tools (read/write scoped to the project root) ─────────────
  const fileToolDefs: ToolDefinition[] = []
  const fileInlineHandlers = new Map<string, InlineHandler>()

  if (injectedRootDirectory) {
    const capturedRoot = injectedRootDirectory
    const capturedWebContentsForFiles = webContents
    const capturedFullAutoApprove = fullAutoApprove

    fileToolDefs.push(
      {
        type: 'function' as const,
        function: {
          name: 'read_project_file',
          description:
            'Read the contents of a file within the project directory. Path may be relative to the project root.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path, relative to the project root' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'write_project_file',
          description:
            'Create or overwrite a file within the project directory. Path may be relative to the project root. Always requires explicit user approval before writing.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path, relative to the project root' },
              content: { type: 'string', description: 'Full content to write to the file' },
            },
            required: ['path', 'content'],
          },
        },
      },
    )

    fileInlineHandlers.set('read_project_file', async (args) => {
      const requestedPath = typeof args.path === 'string' ? args.path : String(args.path ?? '')
      const resolvedPath = resolveWithinRoot(capturedRoot, requestedPath)
      if (!resolvedPath) return { success: false, error: 'Path is outside the project directory' }
      sendActivity({ state: 'tool', label: `Reading ${requestedPath}`, toolName: 'read_project_file' })
      if (!existsSync(resolvedPath)) return { success: false, error: `File not found: ${requestedPath}` }
      try {
        const text = readFileSync(resolvedPath, 'utf-8')
        const truncated = text.length > 100000 ? text.slice(0, 100000) + '\n\n... (truncated, file too large)' : text
        return { success: true, result: truncated }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to read file' }
      }
    })

    fileInlineHandlers.set('write_project_file', async (args) => {
      const requestedPath = typeof args.path === 'string' ? args.path : String(args.path ?? '')
      const fileContent = typeof args.content === 'string' ? args.content : String(args.content ?? '')
      const resolvedPath = resolveWithinRoot(capturedRoot, requestedPath)
      if (!resolvedPath) return { success: false, error: 'Path is outside the project directory' }
      if (capturedWebContentsForFiles.isDestroyed())
        return { success: false, error: 'Window closed — cannot request approval' }
      sendActivity({ state: 'approval', label: 'Waiting for file write approval', toolName: 'write_project_file' })
      const approved = await requestApproval(
        capturedWebContentsForFiles,
        'write_project_file',
        { path: requestedPath },
        `Write file: ${requestedPath}`,
        { noRemember: true, autoApprove: capturedFullAutoApprove },
      )
      if (!approved) return { success: false, error: 'User declined file write' }
      try {
        const existed = existsSync(resolvedPath)
        const beforeContent = existed ? readFileSync(resolvedPath, 'utf-8') : ''
        writeFileSync(resolvedPath, fileContent, 'utf-8')
        const auditTarget = inferProjectAuditTarget(resolvedPath)
        if (auditTarget) {
          recordProjectAuditChange({
            projectId: auditTarget.projectId,
            title: 'Tool file write',
            source: 'chat-tool',
            relativePath: auditTarget.relativePath,
            status: existed ? 'modified' : 'created',
            lastOperation: existed ? 'write' : 'create',
            diff: { hunks: computeLineDiff(beforeContent, fileContent) },
          })
        }
        sendActivity({ state: 'tool', label: `Wrote ${requestedPath}`, toolName: 'write_project_file' })
        return { success: true, result: `Successfully wrote ${fileContent.length} characters to ${requestedPath}` }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to write file' }
      }
    })

    // ── Terminal tool (cwd scoped to the project root unless sandbox bypass is on) ──
    const terminalCfg = (effectiveAgentId ? getAgentConfig(effectiveAgentId) : null)?.tools as {
      terminal?: { enabled?: boolean; approval?: 'auto' | 'always-ask' | 'disabled' }
    } | null
    if (terminalCfg?.terminal?.enabled && terminalCfg.terminal.approval !== 'disabled') {
      const capturedTerminalApprovalAuto = terminalCfg.terminal.approval === 'auto'
      const capturedTerminalSandboxBypass = terminalSandboxBypass === true

      fileToolDefs.push({
        type: 'function' as const,
        function: {
          name: 'run_terminal_command',
          description:
            'Run a shell command. By default the working directory is confined to the project root directory (or a subdirectory of it); commands targeting a directory outside the project root are rejected unless sandbox bypass has been enabled for this chat/project. Always requires explicit user approval before running, unless the tool is configured for auto-approval.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'The shell command to execute' },
              cwd: {
                type: 'string',
                description: 'Working directory for the command, relative to the project root (defaults to the project root)',
              },
            },
            required: ['command'],
          },
        },
      })

      fileInlineHandlers.set('run_terminal_command', async (args) => {
        const command = typeof args.command === 'string' ? args.command : String(args.command ?? '')
        if (!command.trim()) return { success: false, error: 'No command provided' }
        const requestedCwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd : '.'

        const withinRoot = resolveWithinRoot(capturedRoot, requestedCwd)
        let resolvedCwd: string
        if (withinRoot) {
          resolvedCwd = withinRoot
        } else if (capturedTerminalSandboxBypass) {
          resolvedCwd = isAbsolute(requestedCwd) ? resolve(requestedCwd) : resolve(capturedRoot, requestedCwd)
        } else {
          return {
            success: false,
            error: `Working directory "${requestedCwd}" is outside the project root. Sandbox bypass is not enabled for this chat/project.`,
          }
        }
        if (!existsSync(resolvedCwd) || !statSync(resolvedCwd).isDirectory()) {
          return { success: false, error: `Working directory not found: ${requestedCwd}` }
        }

        if (capturedWebContentsForFiles.isDestroyed())
          return { success: false, error: 'Window closed — cannot request approval' }
        sendActivity({ state: 'approval', label: 'Waiting for terminal command approval', toolName: 'run_terminal_command' })
        const approved = await requestApproval(
          capturedWebContentsForFiles,
          'run_terminal_command',
          { command, cwd: resolvedCwd },
          `Run command: ${command}`,
          { noRemember: true, autoApprove: capturedFullAutoApprove || capturedTerminalApprovalAuto },
        )
        if (!approved) return { success: false, error: 'User declined command execution' }
        sendActivity({ state: 'tool', label: `Running: ${command}`, toolName: 'run_terminal_command' })

        const MAX_OUTPUT_CHARS = 100_000
        const TIMEOUT_MS = 120_000
        return await new Promise<{ success: boolean; result?: string; error?: string }>((resolvePromise) => {
          let output = ''
          let truncated = false
          let settled = false
          const proc = spawn(command, { shell: true, cwd: resolvedCwd, windowsHide: true })
          const timer = setTimeout(() => {
            if (settled) return
            settled = true
            proc.kill()
            resolvePromise({
              success: false,
              error: `Command timed out after ${TIMEOUT_MS / 1000}s and was killed.\n\nOutput so far:\n${output}`,
            })
          }, TIMEOUT_MS)
          const appendOutput = (chunk: Buffer) => {
            if (truncated) return
            output += chunk.toString('utf-8')
            if (output.length > MAX_OUTPUT_CHARS) {
              output = output.slice(0, MAX_OUTPUT_CHARS) + '\n\n... (output truncated)'
              truncated = true
            }
          }
          proc.stdout?.on('data', appendOutput)
          proc.stderr?.on('data', appendOutput)
          proc.on('error', (err) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolvePromise({ success: false, error: err.message })
          })
          proc.on('close', (code) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolvePromise({ success: code === 0, result: `Exit code: ${code}\n\n${output || '(no output)'}` })
          })
        })
      })
    }
  }

  return {
    augmentedContent,
    attachedImages,
    injectedRootDirectory,
    wikiProjectId,
    wikiToolDefs,
    wikiInlineHandlers,
    fileToolDefs,
    fileInlineHandlers,
  }
}
