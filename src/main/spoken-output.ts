import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type {
  MessageSpokenOutput,
  SaveSpokenOutputInput,
  SpokenOutputGenerationKind,
  SpokenOutputKind,
} from '../shared/spoken-output'
import { createQuickRecap, sanitizeForSpeech } from '../shared/spoken-output'
import { ClaudeAdapter } from './cli-adapters/claude'
import {
  DEFAULT_PROVIDER_MODEL,
  getApiKey,
  getProviderForAgent,
  sendProviderNonStreaming,
} from './providers'
import type { ProviderMessage } from './providers'

const AI_RECAP_SYSTEM_PROMPT = `Create a brief recap of the assistant response for spoken delivery.
Return only one or two plain-English sentences, without Markdown, code, commands, URLs, or preamble.
Keep the important conclusion and next action. Aim for fewer than 45 words.`

interface MessageContext {
  messageId: string
  content: string
  projectId: string | null
}

export function saveMessageSpokenOutput(
  db: Database.Database,
  input: SaveSpokenOutputInput,
): MessageSpokenOutput {
  const text = sanitizeForSpeech(input.spokenText)
  if (!text) throw new Error('Spoken output is empty')
  const message = db.prepare(
    "SELECT id FROM messages WHERE id = ? AND role = 'assistant'",
  ).get(input.messageId)
  if (!message) throw new Error('Assistant message not found')

  const now = Date.now()
  db.prepare(`
    INSERT INTO message_spoken_outputs (
      message_id, spoken_text, output_kind, generation_kind, model, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      spoken_text = excluded.spoken_text,
      output_kind = excluded.output_kind,
      generation_kind = excluded.generation_kind,
      model = excluded.model,
      updated_at = excluded.updated_at
  `).run(
    input.messageId,
    text,
    input.outputKind,
    input.generationKind,
    input.model ?? null,
    now,
    now,
  )
  return getMessageSpokenOutput(db, input.messageId) as MessageSpokenOutput
}

export function getMessageSpokenOutput(
  db: Database.Database,
  messageId: string,
): MessageSpokenOutput | null {
  const row = db.prepare(`
    SELECT message_id, spoken_text, output_kind, generation_kind, model, created_at, updated_at
    FROM message_spoken_outputs WHERE message_id = ?
  `).get(messageId) as {
    message_id: string
    spoken_text: string
    output_kind: SpokenOutputKind
    generation_kind: SpokenOutputGenerationKind
    model: string | null
    created_at: number
    updated_at: number
  } | undefined
  return row ? {
    messageId: row.message_id,
    spokenText: row.spoken_text,
    outputKind: row.output_kind,
    generationKind: row.generation_kind,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

export function findLatestAssistantMessage(
  db: Database.Database,
  conversationId: string,
): MessageContext | null {
  const row = db.prepare(`
    SELECT m.id, m.content, c.project_id
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = ? AND m.role = 'assistant'
    ORDER BY m.timeline_order DESC, m.timestamp DESC, m.id DESC
    LIMIT 1
  `).get(conversationId) as { id: string; content: string; project_id: string | null } | undefined
  return row ? { messageId: row.id, content: row.content, projectId: row.project_id } : null
}

export function getAssistantMessageContext(
  db: Database.Database,
  messageId: string,
): MessageContext | null {
  const row = db.prepare(`
    SELECT m.id, m.content, c.project_id
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = ? AND m.role = 'assistant'
  `).get(messageId) as { id: string; content: string; project_id: string | null } | undefined
  return row ? { messageId: row.id, content: row.content, projectId: row.project_id } : null
}

function resolveRecapModel(db: Database.Database, projectId: string | null): string {
  if (!projectId) return DEFAULT_PROVIDER_MODEL
  const row = db.prepare(`
    SELECT a.config_json
    FROM project_agents pa
    JOIN agents a ON a.id = pa.agent_id
    WHERE pa.project_id = ? AND pa.is_primary = 1
    LIMIT 1
  `).get(projectId) as { config_json: string } | undefined
  try {
    const config = JSON.parse(row?.config_json ?? '{}') as Record<string, unknown>
    return typeof config.model === 'string' && config.model ? config.model : DEFAULT_PROVIDER_MODEL
  } catch {
    return DEFAULT_PROVIDER_MODEL
  }
}

export async function generateAiSpokenOutput(
  db: Database.Database,
  context: MessageContext,
  outputKind: Extract<SpokenOutputKind, 'ai-recap' | 'notification-recap'> = 'ai-recap',
): Promise<MessageSpokenOutput | null> {
  const source = sanitizeForSpeech(context.content)
  if (!source) return null
  const configuredModel = resolveRecapModel(db, context.projectId)
  const { provider, model } = getProviderForAgent(configuredModel)
  const apiKey = getApiKey(provider)
  const userContent = `Assistant response:\n\n${source.slice(0, 40_000)}`
  const messages: ProviderMessage[] = [
    { role: 'system', content: AI_RECAP_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]

  let text = ''
  let generationKind: SpokenOutputGenerationKind
  let usedModel: string
  if (apiKey) {
    const result = await sendProviderNonStreaming(provider, apiKey, model, messages, {
      maxTokens: 180,
      temperature: 0.2,
    })
    text = result.content ?? ''
    generationKind = 'provider'
    usedModel = configuredModel
  } else if (ClaudeAdapter.isAvailable()) {
    text = await ClaudeAdapter.send(
      null as never,
      {
        systemPrompt: AI_RECAP_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
        cwd: '',
        model: 'default',
        conversationId: randomUUID(),
      },
      () => {},
    )
    generationKind = 'cli'
    usedModel = 'claude-cli'
  } else {
    return null
  }

  const recap = createQuickRecap(text, 600)
  if (!recap) return null
  return saveMessageSpokenOutput(db, {
    messageId: context.messageId,
    spokenText: recap,
    outputKind,
    generationKind,
    model: usedModel,
  })
}
