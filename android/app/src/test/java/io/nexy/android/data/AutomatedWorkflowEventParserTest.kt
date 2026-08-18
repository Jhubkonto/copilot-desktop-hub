package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.Conversation
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Regression coverage for the automated workflow generator wire protocol: the desktop actually
// emits "spec-ready" (nested spec object), "token" (streaming chunks), and "turn-complete"
// (final assistant content), not "ready"/"message" as the parser previously listened for —
// meaning the feature was completely non-functional despite the screen existing.
@OptIn(ExperimentalCoroutinesApi::class)
class AutomatedWorkflowEventParserTest {

    @Test
    fun specReadyParsesNestedSpecWithArrayAssumptionsAndSteps() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-generator:spec-ready",
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
        ) as WsEvent.AutomatedWorkflowReady

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
              "event": "automated-workflow-generator:token",
              "data": { "sessionId": "session-1", "chunk": "Hello" }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowToken

        assertEquals("session-1", event.sessionId)
        assertEquals("Hello", event.chunk)
    }

    @Test
    fun turnCompleteParsesAsAutomatedWorkflowMessage() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-generator:turn-complete",
              "data": { "sessionId": "session-1", "content": "Here is your plan.", "hasSpec": true }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowMessage

        assertEquals("session-1", event.sessionId)
        assertEquals("Here is your plan.", event.message)
    }

    @Test
    fun modelEventParsesModelId() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-generator:model",
              "data": { "sessionId": "session-1", "modelId": "claude-sonnet-4-6" }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowModel

        assertEquals("session-1", event.sessionId)
        assertEquals("claude-sonnet-4-6", event.modelId)
    }

    @Test
    fun errorEventParsesMessage() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-generator:error",
              "data": { "sessionId": "session-1", "message": "No configured provider" }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowError

        assertEquals("session-1", event.sessionId)
        assertEquals("No configured provider", event.message)
    }

    @Test
    fun cancelledEventParsesSessionId() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-generator:cancelled",
              "data": { "sessionId": "session-1" }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowCancelled

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
              "event": "automated-workflow-generator:spec-ready",
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
        ) as WsEvent.AutomatedWorkflowReady

        val step = event.steps.single()
        assertEquals("s1", step.id)
        assertEquals("Only title", step.title)
        assertTrue(step.summary.isEmpty())
        assertEquals("Builder", step.agentName)
        assertEquals("p", step.prompt)
        assertEquals("e", step.expectedOutput)
        assertTrue(event.assumptions.isEmpty())
    }

    @Test
    fun runsListParsesRunsWithConfirmationModeAndNewStepCounts() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-runs:list",
              "data": {
                "projectId": "proj-1",
                "runs": [
                  {
                    "id": "run-1", "projectId": "proj-1", "title": "Ship it", "goalSummary": "G",
                    "model": null, "status": "running", "confirmationMode": "auto", "currentStepId": "db-1",
                    "lastError": null,
                    "stepCounts": { "total": 2, "pending": 1, "running": 1, "awaitingConfirmation": 0, "done": 0, "failed": 0, "skipped": 0 },
                    "createdAt": 1, "updatedAt": 2
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowRunsList

        assertEquals("proj-1", event.projectId)
        val run = event.runs.single()
        assertEquals("running", run.status)
        assertEquals("auto", run.confirmationMode)
        assertEquals("db-1", run.currentStepId)
        assertNull(run.lastError)
        assertEquals(1, run.stepCounts.running)
        assertEquals(1, run.stepCounts.pending)
    }

    @Test
    fun runDetailParsesStepsWithAttemptOutputErrorAndConversationId() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-runs:detail",
              "data": {
                "run": {
                  "id": "run-1", "projectId": "proj-1", "title": "Ship it", "goalSummary": "G",
                  "model": null, "status": "failed", "confirmationMode": "gated", "currentStepId": null,
                  "lastError": "bad model",
                  "stepCounts": { "total": 1, "pending": 0, "running": 0, "awaitingConfirmation": 0, "done": 0, "failed": 1, "skipped": 0 },
                  "createdAt": 1, "updatedAt": 2, "assumptions": [],
                  "steps": [
                    {
                      "id": "s1", "dbId": "db-1", "runId": "run-1", "stepIndex": 0, "title": "Plan",
                      "summary": "", "agentId": "agent-1", "agentName": "Planner", "prompt": "p",
                      "expectedOutput": "", "dependsOnStepIds": [], "status": "failed", "attempt": 2,
                      "output": "", "error": "bad model", "conversationId": "conv-1",
                      "startedAt": 10, "completedAt": 20
                    }
                  ]
                }
              }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowRunDetailReady

        val run = requireNotNull(event.run)
        assertEquals("failed", run.status)
        assertEquals("bad model", run.lastError)
        val step = run.steps.single()
        assertEquals(2, step.attempt)
        assertEquals("bad model", step.error)
        assertEquals("conv-1", step.conversationId)
    }

    @Test
    fun runDiscardedParsesOkFalse() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-runs:discarded",
              "data": { "runId": "run-1", "ok": false }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowRunDiscarded

        assertEquals("run-1", event.runId)
        assertEquals(false, event.ok)
    }

    @Test
    fun stepStreamParsesRunIdStepDbIdAndChunk() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-runs:step-stream",
              "data": { "runId": "run-1", "stepDbId": "db-1", "chunk": "Thinking…" }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowStepStream

        assertEquals("run-1", event.runId)
        assertEquals("db-1", event.stepDbId)
        assertEquals("Thinking…", event.chunk)
    }

    @Test
    fun runsListParsesNullProjectIdAsNullNotEmptyString() = runTest {
        // Regression: a project-less (standalone) run's JSON projectId is a real null. optString
        // would silently coerce that to "", indistinguishable from a real (bogus) empty project
        // id — nullableString must be used so global runs round-trip as projectId == null.
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-runs:list",
              "data": {
                "projectId": null,
                "runs": [
                  {
                    "id": "run-1", "projectId": null, "title": "Standalone run", "goalSummary": "G",
                    "model": "claude-sonnet-4-6", "status": "running", "confirmationMode": "auto", "currentStepId": null,
                    "lastError": null,
                    "stepCounts": { "total": 1, "pending": 1, "running": 0, "awaitingConfirmation": 0, "done": 0, "failed": 0, "skipped": 0 },
                    "createdAt": 1, "updatedAt": 2
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowRunsList

        assertNull(event.projectId)
        val run = event.runs.single()
        assertNull(run.projectId)
        assertEquals("claude-sonnet-4-6", run.model)
    }

    @Test
    fun runDetailParsesStepModelAsAlternativeToAgent() = runTest {
        // A step fulfilled by a bare model (no agent) carries `model` instead of `agentId`/
        // `agentName` — skills never apply to a model-only step.
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-runs:detail",
              "data": {
                "run": {
                  "id": "run-1", "projectId": null, "title": "Ship it", "goalSummary": "G",
                  "model": null, "status": "running", "confirmationMode": "gated", "currentStepId": "db-1",
                  "lastError": null,
                  "stepCounts": { "total": 1, "pending": 0, "running": 1, "awaitingConfirmation": 0, "done": 0, "failed": 0, "skipped": 0 },
                  "createdAt": 1, "updatedAt": 2, "assumptions": [],
                  "steps": [
                    {
                      "id": "s1", "dbId": "db-1", "runId": "run-1", "stepIndex": 0, "title": "Draft copy",
                      "summary": "", "agentId": null, "agentName": null, "prompt": "p",
                      "expectedOutput": "", "dependsOnStepIds": [], "status": "running", "attempt": 1,
                      "output": "", "error": null, "conversationId": null, "model": "gpt-5.4",
                      "startedAt": 10, "completedAt": null
                    }
                  ]
                }
              }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowRunDetailReady

        val run = requireNotNull(event.run)
        assertNull(run.projectId)
        val step = run.steps.single()
        assertNull(step.agentId)
        assertNull(step.agentName)
        assertEquals("gpt-5.4", step.model)
    }

    @Test
    fun runsListAllParsesRunsAcrossProjectsIncludingGlobalOnes() = runTest {
        // Backs the global, top-level Automated Workflows list screen (dashboard 3-dot menu) —
        // distinct from the project-scoped "automated-workflow-runs:list" event.
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-runs:list-all",
              "data": {
                "runs": [
                  {
                    "id": "run-1", "projectId": "proj-1", "title": "Scoped", "goalSummary": "G",
                    "model": null, "status": "done", "confirmationMode": "auto", "currentStepId": null,
                    "lastError": null,
                    "stepCounts": { "total": 1, "pending": 0, "running": 0, "awaitingConfirmation": 0, "done": 1, "failed": 0, "skipped": 0 },
                    "createdAt": 1, "updatedAt": 2
                  },
                  {
                    "id": "run-2", "projectId": null, "title": "Standalone", "goalSummary": "G",
                    "model": "claude-sonnet-4-6", "status": "running", "confirmationMode": "auto", "currentStepId": null,
                    "lastError": null,
                    "stepCounts": { "total": 1, "pending": 1, "running": 0, "awaitingConfirmation": 0, "done": 0, "failed": 0, "skipped": 0 },
                    "createdAt": 1, "updatedAt": 2
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowRunsListAll

        assertEquals(listOf("proj-1", null), event.runs.map { it.projectId })
        assertEquals(listOf("Scoped", "Standalone"), event.runs.map { it.title })
    }

    @Test
    fun schedulerWorkflowTemplatesParsesCandidateRunsForAttachPicker() = runTest {
        // Backs the "attach an existing workflow to this schedule" picker in
        // SchedulerTaskForm.tsx / SchedulerTaskConfigScreen.kt.
        val event = parseEvent(
            """
            {
              "event": "scheduler:list-workflow-templates",
              "data": {
                "runs": [
                  {
                    "id": "run-1", "projectId": "proj-1", "title": "Release Prep", "goalSummary": "G",
                    "model": null, "status": "done", "confirmationMode": "auto", "currentStepId": null,
                    "lastError": null,
                    "stepCounts": { "total": 2, "pending": 0, "running": 0, "awaitingConfirmation": 0, "done": 2, "failed": 0, "skipped": 0 },
                    "createdAt": 1, "updatedAt": 2
                  }
                ]
              }
            }
            """.trimIndent()
        ) as WsEvent.SchedulerWorkflowTemplates

        val run = event.runs.single()
        assertEquals("run-1", run.id)
        assertEquals("Release Prep", run.title)
    }

    @Test
    fun runsErrorParsesMessage() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-runs:error",
              "data": { "message": "Missing runId or invalid mode" }
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowRunsError

        assertEquals("Missing runId or invalid mode", event.message)
    }

    @Test
    fun managedVersionParsesContentHistoryAndChecksum() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-managed:version",
              "data": {
                "version": {
                  "version": { "id": "v2", "artifactId": "a1", "versionNumber": 2, "title": "Weekly report", "primaryPath": "report.md", "mediaType": "text/markdown", "sizeBytes": 12, "checksum": "sha-2", "createdAt": 20 },
                  "content": "# Report\n",
                  "manifestJson": "{}",
                  "versions": [
                    { "id": "v2", "artifactId": "a1", "versionNumber": 2, "title": "Weekly report", "primaryPath": "report.md", "mediaType": "text/markdown", "sizeBytes": 12, "checksum": "sha-2", "createdAt": 20 },
                    { "id": "v1", "artifactId": "a1", "versionNumber": 1, "title": "Weekly report", "primaryPath": "report.md", "mediaType": "text/markdown", "sizeBytes": 10, "checksum": "sha-1", "createdAt": 10 }
                  ],
                  "futureOptionalField": true
                }
              }
            }
            """.trimIndent()
        ) as WsEvent.ManagedWorkflowVersionReady

        val version = requireNotNull(event.version)
        assertEquals("v2", version.version.id)
        assertEquals("# Report\n", version.content)
        assertEquals(listOf(2, 1), version.versions.map { it.versionNumber })
        assertEquals("sha-2", version.version.checksum)
    }

    @Test
    fun managedRunDetailParsesReviewProvenanceAndStaleState() = runTest {
        val event = parseEvent(
            """
            {
              "event": "automated-workflow-runs:detail",
              "data": { "run": {
                "id": "run-1", "projectId": "proj-1", "title": "Weekly report", "goalSummary": "G",
                "model": null, "status": "awaiting_confirmation", "confirmationMode": "auto", "currentStepId": "review-db", "lastError": null,
                "stepCounts": { "total": 1, "pending": 0, "running": 0, "awaitingConfirmation": 1, "done": 0, "failed": 0, "skipped": 0 },
                "createdAt": 1, "updatedAt": 2, "assumptions": [],
                "steps": [{
                  "id": "review", "dbId": "review-db", "runId": "run-1", "stepIndex": 0, "title": "Review", "summary": "",
                  "agentId": null, "agentName": null, "prompt": "Review", "expectedOutput": "Approved", "dependsOnStepIds": ["draft"],
                  "status": "awaiting_confirmation", "attempt": 1, "output": "", "error": null, "conversationId": null,
                  "startedAt": 10, "completedAt": null, "kind": "review",
                  "managed": {
                    "isManaged": true, "isStale": true,
                    "currentVersion": { "id": "v2", "artifactId": "a1", "versionNumber": 2, "title": "Weekly report", "primaryPath": "report.md", "mediaType": "text/markdown", "sizeBytes": 12, "checksum": "sha-2", "createdAt": 20 },
                    "bindings": [{ "id": "b1", "runId": "run-1", "stepDbId": "review-db", "stepAttempt": 1, "bindingName": "draft", "direction": "input", "artifactId": "a1", "artifactVersionId": "v2", "staleAt": 30, "createdAt": 20 }],
                    "latestReview": null, "publishPreview": null, "publishAction": null
                  }
                }]
              }}
            }
            """.trimIndent()
        ) as WsEvent.AutomatedWorkflowRunDetailReady

        val step = requireNotNull(event.run).steps.single()
        assertEquals("review", step.kind)
        assertTrue(requireNotNull(step.managed).isStale)
        assertEquals("v2", step.managed?.currentVersion?.id)
        assertEquals(30L, step.managed?.bindings?.single()?.staleAt)
    }

    @Test
    fun managedPublishPreviewAndActionParseConflictSafeFields() = runTest {
        val previewEvent = parseEvent(
            """
            { "event": "automated-workflow-managed:publish-preview", "data": { "preview": {
              "id": "p1", "runId": "r1", "stepDbId": "s1", "artifactVersionId": "v1", "projectSourceId": "src1",
              "relativePath": "reports/weekly.md", "destinationChecksum": null, "diffText": "@@ -0,0 +1 @@\n+# Weekly", "createdAt": 10, "expiresAt": 20, "invalidatedAt": null
            }}}
            """.trimIndent()
        ) as WsEvent.ManagedWorkflowPublishPreviewReady
        assertEquals("reports/weekly.md", previewEvent.preview.relativePath)
        assertNull(previewEvent.preview.destinationChecksum)

        val actionEvent = parseEvent(
            """
            { "event": "automated-workflow-managed:publish-action", "data": { "action": {
              "id": "action-1", "previewId": "p1", "idempotencyKey": "request-1", "status": "published",
              "approvedByClient": "android", "approvedAt": 11, "startedAt": 12, "completedAt": 13,
              "beforeRecoveryRef": null, "resultChecksum": "sha-final", "error": null
            }}}
            """.trimIndent()
        ) as WsEvent.ManagedWorkflowPublishActionReady
        assertEquals("published", actionEvent.action.status)
        assertEquals("sha-final", actionEvent.action.resultChecksum)
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
