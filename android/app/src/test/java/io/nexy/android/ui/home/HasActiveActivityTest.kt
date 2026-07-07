package io.nexy.android.ui.home

import io.nexy.android.data.BackgroundActivity
import org.junit.Assert.assertEquals
import org.junit.Test

class HasActiveActivityTest {

    @Test
    fun idleWhenEverythingEmpty() {
        assertEquals(
            false,
            hasActiveActivity(
                activeConversationIds = emptySet(),
                pendingConversationIds = emptySet(),
                syncInProgress = false,
                backgroundActivities = emptyList(),
            ),
        )
    }

    @Test
    fun busyWhenAConversationIsActivelyGenerating() {
        assertEquals(
            true,
            hasActiveActivity(
                activeConversationIds = setOf("conv-1"),
                pendingConversationIds = emptySet(),
                syncInProgress = false,
                backgroundActivities = emptyList(),
            ),
        )
    }

    @Test
    fun busyWhenAConversationIsPendingCreation() {
        assertEquals(
            true,
            hasActiveActivity(
                activeConversationIds = emptySet(),
                pendingConversationIds = setOf("conv-1"),
                syncInProgress = false,
                backgroundActivities = emptyList(),
            ),
        )
    }

    @Test
    fun busyWhenSyncInProgress() {
        assertEquals(
            true,
            hasActiveActivity(
                activeConversationIds = emptySet(),
                pendingConversationIds = emptySet(),
                syncInProgress = true,
                backgroundActivities = emptyList(),
            ),
        )
    }

    @Test
    fun busyWhenAGeneratorIsRunningInTheBackground() {
        assertEquals(
            true,
            hasActiveActivity(
                activeConversationIds = emptySet(),
                pendingConversationIds = emptySet(),
                syncInProgress = false,
                backgroundActivities = listOf(BackgroundActivity("agent-generator", "Generating agent…", "agent-generator")),
            ),
        )
    }
}
