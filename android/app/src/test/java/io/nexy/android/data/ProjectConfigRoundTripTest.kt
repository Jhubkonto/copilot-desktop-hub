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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProjectConfigRoundTripTest {
    @Test
    fun projectConfigParserAndPayloadPreserveDesktopSettingsFields() = runTest {
        val event = parseEvent(
            """
            {
              "event": "project:config",
              "data": {
                "id": "project-1",
                "config": {
                  "instructions": "Ship carefully",
                  "rootDirectory": "C:/repo",
                  "variables": [{ "key": "ENV", "value": "dev" }],
                  "instructionMode": "append",
                  "instructionsEnabled": false,
                  "orchestrationEnabled": true,
                  "maxDelegationDepth": 7,
                  "showTeamActivity": false,
                  "inScope": [{ "id": "in-1", "description": "Android app", "pathGlob": "android/**" }],
                  "outOfScope": [{ "id": "out-1", "description": "Build output" }],
                  "milestones": [{ "id": "m-1", "title": "Parity", "description": "Close gaps", "status": "active" }],
                  "defaultModel": "openrouter/test-model"
                }
              }
            }
            """.trimIndent()
        ) as WsEvent.ProjectConfig

        val payload = buildProjectConfigPayload(event.id, event.config)

        assertEquals("project-1", payload["id"])
        assertEquals("Ship carefully", payload["instructions"])
        assertEquals("C:/repo", payload["rootDirectory"])
        assertEquals(listOf(mapOf("key" to "ENV", "value" to "dev")), payload["variables"])
        assertEquals("append", payload["instructionMode"])
        assertFalse(payload["instructionsEnabled"] as Boolean)
        assertTrue(payload["orchestrationEnabled"] as Boolean)
        assertEquals(7, payload["maxDelegationDepth"])
        assertFalse(payload["showTeamActivity"] as Boolean)
        assertEquals(listOf(mapOf("id" to "in-1", "description" to "Android app", "pathGlob" to "android/**")), payload["inScope"])
        assertEquals(listOf(mapOf("id" to "out-1", "description" to "Build output")), payload["outOfScope"])
        assertEquals(listOf(mapOf("id" to "m-1", "title" to "Parity", "description" to "Close gaps", "status" to "active")), payload["milestones"])
        assertEquals("openrouter/test-model", payload["defaultModel"])
    }

    @Test
    fun projectAgentsParserPreservesSortOrderForReorderUi() = runTest {
        val event = parseEvent(
            """
            {
              "event": "project:agents",
              "data": {
                "id": "project-1",
                "agents": [
                  { "agentId": "agent-b", "agentName": "Builder", "agentIcon": "B", "isPrimary": false, "sortOrder": 0 },
                  { "agentId": "agent-a", "agentName": "Architect", "agentIcon": "A", "isPrimary": true, "sortOrder": 1 }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.ProjectAgents

        assertEquals(listOf("agent-b", "agent-a"), event.agents.map { it.agentId })
        assertEquals(listOf(0, 1), event.agents.map { it.sortOrder })
        assertTrue(event.agents[1].isPrimary)
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
