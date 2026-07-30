package io.nexy.android.ui.home

import io.nexy.android.data.BackgroundActivity
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import org.junit.Assert.assertEquals
import org.junit.Test

class ActivityFeedContextTest {
    @Test
    fun resolvesMissingMetadataFromLocalCatalogs() {
        val result = resolveActivityContext(
            activity = BackgroundActivity(
                id = "chat:conversation-1",
                label = "Assistant is responding…",
                route = "chat/conversation-1",
                conversationId = "conversation-1",
            ),
            conversations = listOf(
                Conversation(
                    id = "conversation-1",
                    title = "Fix the activity feed",
                    created_at = "1",
                    updated_at = "2",
                    agent_id = "agent-1",
                    project_id = "project-1",
                ),
            ),
            projects = listOf(Project("project-1", "Nexy", "blue")),
            agents = listOf(Agent("agent-1", "UI Engineer")),
        )

        assertEquals(
            ActivityDisplayContext(
                conversationTitle = "Fix the activity feed",
                projectName = "Nexy",
                agentName = "UI Engineer",
                model = null,
            ),
            result,
        )
    }
}
