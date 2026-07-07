package io.nexy.android.data.local

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Regression coverage for the "N changes failed to sync" bug that never self-heals: a message
 * left in the outbox for a conversation the user already deleted locally fails identically on
 * every retry because the payload never changes. [isOrphanedConversationReference] is the pure
 * decision [LocalDataRepository.discardOrphanedOperations] uses to tell a truly-orphaned
 * operation (safe to silently discard) apart from one that just got caught in a batch-wide
 * failure (safe to retry automatically).
 */
class OrphanedSyncOperationTest {

    @Test
    fun noConversationIdInPayload_isOrphaned() {
        assertEquals(true, isOrphanedConversationReference(conversationId = null, conversationDeleted = null))
    }

    @Test
    fun conversationRowNoLongerExists_isOrphaned() {
        assertEquals(true, isOrphanedConversationReference(conversationId = "conv-1", conversationDeleted = null))
    }

    @Test
    fun conversationWasTombstoned_isOrphaned() {
        assertEquals(true, isOrphanedConversationReference(conversationId = "conv-1", conversationDeleted = true))
    }

    @Test
    fun conversationStillExistsAndNotDeleted_isNotOrphaned() {
        assertEquals(false, isOrphanedConversationReference(conversationId = "conv-1", conversationDeleted = false))
    }
}
