import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import type { Debrief } from '../shared/types'
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

function parseDebriefRow(row: {
  id: string
  conversation_id: string
  project_id: string | null
  summary: string
  commands_tools: string
  reproduction_guide: string
  mental_model: string
  generated_at: number
  created_at: number
}): Debrief {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    summary: row.summary,
    commandsTools: (() => {
      try { return JSON.parse(row.commands_tools) as string[] } catch { return [] }
    })(),
    reproductionGuide: row.reproduction_guide,
    mentalModel: row.mental_model,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  }
}

export async function generateDebriefForWs(conversationId: string, projectId: string | null, model?: string): Promise<Debrief> {
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

  const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
  const commandsAndTools = Array.isArray(parsed.commandsAndTools)
    ? (parsed.commandsAndTools as unknown[]).map(String)
    : []
  const reproductionGuide = typeof parsed.reproductionGuide === 'string' ? parsed.reproductionGuide : ''
  const mentalModel = typeof parsed.mentalModel === 'string' ? parsed.mentalModel : ''

  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT OR REPLACE INTO conversation_debriefs
     (id, conversation_id, project_id, summary, commands_tools, reproduction_guide, mental_model, generated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, projectId ?? null, summary, JSON.stringify(commandsAndTools), reproductionGuide, mentalModel, now, now)

  const debrief = parseDebriefRow(
    db.prepare('SELECT * FROM conversation_debriefs WHERE id = ?').get(id) as Parameters<typeof parseDebriefRow>[0]
  )
  broadcastToMobile({ event: 'debrief:ready', data: { debrief } })
  return debrief
}

export function getDebriefForWs(conversationId: string): Debrief | null {
  const db = getDatabase()
  const row = db.prepare(
    'SELECT * FROM conversation_debriefs WHERE conversation_id = ?'
  ).get(conversationId) as Parameters<typeof parseDebriefRow>[0] | undefined
  return row ? parseDebriefRow(row) : null
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
  safeHandle('conversation:generate-debrief', async (_event, conversationId: string, projectId: string | null, model?: string): Promise<Debrief> => {
    return generateDebriefForWs(conversationId, projectId, model)
  })

  safeHandle('conversation:get-debrief', (_event, conversationId: string): Debrief | null => {
    return getDebriefForWs(conversationId)
  })

  safeHandle('conversation:mark-complete', (_event, conversationId: string): boolean => {
    return markCompleteForWs(conversationId) !== null
  })

  safeHandle('conversation:mark-incomplete', (_event, conversationId: string): boolean => {
    return markIncompleteForWs(conversationId)
  })
}
