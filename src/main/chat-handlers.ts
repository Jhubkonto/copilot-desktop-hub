import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { homedir } from 'os'
import { getDatabase } from './database'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getApiKey,
  abortActiveStream,
  getOpenRouterModels,
  type MessageContentPart,
  type ProviderMessage,
} from './providers'
import { activeCliAbortControllers } from './provider-stream-state'
import { safeHandle } from './safe-handle'
import { runOrchestration, type OrchestratorAgent } from './orchestrator'
import { ensureMcpServersReady, getAvailableMcpTools, getMcpServerConfigsForCli, servers as mcpServers } from './mcp'
import { requestApproval } from './tools'
import { getAdapter } from './cli-adapters/registry'
import { broadcastToMobile, isMobileInForeground } from './ws-server'
import { sendChatCompleteNotification, generateSpokenSummary } from './fcm-sender'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { HermesAdapter } from './cli-adapters/hermes'
import { getCliModels } from './cli-detection'
import { retrieveAuthMode } from './auth'
import { resolveEffectiveBackend } from './backend-routing'
import { applyRollingContextCompression } from './context-compression'
import { getAgentConfig } from './agents'
import { isFullAutoApprove } from './agentic-policy'
import { buildChatContext, buildStoredAttachments } from './chat-context-builder'
import { parseProjectConfig } from './project-handlers'
import { getWorkingDirectory } from './file-handlers'
import { inferProjectAuditTarget, recordProjectAuditChange } from './project-audit'
import { computeLineDiff } from './remote-edit/fix-agent'
import { dispatchToProvider } from './chat-provider-dispatch'
import type { MobileChatActivity } from './chat-context-builder'
import { debugLog } from './debug-mode'
import { ChatTurnEmitter } from './chat-turn-emitter'
import { endActivity } from './activity-tracker'
import { clearActiveChatTurn } from './active-chat-turns'
import { formatWikiSection, getRelevantWikiEntries } from './wiki-context'

export { clearDirListingCache } from './chat-context-builder'

type ThinkingBlockEntry = { blockId: string; content: string; done: boolean; firstSeenAt: number }

/**
 * Merges fields into a just-saved user message's context_snapshot — the client-side snapshot
 * only records what it *intended* to send, before compression, model routing, or the provider's
 * own tokenizer could tell us what actually happened.
 */
function patchContextSnapshot(
  db: ReturnType<typeof getDatabase>,
  messageId: string | null,
  patch: Record<string, unknown>,
): void {
  if (!messageId) return
  const row = db.prepare('SELECT context_snapshot FROM messages WHERE id = ?').get(messageId) as
    | { context_snapshot: string | null }
    | undefined
  if (!row?.context_snapshot) return
  let snapshot: Record<string, unknown>
  try {
    snapshot = JSON.parse(row.context_snapshot)
  } catch {
    return
  }
  Object.assign(snapshot, patch)
  db.prepare('UPDATE messages SET context_snapshot = ? WHERE id = ?').run(JSON.stringify(snapshot), messageId)
}

function recordServerContextFacts(
  db: ReturnType<typeof getDatabase>,
  messageId: string | null,
  model: string | null,
  compression: { compressedMessageCount: number; retainedMessageCount: number } | null,
): void {
  patchContextSnapshot(db, messageId, { serverModel: model, serverCompression: compression })
}

/** Real, provider-reported token usage for the request this user message triggered. */
function recordServerUsage(
  db: ReturnType<typeof getDatabase>,
  messageId: string | null,
  inputTokens: number,
  outputTokens: number,
): void {
  if (inputTokens <= 0 && outputTokens <= 0) return
  patchContextSnapshot(db, messageId, { serverInputTokens: inputTokens, serverOutputTokens: outputTokens })
}

function persistAssistantMessage(
  db: ReturnType<typeof getDatabase>,
  conversationId: string,
  content: string,
  model: string | null,
  thinkingBlocks?: Map<string, ThinkingBlockEntry>,
  textSegments?: Map<string, ThinkingBlockEntry>,
): string {
  const msgId = randomUUID()
  const thinkingJson = thinkingBlocks && thinkingBlocks.size > 0
    ? JSON.stringify(Array.from(thinkingBlocks.values()))
    : null
  // Only worth persisting when there's more than one segment — a single segment means
  // the response text was never interrupted by a tool call, so there's nothing to
  // re-interleave and `content` alone (already the full text) covers it.
  const textSegmentsJson = textSegments && textSegments.size > 1
    ? JSON.stringify(Array.from(textSegments.values()))
    : null
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model, thinking_blocks, text_segments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(msgId, conversationId, 'assistant', content, null, Date.now(), model, thinkingJson, textSegmentsJson)
  return msgId
}

/** Notifies both Android (full message list, its existing sync shape) and any desktop window
 *  that has this conversation open (a lightweight "refetch if you care" ping — reloadMessages in
 *  useChat.ts already knows how to re-fetch from the DB, no need to duplicate that payload shape
 *  here) that this conversation's messages changed from outside whatever renderer/device
 *  originated the change. Exported for callers outside normal chat dispatch — e.g. a
 *  code-change plan landing while the investigation ran in the background — that also insert
 *  messages directly into the DB and need the same live-refresh. */
export function broadcastConversationMessages(conversationId: string): void {
  const db = getDatabase()
  const rows = db.prepare(
    `SELECT id, role, content, model, attachments, timestamp, thinking_blocks FROM messages
       WHERE conversation_id = ? ORDER BY timeline_order ASC, timestamp ASC, id ASC`,
  ).all(conversationId)
  broadcastToMobile({ event: 'conversation:messages', data: { conversationId, messages: rows } })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('chat:messages-updated', { conversationId })
  }
}

type ChatSendOptions = {
  attachments?: { id: string; name: string; path: string; size: number }[]
  images?: { id: string; name: string; dataUrl: string }[]
  regenerate?: boolean
  agentId?: string
  model?: string
  cliBackend?: 'claude-cli' | 'codex-cli' | 'hermes-cli'
  messageId?: string
  projectId?: string
  contextSnapshot?: string
  displayContent?: string
  toolPolicy?: { preApproved: string[]; alwaysAsk: string[]; neverAllow: string[] }
  thinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null
  fullAutoApproveOverride?: boolean | null
  terminalSandboxOverride?: boolean | null
  cliModeOverride?: string | null
}

type AgentToolPolicy = { enabled?: boolean; approval?: string }
type BuiltInToolKey = 'fileEdit' | 'terminal' | 'webFetch'

const CLAUDE_CLI_BUILT_IN_TOOLS: Array<{
  key: BuiltInToolKey
  label: string
  approvalTool: string
  claudeTools: string[]
  description: string
}> = [
  {
    key: 'fileEdit',
    label: 'File Edit',
    approvalTool: 'claude-cli:fileEdit',
    claudeTools: ['Read', 'Write', 'Edit', 'MultiEdit'],
    description: 'Allow Claude CLI to read and edit files for this message?',
  },
  {
    key: 'terminal',
    label: 'Terminal',
    approvalTool: 'claude-cli:terminal',
    // Claude Code reports its Windows-native shell as PowerShell in current releases;
    // older releases and non-Windows hosts use Bash. Both names must share one policy.
    claudeTools: ['Bash', 'PowerShell'],
    description: 'Allow Claude CLI to run terminal commands for this message?',
  },
  {
    key: 'webFetch',
    label: 'Web Fetch',
    approvalTool: 'claude-cli:webFetch',
    claudeTools: ['WebFetch', 'WebSearch'],
    description: 'Allow Claude CLI to fetch or search web content for this message?',
  },
]

// ---------------------------------------------------------------------------
// Project Audit for CLI-driven file edits (E4.x follow-up)
//
// Claude CLI / Codex CLI edit files directly inside their own subprocess — Nexy never sees the
// write, only the tool_start/tool_end events the adapter surfaces. Unlike BYOK chat's
// write_project_file (chat-context-builder.ts), which records recordProjectAuditChange itself
// at the point of writing, CLI-driven edits used to have no equivalent at all: they rendered as
// a plain ToolCallBlock with no diff, no undo, and no entry in Project Settings -> Changes,
// fragmenting the audit trail depending on which backend a given chat happened to use.
// ---------------------------------------------------------------------------

// Mirrors CLAUDE_CLI_BUILT_IN_TOOLS's own 'fileEdit' entry (Read is excluded — it's not a
// mutation) rather than duplicating the literal list.
const CLAUDE_FILE_EDIT_TOOL_NAMES = new Set(
  CLAUDE_CLI_BUILT_IN_TOOLS.find((t) => t.key === 'fileEdit')!.claudeTools.filter((name) => name !== 'Read'),
)
// Codex's file-editing item types (file_change/patch_apply) reach chat-handlers.ts as this
// human-friendly label — see ITEM_TYPE_LABELS in cli-adapters/codex.ts; extractToolEvent there
// only falls back to it when the raw item has no explicit name/tool_name/tool field, which is
// the normal case for these built-in item types.
const CODEX_FILE_EDIT_TOOL_NAMES = new Set(['Edit File'])

function isFileEditToolCall(backend: 'claude-cli' | 'codex-cli' | 'hermes-cli', toolName: string): boolean {
  if (backend === 'claude-cli') return CLAUDE_FILE_EDIT_TOOL_NAMES.has(toolName)
  if (backend === 'codex-cli') return CODEX_FILE_EDIT_TOOL_NAMES.has(toolName)
  return false
}

function resolveMaybeRelativePath(cwd: string, candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.join(cwd, candidate)
}

// Best-effort: a CLI tool call's input shape isn't a contract Nexy controls. Claude Code's
// Write/Edit/MultiEdit consistently use `file_path`; Codex's file-editing item fields aren't
// pinned down to one exact schema here, so this also checks common alternate field names and
// array-of-edits shapes rather than assuming a single fixed key. Never throws — returns [] when
// nothing recognizable is found, so an unrecognized shape just means that edit silently isn't
// audited (the same as before this existed), not a broken chat turn.
function extractCliEditedPaths(input: Record<string, unknown>, cwd: string): string[] {
  const paths = new Set<string>()
  const addCandidate = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) paths.add(resolveMaybeRelativePath(cwd, value.trim()))
  }
  addCandidate(input.file_path)
  addCandidate(input.path)
  addCandidate(input.filePath)
  for (const key of ['changes', 'edits', 'files']) {
    const entries = input[key]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      addCandidate(record.path)
      addCandidate(record.file_path)
      addCandidate(record.filePath)
    }
  }
  return [...paths]
}

function getClaudeCliToolDefinition(toolName: string): (typeof CLAUDE_CLI_BUILT_IN_TOOLS)[number] | null {
  const normalized = toolName.trim().toLowerCase()
  return CLAUDE_CLI_BUILT_IN_TOOLS.find((tool) =>
    tool.claudeTools.some((candidate) => candidate.toLowerCase() === normalized)
  ) ?? null
}

function getClaudeCliToolPolicies(
  agentConfig: Record<string, unknown> | null,
): Partial<Record<BuiltInToolKey, AgentToolPolicy>> {
  return (agentConfig?.tools && typeof agentConfig.tools === 'object'
    ? agentConfig.tools
    : {}) as Partial<Record<BuiltInToolKey, AgentToolPolicy>>
}

function getClaudeCliGlobalToolPreference(approvalTool: string): string | null {
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(`tool_pref:${approvalTool}`) as { value: string } | undefined
  return row?.value ?? null
}

function rememberClaudeCliAgentTool(agentId: string, key: BuiltInToolKey): void {
  const current = getAgentConfig(agentId)
  if (!current) return
  const currentTools = (current.tools && typeof current.tools === 'object'
    ? current.tools
    : {}) as Record<string, unknown>
  const updatedConfig = {
    ...current,
    tools: {
      ...currentTools,
      [key]: { ...(currentTools[key] as object ?? {}), enabled: true, approval: 'auto' },
    },
  }
  getDatabase()
    .prepare('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(updatedConfig), Date.now(), agentId)
}

function getClaudeCliAllowedBuiltInTools(
  agentConfig: Record<string, unknown> | null,
  agentId: string | null,
  autoApprove = false,
): string[] {
  const tools = getClaudeCliToolPolicies(agentConfig)
  const allowedTools: string[] = []

  for (const tool of CLAUDE_CLI_BUILT_IN_TOOLS) {
    const policy = tools[tool.key]
    if (policy?.enabled === false) continue
    if (autoApprove || (policy?.enabled === true && policy.approval === 'auto')) {
      allowedTools.push(...tool.claudeTools)
      continue
    }
    // A remembered choice on an unconfigured/default chat is the equivalent of an
    // agent's approval=auto policy. Otherwise omit the tool from --allowedTools so the
    // CLI's PermissionRequest hook can ask at the exact moment it is attempted.
    if (!agentId && getClaudeCliGlobalToolPreference(tool.approvalTool) === 'always_allow') {
      allowedTools.push(...tool.claudeTools)
    }
  }

  return allowedTools
}

async function requestClaudeCliToolPermission(
  window: BrowserWindow,
  agentConfig: Record<string, unknown> | null,
  agentId: string | null,
  sendActivity: (activity: MobileChatActivity) => void,
  autoApprove: boolean,
  toolName: string,
  input: Record<string, unknown>,
): Promise<boolean> {
  const tool = getClaudeCliToolDefinition(toolName)
  if (!tool) {
    sendActivity({ state: 'approval', label: `Waiting for ${toolName} approval`, toolName })
    return requestApproval(
      window.webContents,
      `claude-cli:${toolName}`,
      input,
      `Allow Claude CLI to use ${toolName}?`,
    )
  }

  const policy = getClaudeCliToolPolicies(agentConfig)[tool.key]
  if (policy?.enabled === false || policy?.approval === 'disabled') return false
  if (autoApprove || (policy?.enabled === true && policy.approval === 'auto')) return true
  if (!agentId) {
    const preference = getClaudeCliGlobalToolPreference(tool.approvalTool)
    if (preference === 'always_allow') return true
    if (preference === 'always_deny') return false
  }

  sendActivity({ state: 'approval', label: `Waiting for ${tool.label} approval`, toolName: tool.label })
  return requestApproval(
    window.webContents,
    tool.approvalTool,
    input,
    tool.description,
    agentId
      ? {
          onRemember: (wasApproved) => {
            if (wasApproved) rememberClaudeCliAgentTool(agentId, tool.key)
          },
        }
      : undefined,
  )
}

export async function dispatchChatSend(
  window: BrowserWindow,
  conversationId: string,
  content: string,
  options?: ChatSendOptions,
): Promise<{ assistantMsgId: string } | null> {
  const db = getDatabase()

  const turnEmitter = new ChatTurnEmitter(conversationId, {
    sendDesktop: (channel, ...args) => {
      if (!window.webContents.isDestroyed()) window.webContents.send(channel, ...args)
    },
    broadcastMobile: broadcastToMobile,
  })
  turnEmitter.started()

  const sendActivity = (activity: MobileChatActivity) => {
    turnEmitter.activity(activity)
  }
  const sendChunk = (chunk: string, blockId?: string) => {
    turnEmitter.assistantTextDelta(chunk, blockId)
  }
  const sendStreamEnd = () => {
    turnEmitter.streamEnd()
    clearActiveChatTurn(conversationId, turnEmitter.turnId)
    sendActivity({ state: 'complete', label: 'Complete' })
    const db = getDatabase()
    const convRow = db.prepare('SELECT title, project_id FROM conversations WHERE id = ?').get(conversationId) as { title: string; project_id: string | null } | undefined
    const convTitle = convRow?.title ?? 'Chat'
    const projectId = convRow?.project_id ?? null
    if (!isMobileInForeground()) {
      void (async () => {
        const summary = await generateSpokenSummary(db, conversationId, projectId)
        void sendChatCompleteNotification(db, { conversationId, title: convTitle, summary: summary ?? undefined })
      })()
    }
  }

  // Wraps the entire dispatch body as a last-resort safety net. Most branches below
  // already have their own try/catch around the specific provider/CLI/orchestration call
  // (recoverable, expected failures with tailored error messages) — but the setup code
  // between here and the first of those inner try blocks (DB writes, buildChatContext's
  // file/git/wiki I/O, agent/model resolution) runs completely unguarded. An unexpected
  // throw there used to propagate straight out of dispatchChatSend, skipping every
  // turnEmitter.closeStream()/sendStreamEnd() call — which leaves the chat's background
  // activity entry (registered by turnEmitter.started() above) stuck "active" forever,
  // since nothing else ever clears it. This outer catch guarantees cleanup regardless of
  // where in the function something goes wrong.
  //
  // The `finally` below is a second, independent guarantee on top of that: rather than
  // relying on every branch (CLI success, CLI error, BYOK success, BYOK error, orchestration
  // success, orchestration error, and this outer catch) to each remember to clear the
  // sidebar's "Assistant is responding…" entry via sendStreamEnd()/closeStream(), it
  // unconditionally clears it once this function actually settles — so a future branch that
  // forgets, or any path not yet covered, can't leave it stuck. endActivity() is a no-op if
  // the entry was already cleared by one of those branches, so this is safe to call twice.
  try {
  const attachments = options?.attachments
  const pastedImages = options?.images ?? []
  const regenerate = options?.regenerate === true
  const agentId = options?.agentId
  const modelOverride = options?.model
  const cliBackend = options?.cliBackend
  const projectId = options?.projectId
  const contextSnapshot = options?.contextSnapshot ?? null
  const toolPolicy = options?.toolPolicy ?? null
  let newUserMsgId: string | null = null

  debugLog('chat', `dispatch: conv=${conversationId} agent=${agentId ?? 'none'} regenerate=${regenerate} cliBackend=${cliBackend ?? 'none'} model=${options?.model ?? 'default'} content="${content.slice(0, 60)}${content.length > 60 ? '…' : ''}"`)
  sendActivity({ state: 'thinking', label: 'Preparing context' })

  if (!regenerate) {
    const convo = db
      .prepare('SELECT id FROM conversations WHERE id = ?')
      .get(conversationId) as { id: string } | undefined

    if (!convo) {
      const now = Date.now()
      const title = content.slice(0, 80) + (content.length > 80 ? '...' : '')
      const validProjectId = projectId
        ? ((db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId) as { id: string } | undefined)
            ? projectId
            : null)
        : null
      db.prepare(
        'INSERT INTO conversations (id, agent_id, project_id, title, cli_backend, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(conversationId, agentId ?? null, validProjectId, title, cliBackend ?? null, now, now)

      if (options?.thinkingEffortOverride !== undefined && options.thinkingEffortOverride !== null) {
        db.prepare('UPDATE conversations SET thinking_effort_override = ? WHERE id = ?').run(
          options.thinkingEffortOverride,
          conversationId,
        )
      }
      if (options?.fullAutoApproveOverride !== undefined && options.fullAutoApproveOverride !== null) {
        db.prepare('UPDATE conversations SET full_auto_approve_override = ? WHERE id = ?').run(
          options.fullAutoApproveOverride ? 1 : 0,
          conversationId,
        )
      }
      if (options?.terminalSandboxOverride !== undefined && options.terminalSandboxOverride !== null) {
        db.prepare('UPDATE conversations SET terminal_sandbox_override = ? WHERE id = ?').run(
          options.terminalSandboxOverride ? 1 : 0,
          conversationId,
        )
      }
      if (options?.cliModeOverride !== undefined && options.cliModeOverride !== null) {
        db.prepare('UPDATE conversations SET cli_mode_override = ? WHERE id = ?').run(
          options.cliModeOverride,
          conversationId,
        )
      }
    }

    const userMsgId = options?.messageId ?? randomUUID()
    newUserMsgId = userMsgId
    const storedAttachments = buildStoredAttachments(attachments, pastedImages)
    const attachmentsJson = storedAttachments.length > 0 ? JSON.stringify(storedAttachments) : null
    const persistedUserContent = options?.displayContent ?? content
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, attachments, context_snapshot, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(userMsgId, conversationId, 'user', persistedUserContent, attachmentsJson, contextSnapshot, Date.now(), null)

    const msgCount = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { count: number }
    if (msgCount.count === 1) {
      const title = persistedUserContent.slice(0, 80) + (persistedUserContent.length > 80 ? '...' : '')
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId)
    }
  }

  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), conversationId)

  // Keep the conversation's stored model in sync with the latest explicit selection.
  // conversations.model is the fallback used to resolve (and label) any later message
  // that arrives without its own model override — e.g. the Android companion omitting
  // it. When this only wrote while the column was NULL/'default', the desktop picker
  // and the stored model diverged after the first turn, so fallback messages were
  // generated by and labelled with a stale model. Sync unconditionally instead.
  const requestedModel = options?.model
  if (requestedModel && requestedModel !== 'default') {
    db.prepare('UPDATE conversations SET model = ? WHERE id = ?').run(requestedModel, conversationId)
  }

  // ── Provider resolution ────────────────────────────────────────────────────
  const convRow = db
    .prepare('SELECT agent_id, model, cli_backend, thinking_effort_override, full_auto_approve_override, terminal_sandbox_override, cli_mode_override FROM conversations WHERE id = ?')
    .get(conversationId) as {
      agent_id: string | null
      model: string | null
      cli_backend: string | null
      thinking_effort_override: string | null
      full_auto_approve_override: number | null
      terminal_sandbox_override: number | null
      cli_mode_override: string | null
    } | undefined
  // Auto-heal: if cli_backend is missing but the stored model is a known CLI model, infer and persist it.
  // Skip healing if the model is in the OpenRouter cache — it's a BYOK model, not a CLI one.
  // Reverse-heal: if cli_backend was previously set by mistake for an OpenRouter model, clear it.
  if (convRow && convRow.model) {
    const orModels = getOpenRouterModels()
    const isOpenRouterModel = orModels.includes(convRow.model)
    if (isOpenRouterModel && convRow.cli_backend != null) {
      db.prepare('UPDATE conversations SET cli_backend = NULL WHERE id = ?').run(conversationId)
      convRow.cli_backend = null
      debugLog('chat', `reverse-healed cli_backend cleared for conv=${conversationId} model=${convRow.model} (OpenRouter model)`)
    } else if (!isOpenRouterModel && convRow.cli_backend == null) {
      let healedBackend: 'claude-cli' | 'codex-cli' | 'hermes-cli' | null = null
      if (ClaudeAdapter.isAvailable() && getCliModels('claude-cli').some((m) => m.id === convRow.model)) {
        healedBackend = 'claude-cli'
      } else if (CodexAdapter.isAvailable() && getCliModels('codex-cli').some((m) => m.id === convRow.model)) {
        healedBackend = 'codex-cli'
      } else if (HermesAdapter.isAvailable() && getCliModels('hermes-cli').some((m) => m.id === convRow.model)) {
        healedBackend = 'hermes-cli'
      }
      if (healedBackend) {
        db.prepare('UPDATE conversations SET cli_backend = ? WHERE id = ?').run(healedBackend, conversationId)
        convRow.cli_backend = healedBackend
        debugLog('chat', `auto-healed cli_backend=${healedBackend} for conv=${conversationId} model=${convRow.model}`)
      }
    }
  }
  const settingsRows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('default_model', 'temperature', 'max_tokens')")
    .all() as Array<{ key: string; value: string }>
  const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]))
  const defaultModel = settingsMap.get('default_model') || 'default'
  const temperatureSetting = Number.parseFloat(settingsMap.get('temperature') ?? '')
  const maxTokensSetting = Number.parseInt(settingsMap.get('max_tokens') ?? '', 10)
  const effectiveAgentId = agentId ?? convRow?.agent_id ?? null
  const agentCfg2 = effectiveAgentId ? getAgentConfig(effectiveAgentId) : null
  const effectiveFullAutoApprove =
    convRow?.full_auto_approve_override === 1 ? true
    : convRow?.full_auto_approve_override === 0 ? false
    : (agentCfg2 ? isFullAutoApprove(agentCfg2) : false)
  const terminalSandboxProjectId =
    projectId ??
    (db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId) as { project_id: string | null } | undefined)?.project_id ??
    null
  const terminalSandboxProjectRow = terminalSandboxProjectId
    ? (db.prepare('SELECT config_json FROM projects WHERE id = ?').get(terminalSandboxProjectId) as { config_json: string | null } | undefined)
    : undefined
  const terminalSandboxProjectDefault = terminalSandboxProjectRow
    ? parseProjectConfig(terminalSandboxProjectRow.config_json ?? null).terminalSandboxBypass
    : false
  const effectiveTerminalSandboxBypass =
    convRow?.terminal_sandbox_override === 1 ? true
    : convRow?.terminal_sandbox_override === 0 ? false
    : terminalSandboxProjectDefault
  const generationOptions = {
    temperature: Number.isFinite(temperatureSetting) ? Math.min(2, Math.max(0, temperatureSetting)) : 0.7,
    maxTokens: Number.isFinite(maxTokensSetting) ? Math.min(16384, Math.max(256, maxTokensSetting)) : 4096,
    thinkingEffort: (convRow?.thinking_effort_override ?? agentCfg2?.thinkingEffort) as string | undefined,
  }
  const agenticMode = agentCfg2?.agenticMode === true
  const conversationModel = typeof convRow?.model === 'string' ? convRow.model : undefined
  const selectedModel =
    modelOverride && modelOverride !== 'default'
      ? modelOverride
      : conversationModel && conversationModel !== 'default'
        ? conversationModel
        : defaultModel !== 'default'
          ? defaultModel
          : DEFAULT_PROVIDER_MODEL
  const { provider: providerName, model: providerModel } = getProviderForAgent(selectedModel)
  debugLog('chat', `model resolved: selectedModel=${selectedModel} provider=${providerName} providerModel=${providerModel} agent=${effectiveAgentId ?? 'none'}`)
  const modelIdentityInstruction =
    `Runtime model for this conversation: ${selectedModel}. ` +
    'If the user asks which model or language model is running this chat, answer with this exact value.'

  // ── Context augmentation ───────────────────────────────────────────────────
  const {
    augmentedContent,
    attachedImages,
    injectedRootDirectory,
    wikiProjectId,
    wikiToolDefs,
    wikiInlineHandlers,
    fileToolDefs,
    fileInlineHandlers,
  } = await buildChatContext(
      db,
      conversationId,
      content,
      { attachments, images: pastedImages, agentId, projectId, conversationModel, fullAutoApprove: effectiveFullAutoApprove, terminalSandboxBypass: effectiveTerminalSandboxBypass },
      window.webContents,
      sendActivity,
    )

  // ── Multi-agent orchestration ──────────────────────────────────────────────
  const orchProjectId = projectId ?? convRow
    ? (db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId) as { project_id: string | null } | undefined)
    : undefined
  const orchProjId =
    projectId ??
    (orchProjectId as { project_id?: string | null } | undefined)?.project_id ??
    null

  if (orchProjId) {
    const projRow = db
      .prepare('SELECT name, config_json FROM projects WHERE id = ?')
      .get(orchProjId) as { name: string; config_json: string | null } | undefined
    const projConfig = projRow?.config_json
      ? (() => {
          try {
            return JSON.parse(projRow.config_json) as Record<string, unknown>
          } catch {
            return {}
          }
        })()
      : {}
    const agentBackendForOrch = typeof agentCfg2?.backend === 'string' ? agentCfg2.backend : null
    const effectiveCli = cliBackend ?? convRow?.cli_backend ?? agentBackendForOrch
    const orchEnabled = projConfig.workflowMode === 'orchestrated' && !effectiveCli

    if (orchEnabled) {
      const agentRows = db
        .prepare(
          'SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC',
        )
        .all(orchProjId) as {
        agent_id: string
        is_primary: number
        sort_order: number
        config_json: string
      }[]

      const primaryRow = agentRows.find((r) => r.is_primary === 1)

      if (primaryRow && agentRows.length >= 2) {
        debugLog('chat', `orchestration: project=${orchProjId} leader=${primaryRow.agent_id} teamSize=${agentRows.length} maxDepth=${typeof projConfig.maxDelegationDepth === 'number' ? projConfig.maxDelegationDepth : 5}`)
        const teamAgents: OrchestratorAgent[] = agentRows.map((r) => {
          const cfg = (() => {
            try {
              return JSON.parse(r.config_json) as Record<string, unknown>
            } catch {
              return {}
            }
          })()
          return {
            agentId: r.agent_id,
            agentName: typeof cfg.name === 'string' ? cfg.name : 'Agent',
            agentIcon: typeof cfg.icon === 'string' ? cfg.icon : '🤖',
            isPrimary: r.is_primary === 1,
            sortOrder: r.sort_order,
          }
        })

        const maxDepth =
          typeof projConfig.maxDelegationDepth === 'number' ? projConfig.maxDelegationDepth : 5
        const showActivity = projConfig.showTeamActivity !== false

        const buildVisionUserContent = (): MessageContentPart[] => {
          const parts: MessageContentPart[] = [{ type: 'text', text: augmentedContent }]
          for (const img of attachedImages) {
            parts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
          }
          return parts
        }
        const userContent: ProviderMessage['content'] =
          attachedImages.length > 0 ? buildVisionUserContent() : augmentedContent

        let orchResult: { finalContent: string; teamActivity: import('./orchestrator').TeamActivityStep[] }
        try {
          orchResult = await runOrchestration(
            {
              projectId: orchProjId,
              projectName: projRow?.name ?? 'Project',
              leaderAgentId: primaryRow.agent_id,
              teamAgents,
              conversationId,
              window,
              selectedModel: selectedModel ?? 'default',
              generationOptions,
              maxDelegationDepth: maxDepth,
              showActivity,
            },
            userContent,
            [],
          )
        } catch (orchError) {
          const message = orchError instanceof Error ? orchError.message : 'Orchestration failed'
          debugLog('chat', `orchestration error: ${message}`)
          turnEmitter.streamError({
            type: 'api',
            message,
            retryable: message !== NO_PROVIDER_CONFIGURED_MESSAGE,
          })
          sendActivity({ state: 'error', label: message })
          turnEmitter.closeStream()
          const errMsgId = persistAssistantMessage(db, conversationId, message, selectedModel ?? null)
          broadcastConversationMessages(conversationId)
          return { assistantMsgId: errMsgId }
        }

        const { finalContent, teamActivity } = orchResult

        if (showActivity && teamActivity.length > 0) {
          const activityMsgId = randomUUID()
          db.prepare(
            'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).run(
            activityMsgId,
            conversationId,
            'team-activity',
            JSON.stringify({ steps: teamActivity }),
            null,
            Date.now() - 1,
            selectedModel ?? null,
          )
        }

        if (teamActivity.length > 0) {
          const insertDelegation = db.prepare(
            'INSERT INTO agent_delegations (id, conversation_id, leader_agent_id, specialist_agent_id, task, result, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          for (const step of teamActivity) {
            insertDelegation.run(
              step.stepId,
              conversationId,
              primaryRow.agent_id,
              step.agentId,
              step.task,
              step.result ?? null,
              step.status === 'error' ? 'error' : 'done',
              step.durationMs ?? null,
              Date.now(),
            )
          }
        }

        const responseContent = finalContent
        const assistantMsgId = persistAssistantMessage(db, conversationId, responseContent, selectedModel ?? null)
        broadcastConversationMessages(conversationId)
        sendStreamEnd()
        return { assistantMsgId }
      }
    }
  }

  // ── CLI backend dispatch ───────────────────────────────────────────────────
  const agentBackend = typeof agentCfg2?.backend === 'string' ? agentCfg2.backend : undefined
  const assignedAgentMcpServerIds = Array.isArray(agentCfg2?.mcpServers)
    ? (agentCfg2.mcpServers as string[])
    : []
  const agentHasAssignedMcpServers = assignedAgentMcpServerIds.length > 0
  const byokKeyForModel = getApiKey(providerName)
  const fallbackCliBackend = resolveEffectiveBackend({
    cliBackend,
    agentBackend,
    convCliBackend: convRow?.cli_backend,
    selectedModel,
    providerName,
  })
  const effectiveBackend = fallbackCliBackend ?? agentBackend
  debugLog('chat', `routing: authMode=${retrieveAuthMode()} byokKey=${byokKeyForModel ? 'yes' : 'no'} agentBackend=${agentBackend ?? 'none'} fallbackCli=${fallbackCliBackend ?? 'none'} effectiveBackend=${effectiveBackend ?? 'byok'}`)

  if (effectiveBackend) {
    const adapter = getAdapter(effectiveBackend)
    if (adapter?.isAvailable()) {
      const cliSystemPrompt =
        typeof agentCfg2?.systemPrompt === 'string' && agentCfg2.systemPrompt.trim().length > 0
          ? agentCfg2.systemPrompt
          : undefined

      const historyRows = db
        .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timeline_order ASC, timestamp ASC, id ASC')
        .all(conversationId) as { role: string; content: string }[]
      const historyMessages = historyRows.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
      const providerHistoryMessages = historyMessages.filter(
        (m) => m.role !== 'team-activity' && m.role !== 'tool-call',
      ) as ProviderMessage[]
      const contextMessages: ProviderMessage[] =
        regenerate && providerHistoryMessages.length > 0
          ? providerHistoryMessages.slice(0, -1)
          : providerHistoryMessages
      const compressedContext = applyRollingContextCompression(
        db,
        conversationId,
        contextMessages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        selectedModel ?? null,
      )
      recordServerContextFacts(db, newUserMsgId, selectedModel ?? null, compressedContext.summary && {
        compressedMessageCount: compressedContext.summary.compressedMessageCount,
        retainedMessageCount: compressedContext.summary.retainedMessageCount,
      })
      const effectiveContextMessages = compressedContext.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })) as ProviderMessage[]

      const historyTurns = effectiveContextMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
        .map((m) => {
          const label =
            m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System context'
          const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          return `${label}: ${text}`
        })

      let cliUserContent = augmentedContent
      if (historyTurns.length > 0) {
        cliUserContent = `[Prior conversation — for context only, do not repeat]\n${historyTurns.join('\n\n')}\n\n[Current message]\n${augmentedContent}`
      }
      const availableCodexModels = effectiveBackend === 'codex-cli' ? getCliModels('codex-cli') : []
      // Per-conversation override (conversationModel) takes priority over the agent's default
      // cliModel so users can switch models within a backend for a single conversation.
      const requestedCliModel = (modelOverride || conversationModel || agentCfg2?.cliModel || '') as string
      let cliModelForRequest: string
      if (effectiveBackend === 'codex-cli') {
        if (!requestedCliModel) {
          cliModelForRequest = availableCodexModels[0]?.id ?? ''
        } else if (availableCodexModels.some((m) => m.id === requestedCliModel)) {
          cliModelForRequest = requestedCliModel
        } else {
          cliModelForRequest = availableCodexModels[0]?.id ?? ''
        }
      } else {
        cliModelForRequest = requestedCliModel
      }
      const cliMcpServers =
        (effectiveBackend === 'claude-cli' || effectiveBackend === 'codex-cli') &&
        agentHasAssignedMcpServers
          ? getMcpServerConfigsForCli(assignedAgentMcpServerIds)
          : undefined

      type PendingTool = { name: string; input: Record<string, unknown>; startTime: number }
      const pendingTools = new Map<string, PendingTool>()
      const completedToolCalls: Array<PendingTool & { id: string; content: string; isError: boolean }> = []
      const persistCompletedCliToolCalls = () => {
        for (const tc of completedToolCalls.splice(0)) {
          db.prepare(
            'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).run(
            randomUUID(),
            conversationId,
            'tool-call',
            JSON.stringify({
              __type: 'tool-call',
              toolCallId: tc.id,
              toolName: tc.name,
              serverName: effectiveBackend,
              toolArgs: tc.input,
              toolResult: tc.content,
              toolSuccess: !tc.isError,
            }),
            null,
            tc.startTime,
            effectiveBackend,
          )
        }
      }
      const cliThinkingBuffer = new Map<string, ThinkingBlockEntry>()
      // Mirrors cliThinkingBuffer, but for the response text itself — the adapter tags
      // each chunk with which contiguous burst it belongs to (a burst ends whenever a
      // tool call interrupts it), so bursts can be persisted and later re-interleaved
      // with the tool calls that separated them instead of collapsing into one blob.
      const cliTextBuffer = new Map<string, ThinkingBlockEntry>()
      const cliSendChunk = (chunk: string, blockId?: string) => {
        sendChunk(chunk, blockId)
        if (!blockId) return
        const existing = cliTextBuffer.get(blockId) ?? { blockId, content: '', done: false, firstSeenAt: Date.now() }
        cliTextBuffer.set(blockId, { ...existing, content: existing.content + chunk })
      }

      try {
        turnEmitter.model(cliModelForRequest || effectiveBackend)
        sendActivity({ state: 'thinking', label: 'Starting CLI agent' })
        if (cliMcpServers && cliMcpServers.length > 0) {
          sendActivity({ state: 'thinking', label: 'Preparing MCP tools' })
          await ensureMcpServersReady(assignedAgentMcpServerIds)
        }
        // Build the allowed-tools list for the CLI, respecting per-tool and server-level
        // trust settings. Tools whose server is set to 'always-ask' are excluded so the
        // CLI process cannot call them autonomously (it has no approval UI of its own).
        // Build the allowed-tools list for the CLI, respecting per-tool and server-level
        // trust settings. Tools on servers set to 'always-ask' are excluded — the CLI
        // process runs autonomously and has no approval UI. Servers with no remaining
        // allowed tools are also stripped from the mcpServers list so the CLI doesn't
        // connect to them at all (otherwise it connects but then emits its own
        // "permission not granted" message for every tool call attempt).
        const { cliAllowedMcpTools, cliMcpServersFiltered } = await (async () => {
          if (!cliMcpServers || cliMcpServers.length === 0) {
            return { cliAllowedMcpTools: undefined, cliMcpServersFiltered: cliMcpServers }
          }
          const agentIdForTrust = effectiveAgentId ?? 'default'
          const serverTrustRows = db
            .prepare('SELECT server_id, trust FROM agent_mcp_server_trust WHERE agent_id = ?')
            .all(agentIdForTrust) as { server_id: string; trust: string }[]
          const serverTrustMap = new Map(serverTrustRows.map((r) => [r.server_id, r.trust]))

          // For each assigned server, determine if it needs upfront approval. The CLI
          // runs autonomously so we can't pause mid-run — instead we ask once before
          // starting. Approved servers are included; denied servers are excluded entirely.
          const approvedServerIds = new Set<string>()
          const serverIds = [...new Set(
            getAvailableMcpTools(assignedAgentMcpServerIds).map((t) => t.serverId)
          )]
          for (const serverId of serverIds) {
            const server = cliMcpServers.find((s) => s.id === serverId)
            if (!server) continue

            // Determine the effective trust for this server: check if ALL its tools
            // are disabled/blocked, all are auto, or any require approval.
            const serverTools = getAvailableMcpTools(assignedAgentMcpServerIds).filter((t) => t.serverId === serverId)
            let serverNeedsApproval = false
            let serverFullyBlocked = false
            const toolStatuses = serverTools.map((tool) => {
              const override = db
                .prepare('SELECT enabled, approval FROM agent_mcp_tool_overrides WHERE agent_id=? AND server_id=? AND tool_name=?')
                .get(agentIdForTrust, serverId, tool.name) as { enabled: number; approval: string } | undefined
              if (override) {
                if (override.enabled === 0 || override.approval === 'disabled') return 'disabled'
                return override.approval // 'auto' or 'always-ask'
              }
              const serverTrust = serverTrustMap.get(serverId)
              return serverTrust ?? 'always-ask'
            })

            const nonDisabled = toolStatuses.filter((s) => s !== 'disabled')
            if (nonDisabled.length === 0) {
              serverFullyBlocked = true
            } else if (nonDisabled.some((s) => s === 'always-ask')) {
              serverNeedsApproval = true
            }

            if (serverFullyBlocked) continue

            if (serverNeedsApproval) {
              const cliFullAuto = effectiveFullAutoApprove
              const approved = await requestApproval(
                window.webContents,
                `mcp__${server.key}`,
                {},
                `Allow agent to use ${mcpServers.get(serverId)?.config.name ?? server.key} tools for this message?`,
                { noRemember: true, autoApprove: cliFullAuto }
              )
              if (approved) approvedServerIds.add(serverId)
              // denied → server excluded from CLI run
            } else {
              // all tools are 'auto' — include without asking
              approvedServerIds.add(serverId)
            }
          }

          const allowedTools = getAvailableMcpTools(assignedAgentMcpServerIds).flatMap((tool) => {
            if (!approvedServerIds.has(tool.serverId)) return []
            const server = cliMcpServers.find((s) => s.id === tool.serverId)
            if (!server) return []
            const override = db
              .prepare('SELECT enabled, approval FROM agent_mcp_tool_overrides WHERE agent_id=? AND server_id=? AND tool_name=?')
              .get(agentIdForTrust, tool.serverId, tool.name) as { enabled: number; approval: string } | undefined
            if (override && (override.enabled === 0 || override.approval === 'disabled')) return []
            return [`mcp__${server.key}__${tool.name}`]
          })

          const filteredServers = cliMcpServers.filter((s) => approvedServerIds.has(s.id))

          return {
            cliAllowedMcpTools: allowedTools.length > 0 ? allowedTools : undefined,
            cliMcpServersFiltered: filteredServers.length > 0 ? filteredServers : undefined,
          }
        })()
        const cliAllowedBuiltInTools = effectiveBackend === 'claude-cli'
          ? getClaudeCliAllowedBuiltInTools(agentCfg2, effectiveAgentId, effectiveFullAutoApprove)
          : []
        const cliAllowedTools = [...cliAllowedBuiltInTools, ...(cliAllowedMcpTools ?? [])]
        debugLog('chat', `cli-adapter: starting ${effectiveBackend} model=${cliModelForRequest || 'default'} mcpServers=${cliMcpServersFiltered?.length ?? 0} builtInTools=${cliAllowedBuiltInTools.length} mcpTools=${cliAllowedMcpTools?.length ?? 0}`)

        const cliCwd = (() => {
          if (projectId) {
            const row = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(projectId) as { config_json: string | null } | undefined
            const root: string | undefined = row?.config_json ? (JSON.parse(row.config_json) as { rootDirectory?: string }).rootDirectory : undefined
            if (root && existsSync(root)) return root
          }
          const agentRoot: string | undefined = typeof agentCfg2?.rootDirectory === 'string' ? agentCfg2.rootDirectory : undefined
          if (agentRoot && existsSync(agentRoot)) return agentRoot
          return getWorkingDirectory()
        })()
        // Groups every file this CLI turn touches into a single Project Audit session, rather
        // than one session per tool call — mirrors how Code Changes groups an entire apply under
        // one session (remote-edit:<reportId>) instead of fragmenting it per file.
        const cliAuditSessionId = `cli-tool:${conversationId}:${randomUUID()}`
        // Snapshot content BEFORE each edit tool actually runs (tool_start, not tool_end — by
        // tool_end the file is already mutated), keyed by resolved absolute path so it survives
        // multiple tool calls touching the same file within one turn.
        const cliFileContentBeforeEdit = new Map<string, string | null>()
        const recordCliFileEditAudit = (absPath: string, before: string | null) => {
          try {
            if (!existsSync(absPath)) return
            const after = readFileSync(absPath, 'utf8')
            if (before === after) return
            const auditTarget = inferProjectAuditTarget(absPath)
            if (!auditTarget) return
            recordProjectAuditChange({
              sessionId: cliAuditSessionId,
              projectId: auditTarget.projectId,
              conversationId,
              title: `${effectiveBackend === 'claude-cli' ? 'Claude CLI' : effectiveBackend === 'codex-cli' ? 'Codex CLI' : 'Hermes Agent'} edits`,
              source: 'cli-tool',
              relativePath: auditTarget.relativePath,
              status: before === null ? 'created' : 'modified',
              lastOperation: before === null ? 'create' : 'write',
              diff: { hunks: computeLineDiff(before ?? '', after) },
            })
          } catch { /* best-effort audit — never let this break the chat turn */ }
        }

        const cliAbortController = new AbortController()
        activeCliAbortControllers.set(conversationId, cliAbortController)
        const cliResponseContent = await adapter.send(
          window,
          {
            systemPrompt: cliSystemPrompt,
            messages: [{ role: 'user' as const, content: cliUserContent }],
            images: attachedImages.length > 0 ? attachedImages : undefined,
            cwd: cliCwd,
            model: cliModelForRequest,
            conversationId,
            mcpServers: cliMcpServersFiltered,
            allowedTools: cliAllowedTools.length > 0 ? cliAllowedTools : undefined,
            thinkingEffort: (convRow?.thinking_effort_override ?? agentCfg2?.thinkingEffort) as 'low' | 'medium' | 'high' | 'max' | 'disabled' | undefined,
            skipPermissions: effectiveFullAutoApprove,
            permissionMode: (options?.cliModeOverride ?? convRow?.cli_mode_override) ?? undefined,
            extraAllowedDirs: effectiveTerminalSandboxBypass
              ? [path.parse(homedir()).root]
              : undefined,
            requestPermission: effectiveBackend === 'claude-cli'
              ? (toolName, input) => requestClaudeCliToolPermission(
                  window,
                  agentCfg2,
                  effectiveAgentId,
                  sendActivity,
                  effectiveFullAutoApprove,
                  toolName,
                  input,
                )
              : undefined,
          },
          cliSendChunk,
          (event) => {
            if (window.webContents.isDestroyed()) return
            if (event.type === 'tool_start') {
              debugLog('chat', `cli-tool-start: id=${event.id} name=${event.name}`)
              pendingTools.set(event.id, { name: event.name, input: event.input, startTime: Date.now() })
              if (isFileEditToolCall(effectiveBackend as 'claude-cli' | 'codex-cli' | 'hermes-cli', event.name)) {
                for (const absPath of extractCliEditedPaths(event.input as Record<string, unknown>, cliCwd)) {
                  if (!cliFileContentBeforeEdit.has(absPath)) {
                    cliFileContentBeforeEdit.set(absPath, existsSync(absPath) ? readFileSync(absPath, 'utf8') : null)
                  }
                }
              }
              turnEmitter.cliToolStart(event.id, event.name, event.input as Record<string, unknown>)
              sendActivity({
                state: 'tool',
                label: `Running ${event.name}`,
                toolName: event.name,
                serverName: effectiveBackend,
              })
            } else if (event.type === 'tool_end') {
              debugLog('chat', `cli-tool-end: id=${event.id} isError=${event.isError} resultLen=${event.content.length}`)
              const pending = pendingTools.get(event.id)
              if (pending) {
                completedToolCalls.push({ id: event.id, ...pending, content: event.content, isError: event.isError })
                pendingTools.delete(event.id)
                if (!event.isError && isFileEditToolCall(effectiveBackend as 'claude-cli' | 'codex-cli' | 'hermes-cli', pending.name)) {
                  for (const absPath of extractCliEditedPaths(pending.input, cliCwd)) {
                    recordCliFileEditAudit(absPath, cliFileContentBeforeEdit.get(absPath) ?? null)
                  }
                }
              }
              turnEmitter.cliToolEnd(event.id, event.content, event.isError, pending ? {
                name: pending.name,
                input: pending.input as Record<string, unknown>,
                serverName: effectiveBackend,
              } : undefined)
              sendActivity({ state: 'thinking', label: 'Processing tool result' })
            } else if (event.type === 'cost') {
              turnEmitter.cost(event.inputTokens, event.outputTokens, event.totalCostUsd)
              recordServerUsage(db, newUserMsgId, event.inputTokens, event.outputTokens)
            } else if (event.type === 'thinking_chunk') {
              turnEmitter.thinkingDelta(event.blockId, event.chunk)
              const existing = cliThinkingBuffer.get(event.blockId) ?? { blockId: event.blockId, content: '', done: false, firstSeenAt: Date.now() }
              cliThinkingBuffer.set(event.blockId, { ...existing, content: existing.content + event.chunk })
            } else if (event.type === 'thinking_end') {
              turnEmitter.thinkingEnd(event.blockId)
              const existing = cliThinkingBuffer.get(event.blockId)
              if (existing) cliThinkingBuffer.set(event.blockId, { ...existing, done: true })
            } else if (event.type === 'text_end') {
              turnEmitter.textSegmentDone(event.blockId)
              const existing = cliTextBuffer.get(event.blockId)
              if (existing) cliTextBuffer.set(event.blockId, { ...existing, done: true })
            } else if (event.type === 'activity') {
              sendActivity({ state: 'thinking', label: event.label })
            }
          },
          cliAbortController.signal,
        )
        activeCliAbortControllers.delete(conversationId)

        debugLog('chat', `cli-adapter: stream done toolCallsPersisted=${completedToolCalls.length} thinkingBlocks=${cliThinkingBuffer.size}`)
        persistCompletedCliToolCalls()
        const assistantMsgId = persistAssistantMessage(
          db, conversationId, cliResponseContent,
          (cliModelForRequest || null) as string | null,
          cliThinkingBuffer,
          cliTextBuffer,
        )
        broadcastConversationMessages(conversationId)
        sendStreamEnd()
        return { assistantMsgId }
      } catch (err) {
        debugLog('chat', `cli-adapter error: ${effectiveBackend} failed — ${err instanceof Error ? err.message : String(err)}`)
        console.error(`[chat] cli-adapter ${effectiveBackend} failed:`, err)
        persistCompletedCliToolCalls()
        const message = err instanceof Error ? err.message : 'CLI backend failed'
        for (const [blockId, block] of cliThinkingBuffer) {
          if (!block.done) {
            cliThinkingBuffer.set(blockId, { ...block, done: true })
            turnEmitter.thinkingEnd(blockId)
          }
        }
        turnEmitter.streamError({ type: 'api', message, retryable: true })
        sendActivity({ state: 'error', label: message })
        turnEmitter.closeStream()
        const assistantMsgId = persistAssistantMessage(
          db, conversationId, message, effectiveBackend, cliThinkingBuffer,
        )
        return { assistantMsgId }
      }
    }
  }

  // ── BYOK provider dispatch ─────────────────────────────────────────────────
  const byokKey = byokKeyForModel

  const historyRows = db
    .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timeline_order ASC, timestamp ASC, id ASC')
    .all(conversationId) as { role: string; content: string }[]
  const historyMessages = historyRows.slice(0, -1).map((m) => ({ role: m.role, content: m.content }))
  const providerHistoryMessages = historyMessages.filter(
    (m) => m.role !== 'team-activity' && m.role !== 'tool-call',
  ) as ProviderMessage[]
  const contextMessages: ProviderMessage[] =
    regenerate && providerHistoryMessages.length > 0
      ? providerHistoryMessages.slice(0, -1)
      : providerHistoryMessages
  const compressedContext = applyRollingContextCompression(
    db,
    conversationId,
    contextMessages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    selectedModel ?? null,
  )
  recordServerContextFacts(db, newUserMsgId, selectedModel ?? null, compressedContext.summary && {
    compressedMessageCount: compressedContext.summary.compressedMessageCount,
    retainedMessageCount: compressedContext.summary.retainedMessageCount,
  })
  const effectiveContextMessages = compressedContext.messages.map((m) => ({
    role: m.role,
    content: m.content,
  })) as ProviderMessage[]

  // CCMP.7: inject relevant wiki entries into restored context after compression
  if (compressedContext.summary !== null && wikiProjectId && effectiveContextMessages.length > 0) {
    const ss = compressedContext.summary.structuredSummary
    const wikiSearchQuery = [...ss.goals, ...ss.filesTouched, ...ss.decisions].join(' ')
    const wikiEntries = getRelevantWikiEntries(db, wikiProjectId, wikiSearchQuery, 3)
    if (wikiEntries.length > 0) {
      effectiveContextMessages[0] = {
        ...effectiveContextMessages[0],
        content: `${effectiveContextMessages[0].content}\n\n${formatWikiSection(wikiEntries)}`,
      }
    }
  }

  const buildVisionUserContent = (): MessageContentPart[] => {
    const parts: MessageContentPart[] = [{ type: 'text', text: augmentedContent }]
    for (const img of attachedImages) {
      parts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
    }
    return parts
  }
  const userContent: ProviderMessage['content'] =
    attachedImages.length > 0 ? buildVisionUserContent() : augmentedContent

  const agentSystemPrompt =
    typeof agentCfg2?.systemPrompt === 'string' ? agentCfg2.systemPrompt : undefined
  const contextBoundaryNote =
    '\n\nProject/context blocks in the user message, including [Project Context], [Project Scope], [Project File Structure], and [Project Wiki], are reference material only. Use them to answer the current request, but never reproduce, dump, summarize as raw metadata, or quote these blocks unless the user explicitly asks to inspect the context itself.'
  const rootDirNote = injectedRootDirectory
    ? `\n\nThe user's project root directory (${injectedRootDirectory}) has been scanned and its file tree is provided in the user message within [Project File Structure] tags. Treat it as real file system data — do NOT say you cannot access the file system.`
    : ''
  const systemPrompt = agentSystemPrompt
    ? `${agentSystemPrompt}${contextBoundaryNote}${rootDirNote}\n\n${modelIdentityInstruction}`
    : `You are an AI programming assistant.${contextBoundaryNote}${rootDirNote}\n\n${modelIdentityInstruction}`

  const chatMessages: ProviderMessage[] = [
    { role: 'system' as const, content: systemPrompt },
    ...effectiveContextMessages,
    { role: 'user' as const, content: userContent },
  ]

  const assignedServerIds = Array.isArray(agentCfg2?.mcpServers) ? (agentCfg2.mcpServers as string[]) : []
  if (assignedServerIds.length > 0) {
    sendActivity({ state: 'thinking', label: 'Preparing MCP tools' })
    await ensureMcpServersReady(assignedServerIds)
  }
  const mcpTools = assignedServerIds.length > 0 ? getAvailableMcpTools(assignedServerIds) : []
  if (assignedServerIds.length > 0 && mcpTools.length === 0) {
    throw new Error(
      'Assigned MCP server has no available tools. Restart the MCP server from Settings > MCP Servers and try again.',
    )
  }
  const toolMap = new Map<string, { serverId: string; toolName: string }>()
  const toolDefs = mcpTools.map((t) => {
    const namespacedName = `${t.serverId}__${t.name}`
    toolMap.set(namespacedName, { serverId: t.serverId, toolName: t.name })
    return {
      type: 'function' as const,
      function: {
        name: namespacedName,
        description: t.description ?? t.name,
        parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      },
    }
  })
  toolDefs.push(...wikiToolDefs, ...fileToolDefs)

  const inlineHandlers = new Map([...wikiInlineHandlers, ...fileInlineHandlers])

  const hasMcpTools = mcpTools.length > 0
  const hasWikiTools = wikiToolDefs.length > 0
  const hasFileTools = fileToolDefs.length > 0
  const browserDirective = hasMcpTools
    ? `You have browser automation tools available: ${mcpTools.map((t) => t.name).join(', ')}. ` +
      "CRITICAL: Only use these tools when the user's request explicitly requires interacting with a web browser or web page. " +
      'For conversational questions, general knowledge, or anything that does not require a browser, respond directly WITHOUT calling any tools. ' +
      'When a browser task IS required, call the tools immediately and completely — do NOT say you "will" do something, just do it. ' +
      'After any inspection step (e.g. browser_snapshot), take the next required action immediately — do NOT narrate your findings before acting. ' +
      'Continue calling tools until the task is fully finished, then give a brief summary.'
    : ''
  const wikiDirective = hasWikiTools
    ? 'You have access to the project wiki tools: search_project_wiki and create_wiki_entry. ' +
      'Use search_project_wiki when the user asks about project-specific knowledge, decisions, or procedures. ' +
      'Use create_wiki_entry only when the user explicitly asks to save something to the wiki — it always requires user approval. ' +
      'For all other questions, respond directly without calling any tools.'
    : ''
  const fileDirective = hasFileTools
    ? 'You have access to read_project_file and write_project_file tools, scoped to the project root directory. ' +
      'When the user asks you to create, edit, or inspect a file in the project, immediately call the tool in the same turn — never respond with text asking permission first, and never claim you lack file access or that a prior write happened without approval. ' +
      'There is no separate approval step for you to perform: calling write_project_file IS the entire action. Do not describe, narrate, or ask about it beforehand.'
    : ''
  const toolDirective = [browserDirective, wikiDirective, fileDirective].filter(Boolean).join('\n\n')

  // Heuristic: when the user's message clearly asks for a file operation and file tools are
  // available, force the model to call a tool on the first iteration instead of leaving
  // toolChoice='auto' — small models otherwise tend to ask for permission in chat text rather
  // than invoking write_project_file, since a soft system-prompt directive alone doesn't compel
  // a tool call. Scoped narrowly to file-shaped requests so unrelated questions aren't affected.
  const looksLikeFileIntent =
    /\b(create|write|save|edit|update|make)\b[^.?!]{0,60}\.\w{1,8}\b/i.test(content) ||
    /\bfile\s+(called|named)\b/i.test(content)
  const forceFirstToolChoice = hasFileTools && looksLikeFileIntent

  let capturedStreamModel: string | null = null
  const handleStreamModel = (m: string) => {
    capturedStreamModel = m
    turnEmitter.model(m)
  }

  const byokThinkingBuffer = new Map<string, ThinkingBlockEntry>()

  let responseContent: string
  let completionActivity: MobileChatActivity = { state: 'complete', label: 'Complete' }

  try {
    debugLog('chat', `byok: dispatching to ${providerName}/${providerModel} mcpTools=${mcpTools.length} wikiTools=${wikiToolDefs.length} contextMsgs=${effectiveContextMessages.length}`)
    sendActivity({ state: 'thinking', label: 'Contacting model' })

    if (!byokKey) {
      throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE)
    }

    responseContent = await dispatchToProvider({
      providerName,
      providerModel,
      byokKey,
      chatMessages,
      toolDefs,
      toolMap,
      effectiveAgentId,
      agenticMode,
      wikiInlineHandlers: inlineHandlers,
      toolDirective,
      generationOptions,
      conversationId,
      webContents: window.webContents,
      sendChunk,
      sendActivity,
      onModel: handleStreamModel,
      onUsage: (usage) => recordServerUsage(db, newUserMsgId, usage.inputTokens, usage.outputTokens),
      systemPrompt,
      toolPolicy: toolPolicy ?? undefined,
      fullAutoApprove: effectiveFullAutoApprove,
      forceFirstToolChoice,
      onThinkingChunk: (blockId, chunk) => {
        const existing = byokThinkingBuffer.get(blockId) ?? { blockId, content: '', done: false, firstSeenAt: Date.now() }
        byokThinkingBuffer.set(blockId, { ...existing, content: existing.content + chunk })
        turnEmitter.thinkingDelta(blockId, chunk)
      },
      onThinkingEnd: (blockId) => {
        const existing = byokThinkingBuffer.get(blockId)
        if (existing) byokThinkingBuffer.set(blockId, { ...existing, done: true })
        turnEmitter.thinkingEnd(blockId)
      },
      onToolFinished: (event) => {
        turnEmitter.toolFinished({
          toolName: event.toolName,
          serverName: event.serverName,
          args: event.args,
          result: event.result,
          success: event.success,
          ...(event.resultImages?.length ? { resultImages: event.resultImages } : {}),
        })
      },
    })

    debugLog('chat', `byok: stream complete provider=${providerName} responseLen=${responseContent.length}`)
  } catch (error) {
    debugLog('chat', `byok error: ${providerName} — ${error instanceof Error ? error.message : String(error)}`)
    console.error(`[chat] ${providerName} error:`, error)
    const message = error instanceof Error ? error.message : 'Unexpected provider error'
    turnEmitter.streamError({
      type: 'api',
      message,
      retryable: message !== NO_PROVIDER_CONFIGURED_MESSAGE && message !== 'Azure endpoint not configured',
    })
    responseContent = message
    completionActivity = { state: 'error', label: message }
  }

  const assistantMsgId = persistAssistantMessage(
    db, conversationId, responseContent,
    capturedStreamModel ?? selectedModel ?? null,
    byokThinkingBuffer,
  )

  broadcastConversationMessages(conversationId)

  if (completionActivity.state === 'complete') {
    sendStreamEnd()
  } else {
    sendActivity(completionActivity)
    turnEmitter.closeStream()
  }

  return { assistantMsgId }
  } catch (dispatchError) {
    // Last-resort handler — see the comment at the top of the try block. Anything that
    // reaches here bypassed every branch-specific error path above, so the activity
    // registered by turnEmitter.started() would otherwise never get closed.
    const message = dispatchError instanceof Error ? dispatchError.message : 'Unexpected error'
    console.error('[chat] dispatchChatSend unexpected error:', dispatchError)
    turnEmitter.streamError({ type: 'api', message, retryable: true })
    sendActivity({ state: 'error', label: message })
    turnEmitter.closeStream()
    const assistantMsgId = persistAssistantMessage(db, conversationId, message, null)
    broadcastConversationMessages(conversationId)
    return { assistantMsgId }
  } finally {
    endActivity(`chat:${conversationId}`)
  }
}

export function registerChatHandlers(): void {
  safeHandle(
    'chat:send-message',
    async (event, conversationId: string, content: string, options?: ChatSendOptions) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return null
      return dispatchChatSend(window, conversationId, content, options)
    },
  )

  safeHandle('chat:stop-generation', async (_event, conversationId?: string) => {
    abortActiveStream(conversationId)
    return true
  })
}
