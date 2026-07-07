import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type { Debrief, DebriefArtifactResult } from '../shared/types'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getApiKey,
  sendProviderNonStreaming,
} from './providers'
import type { ProviderMessage } from './providers'
import { ClaudeAdapter } from './cli-adapters/claude'
import { broadcastToMobile } from './ws-server'
import { findArtifactForConversation, readArtifactVersionFile, writeArtifactVersionForConversation } from './artifacts'

const HEAD = 4000
const HARD_LIMIT = 40_000

const DEBRIEF_SYSTEM_PROMPT = `You are a session debrief assistant. Analyze this AI chat conversation and return ONLY a JSON object (no markdown, no preamble) with this exact schema:
{
  "summary": "2-4 sentence summary of what was accomplished",
  "commandsAndTools": ["tool or command 1", ...],
  "reproductionGuide": "Step-by-step guide: 1. ... 2. ...",
  "mentalModel": "The reasoning approach / troubleshooting strategy used"
}
commandsAndTools: CLI commands, MCP tools, APIs, or techniques used.
reproductionGuide: numbered steps a reader can follow to reproduce from scratch.
mentalModel: the diagnostic or design thinking, not just the steps.`

export interface DebriefSectionData {
  summary: string
  commandsAndTools: string[]
  reproductionGuide: string
  mentalModel: string
}

/** Renders a debrief section as markdown, matching the format the old DebriefModal export produced. */
export function formatDebriefMarkdown(title: string, section: DebriefSectionData): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const toolLines = section.commandsAndTools.map((t) => `- ${t}`).join('\n') || '- None'
  return [
    `# Debrief: ${title}`,
    `Generated: ${date}`,
    '',
    '## Summary',
    section.summary,
    '',
    '## Commands & Tools Used',
    toolLines,
    '',
    '## How to Reproduce',
    section.reproductionGuide,
    '',
    '## Mental Model / Approach',
    section.mentalModel,
  ].join('\n')
}

function sectionToDebrief(section: DebriefSectionData, conversationId: string, projectId: string | null, versionId: string, timestamp: number): Debrief {
  return {
    id: versionId,
    conversationId,
    projectId,
    summary: section.summary,
    commandsTools: section.commandsAndTools,
    reproductionGuide: section.reproductionGuide,
    mentalModel: section.mentalModel,
    generatedAt: timestamp,
    createdAt: timestamp,
  }
}

export async function generateDebriefForWs(conversationId: string, projectId: string | null, model?: string): Promise<DebriefArtifactResult> {
  const db = getDatabase()

  const rows = db.prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? AND role IN ('user', 'assistant') ORDER BY timestamp ASC"
  ).all(conversationId) as { role: string; content: string }[]

  if (rows.length === 0) throw new Error('Conversation has no messages to debrief')

  const transcript = rows
    .map((r) => `${r.role === 'user' ? 'User' : 'Assistant'}: ${r.content}`)
    .join('\n\n')

  const truncatedTranscript = transcript.length <= HARD_LIMIT
    ? transcript
    : transcript.slice(0, HEAD) + '\n\n[... conversation truncated ...]\n\n' + transcript.slice(-(HARD_LIMIT - HEAD))

  const userContent = `Here is the conversation to analyze:\n\n${truncatedTranscript}`

  let extractionProvider: ReturnType<typeof getProviderForAgent>
  if (model) {
    extractionProvider = getProviderForAgent(model)
  } else {
    let agentModel = DEFAULT_PROVIDER_MODEL
    if (projectId) {
      const agentRow = db.prepare(
        'SELECT a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? AND pa.is_primary = 1 LIMIT 1'
      ).get(projectId) as { config_json: string } | undefined
      try {
        const cfg = JSON.parse(agentRow?.config_json ?? '{}') as Record<string, unknown>
        if (typeof cfg.model === 'string' && cfg.model) agentModel = cfg.model
      } catch { /* use default */ }
    }
    extractionProvider = getProviderForAgent(agentModel)
  }

  const { provider, model: resolvedModel } = extractionProvider
  const apiKey = getApiKey(provider)

  let rawText: string
  if (apiKey) {
    const messages: ProviderMessage[] = [
      { role: 'system', content: DEBRIEF_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ]
    const result = await sendProviderNonStreaming(provider, apiKey, resolvedModel, messages, {
      maxTokens: 2000,
      temperature: 0.3,
    })
    rawText = result.content ?? ''
  } else if (ClaudeAdapter.isAvailable()) {
    rawText = await ClaudeAdapter.send(
      null as never,
      {
        systemPrompt: DEBRIEF_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
        cwd: '',
        model: 'default',
        conversationId: randomUUID(),
      },
      () => {},
    )
  } else {
    throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
  }

  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  let parsed: { summary?: unknown; commandsAndTools?: unknown; reproductionGuide?: unknown; mentalModel?: unknown }
  try {
    parsed = JSON.parse(cleaned) as typeof parsed
  } catch {
    throw new Error('Failed to parse debrief JSON from AI response')
  }

  const section: DebriefSectionData = {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    commandsAndTools: Array.isArray(parsed.commandsAndTools) ? (parsed.commandsAndTools as unknown[]).map(String) : [],
    reproductionGuide: typeof parsed.reproductionGuide === 'string' ? parsed.reproductionGuide : '',
    mentalModel: typeof parsed.mentalModel === 'string' ? parsed.mentalModel : '',
  }

  const now = Date.now()
  const conversationRow = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined
  const conversationTitle = conversationRow?.title ?? 'Conversation'
  const title = `Debrief: ${conversationTitle}`

  const { artifactId, versionId } = writeArtifactVersionForConversation({
    conversationId,
    projectId,
    kind: 'debrief',
    title,
    files: [
      { relativePath: 'debrief.json', mediaType: 'application/json', role: 'primary', content: JSON.stringify(section, null, 2) },
      { relativePath: 'debrief.md', mediaType: 'text/markdown', role: 'supporting', content: formatDebriefMarkdown(conversationTitle, section) },
    ],
  })

  const debrief = sectionToDebrief(section, conversationId, projectId, versionId, now)
  const result: DebriefArtifactResult = { debrief, artifactId, versionId }
  broadcastToMobile({ event: 'debrief:ready', data: result })
  return result
}

export function getDebriefForWs(conversationId: string): DebriefArtifactResult | null {
  const artifact = findArtifactForConversation(conversationId, 'debrief')
  const version = artifact?.currentVersion
  if (!artifact || !version) return null
  const content = readArtifactVersionFile(version.id, 'debrief.json')
  if (!content) return null
  let section: DebriefSectionData
  try {
    section = JSON.parse(content) as DebriefSectionData
  } catch {
    return null
  }
  const debrief = sectionToDebrief(section, conversationId, artifact.projectId, version.id, version.createdAt)
  return { debrief, artifactId: artifact.id, versionId: version.id }
}

export function markCompleteForWs(conversationId: string): { completedAt: number } | null {
  const db = getDatabase()
  const now = Date.now()
  const result = db.prepare(
    'UPDATE conversations SET completed_at = ? WHERE id = ?'
  ).run(now, conversationId)
  if (result.changes === 0) return null
  broadcastToMobile({ event: 'debrief:conversation-completed', data: { conversationId, completedAt: now } })
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('conversation:completed', { conversationId, completedAt: now })
  })
  return { completedAt: now }
}

export function markIncompleteForWs(conversationId: string): boolean {
  const db = getDatabase()
  const result = db.prepare(
    'UPDATE conversations SET completed_at = NULL WHERE id = ?'
  ).run(conversationId)
  if (result.changes === 0) return false
  broadcastToMobile({ event: 'debrief:conversation-incompleted', data: { conversationId } })
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('conversation:incompleted', { conversationId })
  })
  return true
}

export function registerDebriefHandlers(): void {
  safeHandle('conversation:generate-debrief', async (_event, conversationId: string, projectId: string | null, model?: string): Promise<DebriefArtifactResult> => {
    return generateDebriefForWs(conversationId, projectId, model)
  })

  safeHandle('conversation:get-debrief', (_event, conversationId: string): DebriefArtifactResult | null => {
    return getDebriefForWs(conversationId)
  })

  safeHandle('conversation:mark-complete', (_event, conversationId: string): boolean => {
    return markCompleteForWs(conversationId) !== null
  })

  safeHandle('conversation:mark-incomplete', (_event, conversationId: string): boolean => {
    return markIncompleteForWs(conversationId)
  })
}
