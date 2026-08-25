import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import {
  activateConversationCapabilities,
  assertCapabilityProfileValid,
  getConversationCapabilityProfile,
  getProjectCapabilityProfile,
  normalizeCapabilityProfile,
  resolveConversationCapabilities,
  setConversationCapabilityProfile,
  setProjectCapabilityProfile,
} from './capability-service'
import { readProjectConfig } from './project-handlers'
import { broadcastToMobile } from './ws-server'
import type { CapabilityActivationInput, ConversationCapabilityProfile } from '../shared/types'

export function registerCapabilityHandlers(): void {
  const db = getDatabase()
  safeHandle('conversation:get-capabilities', (_event, conversationId: string) =>
    getConversationCapabilityProfile(db, conversationId))
  safeHandle('conversation:set-capabilities', (_event, conversationId: string, profile: ConversationCapabilityProfile) =>
    setConversationCapabilityProfile(db, conversationId, profile))
  safeHandle('capabilities:resolve', (_event, conversationId: string, modelId?: string | null) =>
    resolveConversationCapabilities(db, conversationId, modelId))
  safeHandle('capabilities:activate', (_event, conversationId: string, input: CapabilityActivationInput) =>
    activateConversationCapabilities(db, conversationId, input))
  safeHandle('project:get-capabilities', (_event, projectId: string) =>
    getProjectCapabilityProfile(db, projectId))
  safeHandle('project:set-capabilities', (_event, projectId: string, profile: ConversationCapabilityProfile) => {
    // Replace, not merge. This is the authoritative editor for project scope, so an entry the
    // user removed here has to actually disappear -- the additive "Add to project" shortcut in
    // the chat popover can only ever grow the set and tighten trust.
    const normalized = normalizeCapabilityProfile(profile)
    assertCapabilityProfileValid(normalized)
    const saved = setProjectCapabilityProfile(db, projectId, normalized)
    broadcastToMobile({ event: 'project:config-changed', data: { id: projectId, config: readProjectConfig(db, projectId) } })
    return saved
  })
}
