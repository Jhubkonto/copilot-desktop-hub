import { getDatabase } from './database'
import { safeHandle } from './safe-handle'
import {
  activateConversationCapabilities,
  getConversationCapabilityProfile,
  resolveConversationCapabilities,
  setConversationCapabilityProfile,
} from './capability-service'
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
}
