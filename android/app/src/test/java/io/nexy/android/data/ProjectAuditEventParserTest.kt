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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProjectAuditEventParserTest {
    @Test
    fun projectAuditSessionsAreParsedForAndroidUi() = runTest {
        val event = parseEvent(
            """
            {
              "event": "project-audit:sessions",
              "data": {
                "projectId": "project-1",
                "sessions": [
                  {
                    "id": "session-1",
                    "projectId": "project-1",
                    "conversationId": "conv-1",
                    "agentId": "agent-1",
                    "title": "Remote edit fix",
                    "source": "remote-edit",
                    "createdAt": 10,
                    "updatedAt": 20,
                    "fileCount": 2
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.ProjectAuditSessions

        assertEquals("project-1", event.projectId)
        assertEquals(1, event.sessions.size)
        assertEquals("session-1", event.sessions.first().id)
        assertEquals("remote-edit", event.sessions.first().source)
        assertEquals(2, event.sessions.first().fileCount)
    }

    @Test
    fun projectAuditFilesAndDiffsAreParsedForAndroidUi() = runTest {
        val filesEvent = parseEvent(
            """
            {
              "event": "project-audit:files",
              "data": {
                "sessionId": "session-1",
                "files": [
                  {
                    "sessionId": "session-1",
                    "relativePath": "src/App.tsx",
                    "status": "modified",
                    "lastOperation": "apply",
                    "firstTouchedAt": 11,
                    "lastTouchedAt": 22,
                    "diffAvailable": true
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.ProjectAuditFiles

        assertEquals("session-1", filesEvent.sessionId)
        assertEquals(1, filesEvent.files.size)
        assertEquals("src/App.tsx", filesEvent.files.first().relativePath)
        assertTrue(filesEvent.files.first().diffAvailable)

        val diffEvent = parseEvent(
            """
            {
              "event": "project-audit:diff",
              "data": {
                "sessionId": "session-1",
                "diff": {
                  "relativePath": "src/App.tsx",
                  "hunks": [
                    {
                      "header": "@@ -1,1 +1,1 @@",
                      "lines": [
                        { "kind": "del", "content": "old" },
                        { "kind": "add", "content": "new" }
                      ]
                    }
                  ]
                }
              }
            }
            """.trimIndent()
        ) as WsEvent.ProjectAuditDiffLoaded

        assertEquals("session-1", diffEvent.sessionId)
        assertNotNull(diffEvent.diff)
        assertEquals("src/App.tsx", diffEvent.diff?.relativePath)
        assertTrue(diffEvent.diff?.hunksJson?.contains("\"header\":\"@@ -1,1 +1,1 @@\"") == true)
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
