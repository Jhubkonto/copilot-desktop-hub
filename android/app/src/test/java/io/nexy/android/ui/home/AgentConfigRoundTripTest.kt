package io.nexy.android.ui.home

import io.nexy.android.data.parseWsEvent
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
class AgentConfigRoundTripTest {
    @Test
    fun agentFullParserAndUpdatePayloadPreserveAdvancedFields() = runTest {
        val event = parseEvent(
            """
            {
              "event": "agent:full",
              "data": {
                "agent": {
                  "id": "agent-1",
                  "name": "Reviewer",
                  "icon": "R",
                  "systemPrompt": "Review carefully",
                  "backend": "codex-cli",
                  "cliModel": "gpt-5-codex",
                  "hermesProfile": "localllm-iso",
                  "temperature": 0.35,
                  "maxTokens": 64000,
                  "responseFormat": "detailed",
                  "agenticMode": true,
                  "fullAutoApprove": true,
                  "memory": "Prefer small patches",
                  "tools": {
                    "fileEdit": { "enabled": true, "approval": "always-ask", "instructions": "Keep edits scoped" },
                    "terminal": { "enabled": true, "approval": "always-ask", "instructions": "Run focused tests" },
                    "webFetch": { "enabled": false, "approval": "disabled", "instructions": "Only when requested" }
                  },
                  "mcpServers": ["github", "filesystem"],
                  "thinkingEffort": "high",
                  "rootDirectory": "C:/repo",
                  "contextDirectories": ["src", "android/app"],
                  "contextFiles": ["README.md", "src/shared/types.ts"],
                  "contextRules": {
                    "ignoredGlobs": ["build/**", "node_modules/**"],
                    "autoInjectWorkspace": false,
                    "autoInjectGit": true
                  },
                  "customCommands": [
                    { "name": "review", "description": "Review changes", "prompt": "Find risks" }
                  ]
                }
              }
            }
            """.trimIndent()
        )

        val config = (event as WsEvent.AgentFull).config
        val payload = buildAgentUpdatePayload(config)

        assertEquals("agent-1", payload["id"])
        assertEquals("codex-cli", payload["backend"])
        assertEquals("gpt-5-codex", payload["cliModel"])
        assertEquals("localllm-iso", payload["hermesProfile"])
        assertEquals(64000, payload["maxTokens"])
        assertEquals(true, payload["fullAutoApprove"])
        assertEquals(listOf("github", "filesystem"), payload["mcpServers"])
        assertEquals("high", payload["thinkingEffort"])
        assertEquals("C:/repo", payload["rootDirectory"])
        assertEquals(listOf("src", "android/app"), payload["contextDirectories"])
        assertEquals(listOf("README.md", "src/shared/types.ts"), payload["contextFiles"])

        val tools = payload["tools"] as Map<*, *>
        val terminal = tools["terminal"] as Map<*, *>
        assertEquals(true, terminal["enabled"])
        assertEquals("always-ask", terminal["approval"])
        assertEquals("Run focused tests", terminal["instructions"])

        val webFetch = tools["webFetch"] as Map<*, *>
        assertEquals(false, webFetch["enabled"])
        assertEquals("disabled", webFetch["approval"])
        assertEquals("Only when requested", webFetch["instructions"])

        val contextRules = payload["contextRules"] as Map<*, *>
        assertEquals(listOf("build/**", "node_modules/**"), contextRules["ignoredGlobs"])
        assertFalse(contextRules["autoInjectWorkspace"] as Boolean)
        assertTrue(contextRules["autoInjectGit"] as Boolean)

        val commands = payload["customCommands"] as List<*>
        assertEquals(
            mapOf("name" to "review", "description" to "Review changes", "prompt" to "Find risks"),
            commands.single(),
        )
    }

    @Test
    fun agentKnowledgeAndMcpEventsPreserveAdvancedRows() = runTest {
        val knowledge = parseEvent(
            """
            {
              "event": "agent:knowledge-files",
              "data": {
                "agentId": "agent-1",
                "files": [
                  {
                    "id": "kf-1",
                    "agent_id": "agent-1",
                    "file_path": "docs/brief.md",
                    "inject_mode": "on-demand",
                    "sort_order": 2,
                    "created_at": 100,
                    "updated_at": 200
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.AgentKnowledgeFiles
        assertEquals("on-demand", knowledge.files.single().injectMode)
        assertEquals("docs/brief.md", knowledge.files.single().filePath)

        val overrides = parseEvent(
            """
            {
              "event": "agent:mcp-tool-overrides",
              "data": {
                "agentId": "agent-1",
                "overrides": [
                  {
                    "server_id": "github",
                    "tool_name": "create_issue",
                    "enabled": 0,
                    "approval": "always-ask",
                    "instructions": "Ask before creating issues"
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.AgentMcpToolOverrides
        assertFalse(overrides.overrides.single().enabled)
        assertEquals("Ask before creating issues", overrides.overrides.single().instructions)

        val trust = parseEvent(
            """
            {
              "event": "agent:mcp-server-trust",
              "data": {
                "agentId": "agent-1",
                "trust": [{ "server_id": "github", "trust": "manual" }]
              }
            }
            """.trimIndent()
        ) as WsEvent.AgentMcpServerTrustList
        assertEquals("manual", trust.trust.single().trust)
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
