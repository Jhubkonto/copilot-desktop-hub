import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { sendCopilotChatMessage, sendCopilotNonStreaming, type ToolDefinition } from './copilot-api'
import { getAgentConfig } from './agents'
import type { ProviderMessage } from './providers'

export const MAX_DELEGATION_DEPTH = 5

export interface OrchestratorAgent {
  agentId: string
  agentName: string
  agentIcon: string
  isPrimary: boolean
  sortOrder: number
}

export interface TeamActivityStep {
  stepId: string
  agentId: string
  agentName: string
  agentIcon: string
  task: string
  status: 'delegating' | 'done' | 'error'
  result?: string
  durationMs?: number
}

export interface OrchestratorOptions {
  projectId: string
  projectName: string
  leaderAgentId: string
  teamAgents: OrchestratorAgent[]
  conversationId: string
  window: BrowserWindow
  selectedModel: string
  generationOptions: { temperature: number; maxTokens: number }
  maxDelegationDepth?: number
  showActivity?: boolean
}

const DELEGATE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'delegate_to_agent',
    description:
      'Forward a sub-task to a team member specialist agent and receive their result before continuing.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The exact agent ID of the team member to delegate to.'
        },
        task: {
          type: 'string',
          description: 'A clear, self-contained description of the sub-task for the specialist.'
        },
        context: {
          type: 'string',
          description: 'Optional extra context to pass to the specialist.'
        }
      },
      required: ['agent_id', 'task']
    }
  }
}

function buildTeamManifest(teamAgents: OrchestratorAgent[], projectName: string): string {
  const nonLeaders = teamAgents.filter((a) => !a.isPrimary)
  if (nonLeaders.length === 0) return ''

  const lines = nonLeaders.map((a) => {
    const cfg = getAgentConfig(a.agentId)
    const desc = typeof cfg?.systemPrompt === 'string'
      ? cfg.systemPrompt.split('\n')[0].slice(0, 120)
      : 'General purpose agent'
    return `- agent_id: "${a.agentId}", name: "${a.agentName}" (${a.agentIcon}): ${desc}`
  })

  return (
    `\n\n## Team Leadership — Project "${projectName}"\n` +
    `You are the lead agent for this project. You have access to the following specialists via the delegate_to_agent tool:\n` +
    lines.join('\n') +
    `\n\nGuidelines:\n` +
    `- Delegate sub-tasks to the most appropriate specialist.\n` +
    `- Only delegate when a specialist would clearly do better — answer directly when you can.\n` +
    `- After receiving a specialist result, integrate it into your final answer.\n` +
    `- Produce one final answer to the user once all needed results are gathered.\n` +
    `- Do NOT delegate the same task twice.`
  )
}

/**
 * Run the multi-agent orchestration loop for a project with ≥2 agents.
 *
 * Returns the final response text and the list of delegation steps that occurred.
 * The final response is also streamed to the window via chat:stream-response events.
 */
export async function runOrchestration(
  opts: OrchestratorOptions,
  userContent: ProviderMessage['content'],
  historyMessages: ProviderMessage[]
): Promise<{ finalContent: string; teamActivity: TeamActivityStep[] }> {
  const {
    projectName,
    leaderAgentId,
    teamAgents,
    window,
    selectedModel,
    generationOptions,
    maxDelegationDepth = MAX_DELEGATION_DEPTH
  } = opts

  const leaderCfg = getAgentConfig(leaderAgentId)
  const leaderSystemPrompt =
    typeof leaderCfg?.systemPrompt === 'string' ? leaderCfg.systemPrompt : undefined

  const teamManifest = buildTeamManifest(teamAgents, projectName)
  const copilotModel = selectedModel !== 'default' ? selectedModel : 'gpt-4o'

  const teamActivitySteps: TeamActivityStep[] = []

  // Running conversation messages for the orchestration loop
  const loopMessages: ProviderMessage[] = [
    {
      role: 'system' as const,
      content: leaderSystemPrompt
        ? `${leaderSystemPrompt}${teamManifest}`
        : `You are GitHub Copilot, an AI programming assistant.${teamManifest}`
    },
    ...historyMessages,
    { role: 'user' as const, content: userContent }
  ]

  const memberIds = new Set(teamAgents.filter((a) => !a.isPrimary).map((a) => a.agentId))

  for (let depth = 0; depth < maxDelegationDepth; depth++) {
    const result = await sendCopilotNonStreaming(
      loopMessages,
      memberIds.size > 0 ? [DELEGATE_TOOL] : undefined,
      copilotModel,
      generationOptions
    )

    // No tool calls — leader produced final answer
    if (result.toolCalls.length === 0) {
      const finalContent = result.content ?? ''
      // Stream the final answer to the renderer
      for (const char of finalContent) {
        window.webContents.send('chat:stream-response', char)
      }
      window.webContents.send('chat:stream-response', null)
      return { finalContent, teamActivity: teamActivitySteps }
    }

    // Process the first tool call (one at a time)
    const call = result.toolCalls[0]
    const { agent_id: targetAgentId, task, context } = call.arguments as {
      agent_id: string
      task: string
      context?: string
    }

    const targetAgent = teamAgents.find((a) => a.agentId === targetAgentId)
    if (!targetAgent || !memberIds.has(targetAgentId)) {
      // Unknown agent — inject error and let leader recover
      loopMessages.push({
        role: 'assistant' as const,
        content: null,
        tool_calls: [{ id: call.id, type: 'function', function: { name: 'delegate_to_agent', arguments: JSON.stringify(call.arguments) } }]
      })
      loopMessages.push({
        role: 'tool' as const,
        tool_call_id: call.id,
        content: `Error: Unknown agent_id "${targetAgentId}". Please choose from the listed team members.`
      })
      continue
    }

    const stepId = randomUUID()
    const step: TeamActivityStep = {
      stepId,
      agentId: targetAgentId,
      agentName: targetAgent.agentName,
      agentIcon: targetAgent.agentIcon,
      task: String(task).slice(0, 500),
      status: 'delegating'
    }
    teamActivitySteps.push(step)
    window.webContents.send('chat:team-activity', { ...step })

    // Call the specialist agent
    const specialistCfg = getAgentConfig(targetAgentId)
    const specialistSystemPrompt =
      typeof specialistCfg?.systemPrompt === 'string' ? specialistCfg.systemPrompt : undefined
    const taskContent = context ? `${task}\n\nContext:\n${context}` : task
    const specialistMessages: ProviderMessage[] = [
      {
        role: 'system' as const,
        content: specialistSystemPrompt
          ? `${specialistSystemPrompt}\n\nYou are a specialist in the team. Answer concisely and factually.`
          : 'You are a specialist AI assistant. Answer concisely and factually.'
      },
      { role: 'user' as const, content: taskContent }
    ]

    const delegateStart = Date.now()
    let specialistResult: string
    try {
      specialistResult = await sendCopilotChatMessage(
        window,
        specialistMessages,
        () => { /* sub-agent responses are not streamed to the user */ },
        copilotModel,
        generationOptions,
        opts.conversationId
      )
      step.status = 'done'
      step.result = specialistResult
      step.durationMs = Date.now() - delegateStart
    } catch (err) {
      const msg = `Specialist agent error: ${(err as Error).message}`
      step.status = 'error'
      step.result = msg
      step.durationMs = Date.now() - delegateStart
      specialistResult = msg
    }

    window.webContents.send('chat:team-activity', { ...step })

    // Append the assistant's tool call + tool result to the loop messages
    loopMessages.push({
      role: 'assistant' as const,
      content: null,
      tool_calls: [{ id: call.id, type: 'function', function: { name: 'delegate_to_agent', arguments: JSON.stringify(call.arguments) } }]
    })
    loopMessages.push({
      role: 'tool' as const,
      tool_call_id: call.id,
      content: specialistResult
    })
  }

  // Depth cap reached — call leader one last time without tools to force a final answer
  const finalResult = await sendCopilotChatMessage(
    window,
    [
      ...loopMessages,
      {
        role: 'user' as const,
        content:
          'You have reached the maximum delegation depth. Please provide your final answer now based on all gathered information.'
      }
    ],
    (chunk) => window.webContents.send('chat:stream-response', chunk),
    copilotModel,
    generationOptions,
    opts.conversationId
  )
  window.webContents.send('chat:stream-response', null)
  return { finalContent: finalResult, teamActivity: teamActivitySteps }
}
