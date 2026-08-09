package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatThinkingParserTest {
    @Test
    fun parsesChatThinkingDeltaAndEndEvents() = runTest {
        val delta = parseEvent(
            """{"event":"chat:thinking-delta","data":{"conversationId":"conv-1","blockId":"codex-activity","chunk":"Planning"}}"""
        )
        val end = parseEvent(
            """{"event":"chat:thinking-end","data":{"conversationId":"conv-1","blockId":"codex-activity"}}"""
        )

        assertEquals(WsEvent.ChatThinkingDelta("conv-1", "codex-activity", "Planning"), delta)
        assertEquals(WsEvent.ChatThinkingEnd("conv-1", "codex-activity"), end)
    }

    @Test
    fun parsesNormalizedChatTurnEvents() = runTest {
        val event = parseEvent(
            """
            {
              "event": "chat:turn-event",
              "data": {
                "conversationId": "conv-1",
                "turnId": "turn-1",
                "sequence": 3,
                "type": "assistant_text_delta",
                "timestamp": 123456,
                "chunk": "Hello"
              }
            }
            """.trimIndent()
        ) as WsEvent.ChatTurnEvent

        assertEquals("conv-1", event.conversationId)
        assertEquals("turn-1", event.turnId)
        assertEquals(3L, event.sequence)
        assertEquals("assistant_text_delta", event.type)
        assertEquals(123456L, event.timestamp)
        assertTrue(event.payloadJson.contains("\"chunk\":\"Hello\""))
    }

    @Test
    fun parsesToolApprovalRequestConversationId() = runTest {
        val scoped = parseEvent(
            """{"event":"tool:approval-request","data":{"requestId":"r1","toolName":"Edit","args":{},"description":"d","conversationId":"conv-1"}}"""
        )
        val legacy = parseEvent(
            """{"event":"tool:approval-request","data":{"requestId":"r2","toolName":"Edit","args":{},"description":"d"}}"""
        )

        assertEquals("conv-1", (scoped as WsEvent.ToolApprovalRequest).conversationId)
        // Legacy desktops omit conversationId — must parse as null so the in-chat dialog still shows it.
        assertEquals(null, (legacy as WsEvent.ToolApprovalRequest).conversationId)
    }

    private suspend fun TestScope.parseEvent(raw: String): WsEvent {
        val events = MutableSharedFlow<WsEvent>(replay = 1, extraBufferCapacity = 8)
        parseWsEvent(
            text = raw,
            scope = this,
            events = events,
            serverVersion = MutableStateFlow(null),
            conversations = MutableStateFlow<List<Conversation>>(emptyList()),
            projects = MutableStateFlow<List<Project>>(emptyList()),
            agents = MutableStateFlow<List<Agent>>(emptyList()),
            agentFullConfig = MutableStateFlow<AgentFullConfig?>(null),
            models = MutableStateFlow<List<ModelOption>>(emptyList()),
            modelSource = MutableStateFlow<ModelListSource?>(null),
            androidUpdateManifest = MutableStateFlow<AndroidUpdateManifest?>(null),
            errorReports = MutableStateFlow<List<ErrorReport>>(emptyList()),
            providers = MutableStateFlow<List<ProviderInfo>>(emptyList()),
            mcpServers = MutableStateFlow<List<McpServerInfo>>(emptyList()),
            skills = MutableStateFlow<List<SkillConfig>>(emptyList()),
            skillAgentUsage = MutableStateFlow(emptyMap()),
            artifacts = MutableStateFlow<List<ArtifactSummary>>(emptyList()),
            wikiEntries = MutableStateFlow<List<WikiEntry>>(emptyList()),
            promptEntries = MutableStateFlow<List<PromptEntry>>(emptyList()),
            cliStatus = MutableStateFlow<Map<String, CliInstallInfo>>(emptyMap()),
            scheduledTasks = MutableStateFlow(emptyList()),
            scheduledRuns = MutableStateFlow(emptyMap()),
            currentDebrief = MutableStateFlow(null),
            completedConversationIds = MutableStateFlow(emptySet()),
            currentRating = MutableStateFlow(null),
            ratingsList = MutableStateFlow(emptyList()),
            ratingStats = MutableStateFlow(null),
        )
        testScheduler.advanceUntilIdle()
        return events.replayCache.lastOrNull() ?: throw AssertionError("No websocket event parsed from: $raw")
    }
}
