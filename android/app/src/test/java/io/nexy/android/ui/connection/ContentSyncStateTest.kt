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
    fun `in-flight sync or queued changes read as syncing`() {
        assertEquals(
            ContentSyncState.SYNCING,
            resolveContentSyncState(syncInProgress = true, pendingChanges = 0, failedChanges = 0, conflicts = 0),
        )
        assertEquals(
            ContentSyncState.SYNCING,
            resolveContentSyncState(syncInProgress = false, pendingChanges = 2, failedChanges = 0, conflicts = 0),
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
