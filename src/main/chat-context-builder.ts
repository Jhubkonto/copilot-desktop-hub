import { existsSync, readFileSync } from 'fs'
import { basename } from 'path'
import { nativeImage } from 'electron'
import type { WebContents } from 'electron'
import type { Database } from 'better-sqlite3'
import { getAgentConfig } from './agents'
import { listDirectoryEntries } from './file-handlers'
import { parseProjectConfig } from './project-handlers'
import { getRelevantWikiEntries, formatWikiSection } from './wiki-context'
import { insertWikiEntry } from './wiki-handlers'
import { requestApproval } from './tools'
import type { ToolDefinition } from './provider-types'
import { debugLog } from './debug-mode'

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
}

export type BuiltContext = {
  augmentedContent: string
  attachedImages: { id: string; name: string; dataUrl: string }[]
  injectedRootDirectory: string | null
  wikiProjectId: string | null
  wikiToolDefs: ToolDefinition[]
  wikiInlineHandlers: Map<string, InlineHandler>
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
  const { attachments, images: pastedImages = [], agentId, projectId } = options

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

  // ── Agent system prompt injection ──────────────────────────────────────────
  const convRow = db
    .prepare('SELECT agent_id FROM conversations WHERE id = ?')
    .get(conversationId) as { agent_id: string | null } | undefined

  const effectiveAgentId = agentId ?? convRow?.agent_id ?? null
  if (effectiveAgentId) {
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

  return {
    augmentedContent,
    attachedImages,
    injectedRootDirectory,
    wikiProjectId,
    wikiToolDefs,
    wikiInlineHandlers,
  }
}
