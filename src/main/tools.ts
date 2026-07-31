import { getDatabase } from './database'
import { randomUUID } from 'crypto'
import { safeHandle } from './safe-handle'
import { broadcastToMobile, isMobileInForeground } from './ws-server'
import { sendApprovalPush } from './fcm-sender'
import { registerApprovalResolver } from './ws-handlers'
import { clearUnseenDestination, recordUnseenDestination } from './activity-badge'

function setToolPreference(toolName: string, value: string): void {
  const db = getDatabase()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    `tool_pref:${toolName}`,
    value
  )
}

const pendingApprovals = new Map<
  string,
  { toolName: string; resolve: (approved: boolean) => void; noRemember?: boolean; onRemember?: (approved: boolean) => void; agentId?: string; conversationId?: string }
>()

/**
 * Sends a tool approval request to the renderer and waits for the user's response.
 * Pass `noRemember: true` when the approval should not be persisted as a global tool
 * preference (e.g. MCP tools, which have their own per-agent override table).
 * Pass `onRemember` to handle the "Always allow" case with custom persistence logic
 * (e.g. updating an agent's tool approval field instead of writing a global preference).
 * Pass `autoApprove: true` to skip all prompts and resolve immediately (fullAutoApprove mode).
 * Pass `conversationId` so a stale request can be found and denied if that conversation's
 * turn gets aborted/replaced (see `denyPendingApprovalsForConversation`).
 */
export async function requestApproval(
  webContents: Electron.WebContents,
  toolName: string,
  args: Record<string, unknown>,
  description: string,
  options?: { noRemember?: boolean; onRemember?: (approved: boolean) => void; autoApprove?: boolean; agentId?: string; conversationId?: string }
): Promise<boolean> {
  if (options?.autoApprove === true) {
    if (!webContents.isDestroyed()) {
      webContents.send('tool:auto-approved', { toolName, args })
    }
    return true
  }
  const requestId = randomUUID()
  return new Promise<boolean>((resolve) => {
    // Register the resolver before publishing the request. Both the renderer IPC listener and
    // the Android WebSocket client can answer immediately; publishing first creates a race where
    // that answer is treated as stale and the request later times out as a false denial.
    pendingApprovals.set(requestId, { toolName, resolve, noRemember: options?.noRemember, onRemember: options?.onRemember, agentId: options?.agentId, conversationId: options?.conversationId })
    webContents.send('tool:request-approval', { requestId, tool: toolName, args, description })
    broadcastToMobile({ event: 'tool:approval-request', data: { requestId, toolName, args, description } })
    recordUnseenDestination(`approval:${requestId}`)
    if (!isMobileInForeground()) {
      sendApprovalPush(getDatabase(), { requestId, toolName, args, description }).catch(() => {})
    }
    setTimeout(() => {
      if (pendingApprovals.has(requestId)) {
        pendingApprovals.delete(requestId)
        clearUnseenDestination(`approval:${requestId}`)
        resolve(false)
      }
    }, 60000)
  })
}

/**
 * Denies and clears any approval requests still pending for a conversation. Called when a
 * conversation's in-flight CLI turn is aborted/replaced by a new send, so the previous turn's
 * permission-hook request doesn't sit invisible in Android's single-slot approval UI until its
 * 60s timeout — see roadmap/bugs/bug-new/cli-approval-relay-concurrent-turns.md.
 */
export function denyPendingApprovalsForConversation(conversationId: string): void {
  for (const [requestId, pending] of pendingApprovals) {
    if (pending.conversationId === conversationId) {
      pending.resolve(false)
      pendingApprovals.delete(requestId)
      clearUnseenDestination(`approval:${requestId}`)
    }
  }
}

export function drainPendingApprovals(agentId: string): void {
  for (const [requestId, pending] of pendingApprovals) {
    if (pending.agentId === agentId) {
      pending.resolve(true)
      pendingApprovals.delete(requestId)
      clearUnseenDestination(`approval:${requestId}`)
    }
  }
}

export function resolveApprovalFromWs(requestId: string, approved: boolean): boolean {
  const pending = pendingApprovals.get(requestId)
  if (!pending) return false
  pending.resolve(approved)
  pendingApprovals.delete(requestId)
  clearUnseenDestination(`approval:${requestId}`)
  return true
}

export function registerToolHandlers(): void {
  registerApprovalResolver(resolveApprovalFromWs)

  safeHandle(
    'tool:approval-response',
    (_event, requestId: string, approved: boolean, remember: boolean) => {
      const pending = pendingApprovals.get(requestId)
      if (pending) {
        if (remember) {
          if (pending.onRemember) {
            pending.onRemember(approved)
          } else if (!pending.noRemember) {
            setToolPreference(pending.toolName, approved ? 'always_allow' : 'always_deny')
          }
        }
        pending.resolve(approved)
        pendingApprovals.delete(requestId)
        clearUnseenDestination(`approval:${requestId}`)
      }
      return true
    }
  )
}
