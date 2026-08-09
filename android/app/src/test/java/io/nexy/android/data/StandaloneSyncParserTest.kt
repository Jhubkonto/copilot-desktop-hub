package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ConversationDebrief
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.ScheduledRun
import io.nexy.android.data.model.ScheduledTask
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class StandaloneSyncParserTest {
    @Test
    fun rejectsOnlyOversizedSyncFramesBeforeJsonExpansion() {
        assertTrue(isOversizedSyncEvent("""{"event":"sync:welcome","data":{}}padding""", maxChars = 20))
        assertTrue(isOversizedSyncEvent("""{"event":"sync:ack","data":{}}padding""", maxChars = 20))
        assertEquals(false, isOversizedSyncEvent("""{"event":"chat:stream","data":{}}padding""", maxChars = 20))
        assertEquals(false, isOversizedSyncEvent("""{"event":"sync:welcome"}""", maxChars = 100))
    }

    @Test
    fun parsesWelcomeSnapshotWithoutFlatteningPayload() = runTest {
        val event = parse(
            """
            {
              "event":"sync:welcome",
              "data":{
                "protocolVersion":1,
                "desktopDeviceId":"desktop-1",
                "datasetId":"dataset-1",
                "desktopSequence":42,
                "isDelta":true,
                "snapshot":{"projects":[{"id":"project-1"}],"versions":{"project:project-1":2}}
              }
            }
            """.trimIndent(),
        ) as WsEvent.SyncWelcome

        assertEquals(1, event.protocolVersion)
        assertEquals("desktop-1", event.desktopDeviceId)
        assertEquals(42L, event.desktopSequence)
        assertTrue(event.isDelta)
        assertEquals(2, event.snapshot.optJSONObject("versions")?.optInt("project:project-1"))
    }

    @Test
    fun parsesForegroundProbeAcknowledgement() = runTest {
        val event = parse(
            """{"event":"sync:probe-ack","data":{"probeId":"probe-1","serverReceivedAt":456}}""",
        ) as WsEvent.SyncProbeAck

        assertEquals("probe-1", event.probeId)
        assertEquals(456L, event.serverReceivedAt)
    }

    @Test
    fun parsesAcknowledgementsConflictsAndProtocolErrors() = runTest {
        val ack = parse(
            """
            {"event":"sync:ack","data":{"operationIds":["op-1"],"lastReceivedSequence":7,
            "conflicts":[{"id":"conflict-1"}],"snapshot":{"projects":[]}}}
            """.trimIndent(),
        ) as WsEvent.SyncAck
        assertEquals(listOf("op-1"), ack.operationIds)
        assertEquals(7, ack.lastReceivedSequence)
        assertTrue(ack.conflictsJson.contains("conflict-1"))

        val error = parse(
            """{"event":"sync:error","data":{"code":"unsupported-protocol","message":"upgrade","supportedProtocolVersion":1}}""",
        ) as WsEvent.SyncError
        assertEquals("unsupported-protocol", error.code)
        assertEquals(1, error.supportedProtocolVersion)
    }

    @Test
    fun parsesChunkedAndConditionalHistoryEvents() = runTest {
        val chunk = parse(
            """
            {"event":"conversation:history-chunk","data":{"conversationId":"conv-1",
            "requestId":"request-1","chunkIndex":0,"chunkCount":2,
            "messages":[{"id":"m1","role":"assistant","content":"Ready","timestamp":5}]}}
            """.trimIndent(),
        ) as WsEvent.ConversationMessages
        assertEquals("request-1", chunk.requestId)
        assertEquals(0, chunk.chunkIndex)
        assertEquals(2, chunk.chunkCount)
        assertEquals("m1", chunk.messages.single().id)

        val unchanged = parse(
            """
            {"event":"conversation:history-not-modified","data":{"conversationId":"conv-1",
            "requestId":"request-2","historyVersion":"v1","hasMore":true}}
            """.trimIndent(),
        ) as WsEvent.ConversationHistoryNotModified
        assertEquals("v1", unchanged.historyVersion)
        assertTrue(unchanged.hasMore)
    }

    private suspend fun TestScope.parse(json: String): WsEvent {
        val events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 4)
        var result: WsEvent? = null
        val job = backgroundScope.launch(kotlinx.coroutines.test.UnconfinedTestDispatcher(testScheduler)) {
            events.collect { result = it }
        }
        parseWsEvent(
            text = json,
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
            skills = MutableStateFlow<List<SkillConfig>>(emptyList()),
            skillAgentUsage = MutableStateFlow(emptyMap()),
            artifacts = MutableStateFlow<List<ArtifactSummary>>(emptyList()),
            wikiEntries = MutableStateFlow<List<WikiEntry>>(emptyList()),
            promptEntries = MutableStateFlow<List<PromptEntry>>(emptyList()),
            cliStatus = MutableStateFlow<Map<String, CliInstallInfo>>(emptyMap()),
            scheduledTasks = MutableStateFlow<List<ScheduledTask>>(emptyList()),
            scheduledRuns = MutableStateFlow<Map<String, List<ScheduledRun>>>(emptyMap()),
            currentDebrief = MutableStateFlow<ConversationDebrief?>(null),
            completedConversationIds = MutableStateFlow(emptySet()),
            currentRating = MutableStateFlow(null),
            ratingsList = MutableStateFlow(emptyList()),
            ratingStats = MutableStateFlow(null),
        )
        testScheduler.runCurrent()
        job.cancel()
        return requireNotNull(result)
    }
}
