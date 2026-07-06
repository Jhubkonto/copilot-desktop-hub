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

// Regression coverage for the manual workflow generator wire protocol: the desktop actually
// emits "spec-ready" (nested spec object), "token" (streaming chunks), and "turn-complete"
// (final assistant content), not "ready"/"message" as the parser previously listened for —
// meaning the feature was completely non-functional despite the screen existing.
@OptIn(ExperimentalCoroutinesApi::class)
class ManualWorkflowEventParserTest {

    @Test
    fun specReadyParsesNestedSpecWithArrayAssumptionsAndSteps() = runTest {
        val event = parseEvent(
            """
            {
              "event": "manual-workflow-generator:spec-ready",
              "data": {
                "sessionId": "session-1",
                "spec": {
                  "title": "Release Prep",
                  "goalSummary": "Ship the release",
                  "assumptions": ["CI is green", "Staging is up to date"],
                  "steps": [
                    { "id": "s1", "title": "Run tests", "summary": "Execute full suite", "prompt": "run tests", "expectedOutput": "green" },
                    { "id": "s2", "title": "Tag release", "summary": "Create git tag", "prompt": "tag it", "expectedOutput": "tag pushed" }
                  ]
                }
              }
            }
            """.trimIndent()
        ) as WsEvent.ManualWorkflowReady

        assertEquals("session-1", event.sessionId)
        assertEquals("Release Prep", event.title)
        assertEquals("Ship the release", event.goalSummary)
        assertEquals("CI is green\nStaging is up to date", event.assumptions)
        assertEquals(listOf("Run tests", "Tag release"), event.steps.map { it.title })
        assertEquals(listOf("Execute full suite", "Create git tag"), event.steps.map { it.summary })
        assertEquals(listOf("run tests", "tag it"), event.steps.map { it.prompt })
        assertEquals(listOf("green", "tag pushed"), event.steps.map { it.expectedOutput })
        assertEquals(listOf<String?>(null, null), event.steps.map { it.agentName })
    }

    @Test
    fun tokenEventParsesStreamingChunk() = runTest {
        val event = parseEvent(
            """
            {
              "event": "manual-workflow-generator:token",
              "data": { "sessionId": "session-1", "chunk": "Hello" }
            }
            """.trimIndent()
        ) as WsEvent.ManualWorkflowToken

        assertEquals("session-1", event.sessionId)
        assertEquals("Hello", event.chunk)
    }

    @Test
    fun turnCompleteParsesAsManualWorkflowMessage() = runTest {
        val event = parseEvent(
            """
            {
              "event": "manual-workflow-generator:turn-complete",
              "data": { "sessionId": "session-1", "content": "Here is your plan.", "hasSpec": true }
            }
            """.trimIndent()
        ) as WsEvent.ManualWorkflowMessage

        assertEquals("session-1", event.sessionId)
        assertEquals("Here is your plan.", event.message)
    }

    @Test
    fun modelEventParsesModelId() = runTest {
        val event = parseEvent(
            """
            {
              "event": "manual-workflow-generator:model",
              "data": { "sessionId": "session-1", "modelId": "claude-sonnet-4-6" }
            }
            """.trimIndent()
        ) as WsEvent.ManualWorkflowModel

        assertEquals("session-1", event.sessionId)
        assertEquals("claude-sonnet-4-6", event.modelId)
    }

    @Test
    fun errorEventParsesMessage() = runTest {
        val event = parseEvent(
            """
            {
              "event": "manual-workflow-generator:error",
              "data": { "sessionId": "session-1", "message": "No configured provider" }
            }
            """.trimIndent()
        ) as WsEvent.ManualWorkflowError

        assertEquals("session-1", event.sessionId)
        assertEquals("No configured provider", event.message)
    }

    @Test
    fun cancelledEventParsesSessionId() = runTest {
        val event = parseEvent(
            """
            {
              "event": "manual-workflow-generator:cancelled",
              "data": { "sessionId": "session-1" }
            }
            """.trimIndent()
        ) as WsEvent.ManualWorkflowCancelled

        assertEquals("session-1", event.sessionId)
    }

    @Test
    fun specReadyPreservesStepFieldsIndependentlyWhenSummaryBlank() = runTest {
        // Regression: the parser used to collapse title+summary into a single flattened
        // string and silently drop prompt/agentName/expectedOutput entirely, so Android
        // could show step titles but never let the user act on a step (no copyable prompt,
        // no agent/output info) — this is what actually made the generator feel unusable.
        val event = parseEvent(
            """
            {
              "event": "manual-workflow-generator:spec-ready",
              "data": {
                "sessionId": "session-1",
                "spec": {
                  "title": "T",
                  "goalSummary": "G",
                  "assumptions": [],
                  "steps": [ { "id": "s1", "title": "Only title", "summary": "", "agentName": "Builder", "prompt": "p", "expectedOutput": "e" } ]
                }
              }
            }
            """.trimIndent()
        ) as WsEvent.ManualWorkflowReady

        val step = event.steps.single()
        assertEquals("s1", step.id)
        assertEquals("Only title", step.title)
        assertTrue(step.summary.isEmpty())
        assertEquals("Builder", step.agentName)
        assertEquals("p", step.prompt)
        assertEquals("e", step.expectedOutput)
        assertTrue(event.assumptions.isEmpty())
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
        )
        testScheduler.advanceUntilIdle()
        return events.replayCache.lastOrNull() ?: throw AssertionError("No websocket event parsed from: $raw")
    }
}
