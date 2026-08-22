package io.nexy.android.ui.connection

import org.junit.Assert.assertEquals
import org.junit.Test

class ContentSyncStateTest {
    @Test
    fun `unresolved failures or conflicts take priority over syncing`() {
        assertEquals(
            ContentSyncState.ERROR,
            resolveContentSyncState(syncInProgress = true, pendingChanges = 3, failedChanges = 1, conflicts = 0),
        )
        assertEquals(
            ContentSyncState.ERROR,
            resolveContentSyncState(syncInProgress = true, pendingChanges = 3, failedChanges = 0, conflicts = 1),
        )
    }

    @Test
    fun `only work actually in flight reads as syncing`() {
        assertEquals(
            ContentSyncState.SYNCING,
            resolveContentSyncState(syncInProgress = true, pendingChanges = 0, failedChanges = 0, conflicts = 0),
        )
    }

    @Test
    fun `queued changes with no transfer in flight read as pending, not syncing`() {
        // The spinning glyph is a busy indicator. Local edits that are queued but not currently
        // being pushed (offline, or waiting for the next flush) must not animate forever - that
        // is the "spinner never stops" failure mode. They stay visible as PENDING instead.
        assertEquals(
            ContentSyncState.PENDING,
            resolveContentSyncState(syncInProgress = false, pendingChanges = 2, failedChanges = 0, conflicts = 0),
        )
    }

    @Test
    fun `queued changes read as syncing while a push is actually running`() {
        assertEquals(
            ContentSyncState.SYNCING,
            resolveContentSyncState(syncInProgress = true, pendingChanges = 2, failedChanges = 0, conflicts = 0),
        )
    }

    @Test
    fun `screen override false still surfaces queued changes`() {
        assertEquals(
            ContentSyncState.PENDING,
            resolveContentSyncState(
                syncInProgress = true,
                pendingChanges = 1,
                failedChanges = 0,
                conflicts = 0,
                contentSyncInProgress = false,
            ),
        )
    }

    @Test
    fun `nothing outstanding reads as synced`() {
        assertEquals(
            ContentSyncState.SYNCED,
            resolveContentSyncState(syncInProgress = false, pendingChanges = 0, failedChanges = 0, conflicts = 0),
        )
    }

    @Test
    fun `explicit screen override forces syncing`() {
        assertEquals(
            ContentSyncState.SYNCING,
            resolveContentSyncState(
                syncInProgress = false,
                pendingChanges = 0,
                failedChanges = 0,
                conflicts = 0,
                contentSyncInProgress = true,
            ),
        )
    }

    @Test
    fun `explicit false override suppresses unrelated background sync`() {
        assertEquals(
            ContentSyncState.SYNCED,
            resolveContentSyncState(
                syncInProgress = true,
                pendingChanges = 0,
                failedChanges = 0,
                conflicts = 0,
                contentSyncInProgress = false,
            ),
        )
    }

    @Test
    fun `override never masks a real problem`() {
        assertEquals(
            ContentSyncState.ERROR,
            resolveContentSyncState(
                syncInProgress = false,
                pendingChanges = 0,
                failedChanges = 1,
                conflicts = 0,
                contentSyncInProgress = false,
            ),
        )
    }

    @Test
    fun `every state has a presentation`() {
        for (state in ContentSyncState.entries) {
            val presentation = getContentSyncPresentation(state)
            assertEquals(false, presentation.label.isBlank())
            assertEquals(false, presentation.accessibilityDescription.isBlank())
        }
    }
}
