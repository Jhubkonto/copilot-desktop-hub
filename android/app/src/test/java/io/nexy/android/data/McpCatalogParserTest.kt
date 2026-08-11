package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ConversationDebrief
import io.nexy.android.data.model.ConversationRating
import io.nexy.android.data.model.ConversationRatingListItem
import io.nexy.android.data.model.ConversationRatingStats
import io.nexy.android.data.model.McpCatalogEntry
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
class McpCatalogParserTest {

    @Test
    fun parsesCatalogEntriesAndRequiredEnvironmentMetadata() = runTest {
        val catalog = MutableStateFlow<List<McpCatalogEntry>>(emptyList())
        val event = parseEvent(
            """
            {
              "event": "mcp:catalog",
              "data": {
                "entries": [
                  {
                    "id": "github",
                    "name": "GitHub",
                    "description": "Access GitHub",
                    "category": "dev",
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "requiredEnv": [
                      {
                        "key": "GITHUB_PERSONAL_ACCESS_TOKEN",
                        "label": "GitHub Personal Access Token",
                        "helpUrl": "https://github.com/settings/tokens",
                        "secret": true
                      }
                    ],
                    "keywords": ["github", "issues"]
                  }
                ]
              }
            }
            """.trimIndent(),
            catalog = catalog,
        ) as WsEvent.McpCatalog

        assertEquals(1, event.entries.size)
        assertEquals("github", event.entries.first().id)
        assertEquals(listOf("-y", "@modelcontextprotocol/server-github"), event.entries.first().args)
        assertEquals("GITHUB_PERSONAL_ACCESS_TOKEN", event.entries.first().requiredEnv.first().key)
        assertTrue(event.entries.first().requiredEnv.first().secret)
        assertEquals("https://github.com/settings/tokens", catalog.value.first().requiredEnv.first().helpUrl)
    }

    private suspend fun TestScope.parseEvent(
        raw: String,
        catalog: MutableStateFlow<List<McpCatalogEntry>>,
    ): WsEvent {
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
            providers = MutableStateFlow<List<ProviderInfo>>(emptyList()),
            mcpServers = MutableStateFlow<List<McpServerInfo>>(emptyList()),
            mcpCatalog = catalog,
            skills = MutableStateFlow<List<SkillConfig>>(emptyList()),
            skillAgentUsage = MutableStateFlow(emptyMap()),
            artifacts = MutableStateFlow<List<ArtifactSummary>>(emptyList()),
            wikiEntries = MutableStateFlow<List<WikiEntry>>(emptyList()),
            promptEntries = MutableStateFlow<List<PromptEntry>>(emptyList()),
            cliStatus = MutableStateFlow<Map<String, CliInstallInfo>>(emptyMap()),
            scheduledTasks = MutableStateFlow(emptyList()),
            scheduledRuns = MutableStateFlow(emptyMap()),
            currentDebrief = MutableStateFlow<ConversationDebrief?>(null),
            completedConversationIds = MutableStateFlow(emptySet()),
            currentRating = MutableStateFlow<ConversationRating?>(null),
            ratingsList = MutableStateFlow<List<ConversationRatingListItem>>(emptyList()),
            ratingStats = MutableStateFlow<ConversationRatingStats?>(null),
        )
        testScheduler.advanceUntilIdle()
        return events.replayCache.lastOrNull() ?: throw AssertionError("No websocket event parsed from: $raw")
    }
}
