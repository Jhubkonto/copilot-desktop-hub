import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getDatabase } from './database'
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getApiKey,
  abortActiveStream,
  type MessageContentPart,
  type ProviderMessage,
} from './providers'
import { activeCliAbortControllers } from './provider-stream-state'
import { safeHandle } from './safe-handle'
import { runOrchestration, type OrchestratorAgent } from './orchestrator'
import { ensureMcpServersReady, getAvailableMcpTools, getMcpServerConfigsForCli, servers as mcpServers } from './mcp'
import { requestApproval } from './tools'
import { getAdapter } from './cli-adapters/registry'
import { broadcastToMobile } from './ws-server'
import { ClaudeAdapter } from './cli-adapters/claude'
import { CodexAdapter } from './cli-adapters/codex'
import { getCliModels } from './cli-detection'
import { retrieveAuthMode } from './auth'
import { applyRollingContextCompression } from './context-compression'
import { getAgentConfig } from './agents'
import { buildChatContext, buildStoredAttachments } from './chat-context-builder'
import { dispatchToProvider } from './chat-provider-dispatch'
import type { MobileChatActivity } from './chat-context-builder'

export { clearDirListingCache } from './chat-context-builder'

type ChatSendOptions = {
  attachments?: { id: string; name: string; path: string; size: number }[]
  images?: { id: string; name: string; dataUrl: string }[]
  regenerate?: boolean
  agentId?: string
  model?: string
  cliBackend?: 'claude-cli' | 'codex-cli'
  messageId?: string
  projectId?: string
  contextSnapshot?: string
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
    claudeTools: ['Bash'],
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

async function getClaudeCliAllowedBuiltInTools(
  window: BrowserWindow,
  agentConfig: Record<string, unknown> | null,
  sendActivity: (activity: MobileChatActivity) => void,
): Promise<string[]> {
  const tools = (agentConfig?.tools && typeof agentConfig.tools === 'object'
    ? agentConfig.tools
    : {}) as Partial<Record<BuiltInToolKey, AgentToolPolicy>>
  const allowedTools: string[] = []

  for (const tool of CLAUDE_CLI_BUILT_IN_TOOLS) {
    const policy = tools[tool.key]
    if (policy?.enabled !== true) continue
    const approval = policy.approval === 'disabled' ? 'always-ask' : policy.approval

    let approved = approval === 'auto'
    if (!approved) {
      sendActivity({ state: 'approval', label: `Waiting for ${tool.label} approval`, toolName: tool.label })
      approved = await requestApproval(
        window.webContents,
        tool.approvalTool,
        {},
        tool.description,
        { noRemember: true },
      )
    }
    if (approved) allowedTools.push(...tool.claudeTools)
  }

  return allowedTools
}

export async function dispatchChatSend(
  window: BrowserWindow,
  conversationId: string,
  content: string,
  options?: ChatSendOptions,
): Promise<{ assistantMsgId: string } | null> {
  const db = getDatabase()

  const sendActivity = (activity: MobileChatActivity) => {
    broadcastToMobile({ event: 'chat:activity', data: { conversationId, ...activity } })
  }
  const sendChunk = (chunk: string) => {
    if (!window.webContents.isDestroyed()) window.webContents.send('chat:stream-response', chunk)
    broadcastToMobile({ event: 'chat:stream-chunk', data: { conversationId, chunk } })
  }
  const sendStreamEnd = () => {
    if (!window.webContents.isDestroyed()) window.webContents.send('chat:stream-response', null)
    broadcastToMobile({ event: 'chat:stream-end', data: { conversationId } })
    sendActivity({ state: 'complete', label: 'Complete' })
  }

  const attachments = options?.attachments
  const pastedImages = options?.images ?? []
  const regenerate = options?.regenerate === true
  const agentId = options?.agentId
  const modelOverride = options?.model
  const cliBackend = options?.cliBackend
  const projectId = options?.projectId
  const contextSnapshot = options?.contextSnapshot ?? null

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
        'INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(conversationId, agentId ?? null, validProjectId, title, now, now)
    }

    const userMsgId = options?.messageId ?? randomUUID()
    const storedAttachments = buildStoredAttachments(attachments, pastedImages)
    const attachmentsJson = storedAttachments.length > 0 ? JSON.stringify(storedAttachments) : null
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, attachments, context_snapshot, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(userMsgId, conversationId, 'user', content, attachmentsJson, contextSnapshot, Date.now(), null)

    const msgCount = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { count: number }
    if (msgCount.count === 1) {
      const title = content.slice(0, 80) + (content.length > 80 ? '...' : '')
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId)
    }
  }

  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), conversationId)

  const requestedModel = options?.model
  if (requestedModel && requestedModel !== 'default') {
    db.prepare(
      "UPDATE conversations SET model = ? WHERE id = ? AND (model IS NULL OR model = 'default')",
    ).run(requestedModel, conversationId)
  }

  // ── Provider resolution ────────────────────────────────────────────────────
  const convRow = db
    .prepare('SELECT agent_id, model FROM conversations WHERE id = ?')
    .get(conversationId) as { agent_id: string | null; model: string | null } | undefined
  const settingsRows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('default_model', 'temperature', 'max_tokens')")
    .all() as Array<{ key: string; value: string }>
  const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]))
  const defaultModel = settingsMap.get('default_model') || 'default'
  const temperatureSetting = Number.parseFloat(settingsMap.get('temperature') ?? '')
  const maxTokensSetting = Number.parseInt(settingsMap.get('max_tokens') ?? '', 10)
  const effectiveAgentId = agentId ?? convRow?.agent_id ?? null
  const agentCfg2 = effectiveAgentId ? getAgentConfig(effectiveAgentId) : null
  const generationOptions = {
    temperature: Number.isFinite(temperatureSetting) ? Math.min(2, Math.max(0, temperatureSetting)) : 0.7,
    maxTokens: Number.isFinite(maxTokensSetting) ? Math.min(16384, Math.max(256, maxTokensSetting)) : 4096,
    thinkingEffort: agentCfg2?.thinkingEffort as string | undefined,
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
  const modelIdentityInstruction =
    `Runtime model for this conversation: ${selectedModel}. ` +
    'If the user asks which model or language model is running this chat, answer with this exact value.'

  // ── Context augmentation ───────────────────────────────────────────────────
  const { augmentedContent, attachedImages, injectedRootDirectory, wikiProjectId, wikiToolDefs, wikiInlineHandlers } =
    await buildChatContext(
      db,
      conversationId,
      content,
      { attachments, images: pastedImages, agentId, projectId, conversationModel },
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
    const orchEnabled = projConfig.orchestrationEnabled === true

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

        const { finalContent, teamActivity } = await runOrchestration(
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
        const assistantMsgId = randomUUID()
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(
          assistantMsgId,
          conversationId,
          'assistant',
          responseContent,
          null,
          Date.now(),
          selectedModel ?? null,
        )
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
  let fallbackCliBackend: 'claude-cli' | 'codex-cli' | undefined
  // An explicit cliBackend request (e.g. from the Android WS path) always wins,
  // regardless of auth mode or BYOK key availability.
  if (cliBackend === 'codex-cli' && CodexAdapter.isAvailable()) {
    fallbackCliBackend = 'codex-cli'
  } else if (cliBackend === 'claude-cli' && ClaudeAdapter.isAvailable()) {
    fallbackCliBackend = 'claude-cli'
  } else if (retrieveAuthMode() === 'none') {
    // No explicit backend — fall back to CLI only when there's no BYOK key.
    if (!byokKeyForModel) {
      if (ClaudeAdapter.isAvailable()) fallbackCliBackend = 'claude-cli'
      else if (CodexAdapter.isAvailable()) fallbackCliBackend = 'codex-cli'
    }
  }
  const effectiveBackend = agentBackend ?? fallbackCliBackend

  if (effectiveBackend) {
    const adapter = getAdapter(effectiveBackend)
    if (adapter?.isAvailable()) {
      const cliSystemPrompt =
        typeof agentCfg2?.systemPrompt === 'string' && agentCfg2.systemPrompt.trim().length > 0
          ? agentCfg2.systemPrompt
          : undefined

      const historyRows = db
        .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
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
        } else if (modelOverride || availableCodexModels.some((m) => m.id === requestedCliModel)) {
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
      const cliThinkingBuffer = new Map<string, { blockId: string; content: string; done: boolean }>()

      try {
        if (!window.webContents.isDestroyed()) {
          window.webContents.send('chat:stream-model', cliModelForRequest || effectiveBackend)
        }
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
              const approved = await requestApproval(
                window.webContents,
                `mcp__${server.key}`,
                {},
                `Allow agent to use ${mcpServers.get(serverId)?.config.name ?? server.key} tools for this message?`,
                { noRemember: true }
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
          ? await getClaudeCliAllowedBuiltInTools(window, agentCfg2, sendActivity)
          : []
        const cliAllowedTools = [...cliAllowedBuiltInTools, ...(cliAllowedMcpTools ?? [])]

        const cliAbortController = new AbortController()
        activeCliAbortControllers.set(conversationId, cliAbortController)
        const cliResponseContent = await adapter.send(
          window,
          {
            systemPrompt: cliSystemPrompt,
            messages: [{ role: 'user' as const, content: cliUserContent }],
            images: attachedImages.length > 0 ? attachedImages : undefined,
            cwd: process.cwd(),
            model: cliModelForRequest,
            conversationId,
            mcpServers: cliMcpServersFiltered,
            allowedTools: cliAllowedTools.length > 0 ? cliAllowedTools : undefined,
            thinkingEffort: agentCfg2?.thinkingEffort as 'low' | 'medium' | 'high' | 'max' | 'disabled' | undefined,
          },
          sendChunk,
          (event) => {
            if (window.webContents.isDestroyed()) return
            if (event.type === 'tool_start') {
              pendingTools.set(event.id, { name: event.name, input: event.input, startTime: Date.now() })
              window.webContents.send('chat:cli-tool-start', { id: event.id, name: event.name, input: event.input })
              sendActivity({
                state: 'tool',
                label: `Running ${event.name}`,
                toolName: event.name,
                serverName: effectiveBackend,
              })
            } else if (event.type === 'tool_end') {
              const pending = pendingTools.get(event.id)
              if (pending) {
                completedToolCalls.push({ id: event.id, ...pending, content: event.content, isError: event.isError })
                pendingTools.delete(event.id)
              }
              window.webContents.send('chat:cli-tool-end', { id: event.id, content: event.content, isError: event.isError })
              sendActivity({ state: 'thinking', label: 'Processing tool result' })
            } else if (event.type === 'cost') {
              window.webContents.send('chat:cli-cost', {
                totalCostUsd: event.totalCostUsd,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
              })
              broadcastToMobile({ event: 'chat:cost', data: { conversationId, inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalCostUsd: event.totalCostUsd } })
            } else if (event.type === 'thinking_chunk') {
              window.webContents.send('chat:thinking-delta', { blockId: event.blockId, chunk: event.chunk })
              broadcastToMobile({ event: 'chat:thinking-delta', data: { conversationId, blockId: event.blockId, chunk: event.chunk } })
              const existing = cliThinkingBuffer.get(event.blockId) ?? { blockId: event.blockId, content: '', done: false }
              cliThinkingBuffer.set(event.blockId, { ...existing, content: existing.content + event.chunk })
            } else if (event.type === 'thinking_end') {
              window.webContents.send('chat:thinking-end', { blockId: event.blockId })
              broadcastToMobile({ event: 'chat:thinking-end', data: { conversationId, blockId: event.blockId } })
              const existing = cliThinkingBuffer.get(event.blockId)
              if (existing) cliThinkingBuffer.set(event.blockId, { ...existing, done: true })
            }
          },
          cliAbortController.signal,
        )
        activeCliAbortControllers.delete(conversationId)

        persistCompletedCliToolCalls()

        const cliThinkingJson = cliThinkingBuffer.size > 0
          ? JSON.stringify(Array.from(cliThinkingBuffer.values()))
          : null

        const assistantMsgId = randomUUID()
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model, thinking_blocks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          assistantMsgId,
          conversationId,
          'assistant',
          cliResponseContent,
          null,
          Date.now(),
          (cliModelForRequest || null) as string | null,
          cliThinkingJson,
        )

        sendStreamEnd()
        return { assistantMsgId }
      } catch (err) {
        console.error(`[cli-adapter] ${effectiveBackend} failed:`, err)
        persistCompletedCliToolCalls()
        const message = err instanceof Error ? err.message : 'CLI backend failed'
        for (const [blockId, block] of cliThinkingBuffer) {
          if (!block.done) {
            cliThinkingBuffer.set(blockId, { ...block, done: true })
            window.webContents.send('chat:thinking-end', { blockId })
            broadcastToMobile({ event: 'chat:thinking-end', data: { conversationId, blockId } })
          }
        }
        const cliErrorThinkingJson = cliThinkingBuffer.size > 0
          ? JSON.stringify(Array.from(cliThinkingBuffer.values()))
          : null
        window.webContents.send('chat:stream-error', { type: 'api', message, retryable: true })
        sendActivity({ state: 'error', label: message })
        broadcastToMobile({ event: 'chat:stream-end', data: { conversationId } })
        const assistantMsgId = randomUUID()
        db.prepare(
          'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model, thinking_blocks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(assistantMsgId, conversationId, 'assistant', message, null, Date.now(), effectiveBackend, cliErrorThinkingJson)
        return { assistantMsgId }
      }
    }
  }

  // ── BYOK provider dispatch ─────────────────────────────────────────────────
  const byokKey = byokKeyForModel

  const historyRows = db
    .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
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
  const effectiveContextMessages = compressedContext.messages.map((m) => ({
    role: m.role,
    content: m.content,
  })) as ProviderMessage[]

  // CCMP.7: inject relevant wiki entries into restored context after compression
  if (compressedContext.summary !== null && wikiProjectId && effectiveContextMessages.length > 0) {
    const { getRelevantWikiEntries, formatWikiSection } = await import('./wiki-context')
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
  const rootDirNote = injectedRootDirectory
    ? `\n\nThe user's project root directory (${injectedRootDirectory}) has been scanned and its file tree is provided in the user message within [Project File Structure] tags. Treat it as real file system data — do NOT say you cannot access the file system.`
    : ''
  const systemPrompt = agentSystemPrompt
    ? `${agentSystemPrompt}${rootDirNote}\n\n${modelIdentityInstruction}`
    : `You are an AI programming assistant.${rootDirNote}\n\n${modelIdentityInstruction}`

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
  toolDefs.push(...wikiToolDefs)

  const hasMcpTools = mcpTools.length > 0
  const hasWikiTools = wikiToolDefs.length > 0
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
  const toolDirective = [browserDirective, wikiDirective].filter(Boolean).join('\n\n')

  let capturedStreamModel: string | null = null
  const handleStreamModel = (m: string) => {
    capturedStreamModel = m
    if (!window.webContents.isDestroyed()) {
      window.webContents.send('chat:stream-model', m)
    }
  }

  const byokThinkingBuffer = new Map<string, { blockId: string; content: string; done: boolean }>()

  let responseContent: string

  try {
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
      wikiInlineHandlers,
      toolDirective,
      generationOptions,
      conversationId,
      webContents: window.webContents,
      sendChunk,
      sendActivity,
      onModel: handleStreamModel,
      systemPrompt,
      onThinkingChunk: (blockId, chunk) => {
        const existing = byokThinkingBuffer.get(blockId) ?? { blockId, content: '', done: false }
        byokThinkingBuffer.set(blockId, { ...existing, content: existing.content + chunk })
        broadcastToMobile({ event: 'chat:thinking-delta', data: { conversationId, blockId, chunk } })
      },
      onThinkingEnd: (blockId) => {
        const existing = byokThinkingBuffer.get(blockId)
        if (existing) byokThinkingBuffer.set(blockId, { ...existing, done: true })
        broadcastToMobile({ event: 'chat:thinking-end', data: { conversationId, blockId } })
      },
    })

    sendStreamEnd()
  } catch (error) {
    console.error(`${providerName} error:`, error)
    const message = error instanceof Error ? error.message : 'Unexpected provider error'
    window.webContents.send('chat:stream-error', {
      type: 'api',
      message,
      retryable: message !== NO_PROVIDER_CONFIGURED_MESSAGE && message !== 'Azure endpoint not configured',
    })
    sendActivity({ state: 'error', label: message })
    broadcastToMobile({ event: 'chat:stream-end', data: { conversationId } })
    responseContent = message
  }

  const byokThinkingJson = byokThinkingBuffer.size > 0
    ? JSON.stringify(Array.from(byokThinkingBuffer.values()))
    : null

  const assistantMsgId = randomUUID()
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model, thinking_blocks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    assistantMsgId,
    conversationId,
    'assistant',
    responseContent,
    null,
    Date.now(),
    capturedStreamModel ?? selectedModel ?? null,
    byokThinkingJson,
  )

  return { assistantMsgId }
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
