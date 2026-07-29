package io.nexy.android.navigation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivityFeedNavigationTest {
    @Test
    fun `same chat route matches the entry beneath the feed`() {
        val arguments = mapOf("conversationId" to "conversation-123")

        assertTrue(
            routeTargetsSameScreen(
                destinationPattern = "chat/{conversationId}?agentId={agentId}&projectId={projectId}",
                argumentValue = arguments::get,
                targetRoute = "chat/conversation-123",
            ),
        )
    }

    @Test
    fun `different chat route does not match the entry beneath the feed`() {
        val arguments = mapOf("conversationId" to "conversation-123")

        assertFalse(
            routeTargetsSameScreen(
                destinationPattern = "chat/{conversationId}?agentId={agentId}&projectId={projectId}",
                argumentValue = arguments::get,
                targetRoute = "chat/conversation-456",
            ),
        )
    }

    @Test
    fun `encoded path argument matches its decoded back stack value`() {
        val arguments = mapOf("projectId" to "project / alpha")

        assertTrue(
            routeTargetsSameScreen(
                destinationPattern = "automated-workflow/{projectId}",
                argumentValue = arguments::get,
                targetRoute = "automated-workflow/project%20%2F%20alpha",
            ),
        )
    }

    @Test
    fun `different destinations never match even when an argument is shared`() {
        val arguments = mapOf("conversationId" to "conversation-123")

        assertFalse(
            routeTargetsSameScreen(
                destinationPattern = "chat/{conversationId}",
                argumentValue = arguments::get,
                targetRoute = "debrief/conversation-123",
            ),
        )
    }
}
