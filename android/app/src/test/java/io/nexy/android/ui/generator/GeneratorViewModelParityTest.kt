package io.nexy.android.ui.generator

import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.parseWsEvent
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AgentGeneratorSpec
import io.nexy.android.data.model.AgentGeneratorTools
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactGeneratorSpec
import io.nexy.android.data.model.ArtifactOutputFile
import io.nexy.android.data.model.ArtifactSourceContext
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
import io.nexy.android.data.model.SkillGeneratorSpec
import io.nexy.android.data.model.SkillGeneratorTools
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.agentgenerator.AgentGenMessage
import io.nexy.android.ui.agentgenerator.AgentGenPhase
import io.nexy.android.ui.agentgenerator.AgentGeneratorViewModel
import io.nexy.android.ui.artifactgenerator.ArtifactGenMessage
import io.nexy.android.ui.artifactgenerator.ArtifactGenPhase
import io.nexy.android.ui.artifactgenerator.ArtifactGeneratorViewModel
import io.nexy.android.ui.projectgenerator.ProjectGeneratorViewModel
import io.nexy.android.ui.skillgenerator.SkillGenMessage
import io.nexy.android.ui.skillgenerator.SkillGenPhase
import io.nexy.android.ui.skillgenerator.SkillGeneratorViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GeneratorViewModelParityTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun generatorParserHandlesDesktopEventShapes() = runTest {
        val agentToken = parseEvent(
            """{"event":"agent-generator:token","data":{"sessionId":"agent-session","chunk":"Agent chunk"}}"""
        )
        assertEquals(WsEvent.AgentGeneratorToken("agent-session", "Agent chunk"), agentToken)

        val agentSpec = parseEvent(
            """
            {
              "event": "agent-generator:spec-ready",
              "data": {
                "sessionId": "agent-session",
                "spec": {
                  "name": "Reviewer",
                  "icon": "R",
                  "systemPrompt": "Review code",
                  "temperature": 0.4,
                  "responseFormat": "detailed",
                  "agenticMode": true,
                  "tools": { "fileEdit": true, "terminal": false, "webFetch": true },
                  "rootDirectory": "/repo",
                  "contextDirectories": ["src"],
                  "memory": "Prefer small changes"
                }
              }
            }
            """.trimIndent()
        )
        assertEquals(WsEvent.AgentGeneratorSpecReady("agent-session", agentSpec()), agentSpec)

        val artifactSpec = parseEvent(
            """
            {
              "event": "artifact-generator:spec-ready",
              "data": {
                "sessionId": "artifact-session",
                "spec": {
                  "title": "Release notes",
                  "kind": "document",
                  "scope": { "type": "project", "projectId": "project-1" },
                  "intendedUse": "Publish changes",
                  "audience": "Users",
                  "outputFiles": [
                    {
                      "path": "release-notes.md",
                      "mediaType": "text/markdown",
                      "role": "primary",
                      "description": "Release notes"
                    }
                  ],
                  "acceptanceCriteria": ["Accurate"],
                  "exportFormats": ["markdown"],
                  "sourceContext": {
                    "useProjectInstructions": true,
                    "useProjectWiki": false,
                    "useConversationContext": true,
                    "referencedFiles": ["CHANGELOG.md"]
                  }
                }
              }
            }
            """.trimIndent()
        )
        assertEquals(WsEvent.ArtifactGeneratorSpecReady("artifact-session", artifactSpec()), artifactSpec)

        val skillSpec = parseEvent(
            """
            {
              "event": "skill-generator:spec-ready",
              "data": {
                "sessionId": "skill-session",
                "spec": {
                  "name": "Drawing",
                  "icon": "D",
                  "description": "Draw diagrams",
                  "instructions": "Use concise labels",
                  "tools": { "fileEdit": true, "terminal": false, "webFetch": true },
                  "tags": ["visual"]
                }
              }
            }
            """.trimIndent()
        )
        assertEquals(WsEvent.SkillGeneratorSpecReady("skill-session", skillSpec()), skillSpec)

        assertEquals(
            WsEvent.SkillGeneratorCreated("skill-session", "skill-1", "Drawing"),
            parseEvent("""{"event":"skill-generator:created","data":{"sessionId":"skill-session","skillId":"skill-1","name":"Drawing"}}"""),
        )
        assertEquals(
            WsEvent.ArtifactGeneratorError("artifact-session", "failed"),
            parseEvent("""{"event":"artifact-generator:error","data":{"sessionId":"artifact-session","message":"failed"}}"""),
        )
        assertEquals(
            WsEvent.ArtifactGeneratorCreated("artifact-session", "artifact-1", "Release notes"),
            parseEvent("""{"event":"artifact-generator:created","data":{"sessionId":"artifact-session","artifactId":"artifact-1","title":"Release notes"}}"""),
        )
        assertEquals(
            WsEvent.AgentGeneratorCancelled("agent-session"),
            parseEvent("""{"event":"agent-generator:cancelled","data":{"sessionId":"agent-session"}}"""),
        )
    }

    @Test
    fun agentGeneratorHandlesTokenSpecCreatedErrorAndCancelFlows() = runTest {
        val fakeWs = FakeWsClient()
        val vm = AgentGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.activeSessionId

        vm.sendMessage("Create an agent")
        fakeWs.emit(WsEvent.AgentGeneratorToken(sessionId, "Draft "))
        fakeWs.emit(WsEvent.AgentGeneratorToken(sessionId, "agent"))
        fakeWs.emit(WsEvent.AgentGeneratorTurnComplete(sessionId, "Draft agent", hasSpec = false))
        advanceUntilIdle()
        assertFalse(vm.uiState.value.isLoading)
        assertEquals(AgentGenMessage("assistant", "Draft agent"), vm.uiState.value.messages.last())

        val spec = agentSpec()
        fakeWs.emit(WsEvent.AgentGeneratorSpecReady(sessionId, spec))
        advanceUntilIdle()
        assertEquals(AgentGenPhase.SPEC_REVIEW, vm.uiState.value.phase)
        assertEquals(spec, vm.uiState.value.pendingSpec)

        fakeWs.emit(WsEvent.AgentGeneratorCreated(sessionId, "agent-1", "Reviewer"))
        advanceUntilIdle()
        assertEquals(AgentGenPhase.DONE, vm.uiState.value.phase)
        assertEquals("agent-1", vm.uiState.value.createdAgentId)

        fakeWs.emit(WsEvent.AgentGeneratorError(sessionId, "failed"))
        advanceUntilIdle()
        assertEquals("failed", vm.uiState.value.error)

        fakeWs.emit(WsEvent.AgentGeneratorCancelled(sessionId))
        advanceUntilIdle()
        assertEquals(AgentGenPhase.CHAT, vm.uiState.value.phase)
        assertEquals(null, vm.uiState.value.error)

        vm.viewModelScope.cancel()
    }

    @Test
    fun skillGeneratorUsesInjectedClientAndHandlesFullFlow() = runTest {
        val fakeWs = FakeWsClient()
        val vm = SkillGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.activeSessionId

        vm.sendMessage("Create a skill")
        assertEquals("skill-generator:start", fakeWs.sentCommands.single().command)

        fakeWs.emit(WsEvent.SkillGeneratorToken(sessionId, "Skill "))
        fakeWs.emit(WsEvent.SkillGeneratorTurnComplete(sessionId, "Skill idea", hasSpec = false))
        advanceUntilIdle()
        assertEquals(SkillGenMessage("assistant", "Skill idea"), vm.uiState.value.messages.last())

        val spec = skillSpec()
        fakeWs.emit(WsEvent.SkillGeneratorSpecReady(sessionId, spec))
        advanceUntilIdle()
        assertEquals(SkillGenPhase.SPEC_REVIEW, vm.uiState.value.phase)
        assertEquals(spec, vm.uiState.value.pendingSpec)

        vm.confirmSpec()
        advanceUntilIdle()
        assertEquals("skill-generator:confirm", fakeWs.sentCommands.last().command)

        fakeWs.emit(WsEvent.SkillGeneratorCreated(sessionId, "skill-1", "Drawing"))
        fakeWs.emit(WsEvent.SkillGeneratorError(sessionId, "failed"))
        advanceUntilIdle()
        assertEquals(SkillGenPhase.DONE, vm.uiState.value.phase)
        assertEquals("skill-1", vm.uiState.value.createdSkillId)
        assertEquals("failed", vm.uiState.value.error)

        fakeWs.emit(WsEvent.SkillGeneratorCancelled(sessionId))
        advanceUntilIdle()
        assertEquals(SkillGenPhase.CHAT, vm.uiState.value.phase)

        vm.viewModelScope.cancel()
    }

    @Test
    fun artifactGeneratorUsesInjectedClientAndHandlesSpecErrorCancelFlows() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ArtifactGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.sessionId

        vm.sendMessage("Create an artifact")
        assertEquals("artifact-generator:start", fakeWs.sentCommands.single().command)
        advanceUntilIdle()

        fakeWs.emit(WsEvent.ArtifactGeneratorToken(null, "Artifact "))
        advanceUntilIdle()
        fakeWs.emit(WsEvent.ArtifactGeneratorTurnComplete(null, "Artifact draft", hasSpec = false))
        advanceUntilIdle()
        assertEquals(ArtifactGenMessage("assistant", "Artifact draft"), vm.uiState.value.messages.last())

        val spec = artifactSpec()
        fakeWs.emit(WsEvent.ArtifactGeneratorSpecReady(null, spec))
        advanceUntilIdle()
        assertEquals(ArtifactGenPhase.SPEC_REVIEW, vm.uiState.value.phase)
        assertEquals(spec, vm.uiState.value.pendingSpec)

        vm.confirmSpec()
        advanceUntilIdle()
        assertEquals("artifact-generator:generate", fakeWs.sentCommands.last().command)

        fakeWs.emit(WsEvent.ArtifactGeneratorCreated(null, "artifact-1", "Release notes"))
        advanceUntilIdle()
        assertEquals(ArtifactGenPhase.DONE, vm.uiState.value.phase)
        assertEquals("artifact-1", vm.uiState.value.createdArtifactId)

        fakeWs.emit(WsEvent.ArtifactGeneratorError(null, "failed"))
        advanceUntilIdle()
        assertEquals("failed", vm.uiState.value.error)

        fakeWs.emit(WsEvent.ArtifactGeneratorCancelled(null))
        advanceUntilIdle()
        assertEquals(ArtifactGenPhase.CHAT, vm.uiState.value.phase)
        assertEquals(null, vm.uiState.value.error)

        vm.viewModelScope.cancel()
    }

    private fun agentSpec() = AgentGeneratorSpec(
        name = "Reviewer",
        icon = "R",
        systemPrompt = "Review code",
        temperature = 0.4,
        responseFormat = "detailed",
        agenticMode = true,
        tools = AgentGeneratorTools(fileEdit = true, terminal = false, webFetch = true),
        rootDirectory = "/repo",
        contextDirectories = listOf("src"),
        memory = "Prefer small changes",
    )

    private fun skillSpec() = SkillGeneratorSpec(
        name = "Drawing",
        icon = "D",
        description = "Draw diagrams",
        instructions = "Use concise labels",
        tools = SkillGeneratorTools(fileEdit = true, terminal = false, webFetch = true),
        tags = listOf("visual"),
    )

    private fun artifactSpec() = ArtifactGeneratorSpec(
        title = "Release notes",
        kind = "document",
        scopeType = "project",
        scopeProjectId = "project-1",
        intendedUse = "Publish changes",
        audience = "Users",
        outputFiles = listOf(
            ArtifactOutputFile(
                path = "release-notes.md",
                mediaType = "text/markdown",
                role = "primary",
                description = "Release notes",
            ),
        ),
        acceptanceCriteria = listOf("Accurate"),
        exportFormats = listOf("markdown"),
        sourceContext = ArtifactSourceContext(
            useProjectInstructions = true,
            useProjectWiki = false,
            useConversationContext = true,
            referencedFiles = listOf("CHANGELOG.md"),
        ),
    )

    // ── New parity tests ────────────────────────────────────────────────────────

    @Test
    fun projectGeneratorModelEventUpdatesResolvedModel() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ProjectGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.activeSessionId

        fakeWs.emit(WsEvent.ProjectGeneratorModel(sessionId, "anthropic:claude-sonnet-4-6"))
        advanceUntilIdle()
        assertEquals("anthropic:claude-sonnet-4-6", vm.uiState.value.resolvedModel)
        assertEquals(null, vm.uiState.value.selectedModel)

        vm.setModel("openai:gpt-4o")
        assertEquals("openai:gpt-4o", vm.uiState.value.selectedModel)
        vm.setModel(null)
        assertEquals(null, vm.uiState.value.selectedModel)

        vm.viewModelScope.cancel()
    }

    @Test
    fun projectGeneratorSendsModelInPayloadWhenSelected() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ProjectGeneratorViewModel(fakeWs)
        advanceUntilIdle()

        vm.setModel("openai:gpt-4o")
        vm.sendMessage("Hello")
        advanceUntilIdle()

        val cmd = fakeWs.sentCommands.last()
        assertEquals("project-generator:start", cmd.command)
        assertEquals("openai:gpt-4o", cmd.data["model"])

        vm.viewModelScope.cancel()
    }

    @Test
    fun projectGeneratorInsertPromptAndRetry() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ProjectGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.activeSessionId

        vm.insertPromptText("Use TDD")
        assertEquals("Use TDD", vm.uiState.value.promptInsert?.second)

        vm.sendMessage("Build a todo app")
        fakeWs.emit(WsEvent.ProjectGeneratorError(sessionId, "Provider error"))
        advanceUntilIdle()
        assertEquals("Provider error", vm.uiState.value.error)

        vm.retryLastMessage()
        advanceUntilIdle()
        assertEquals(null, vm.uiState.value.error)
        assertEquals("project-generator:message", fakeWs.sentCommands.last().command)

        vm.dismissError()
        assertEquals(null, vm.uiState.value.error)

        vm.viewModelScope.cancel()
    }

    @Test
    fun skillGeneratorModelEventUpdatesResolvedModel() = runTest {
        val fakeWs = FakeWsClient()
        val vm = SkillGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.activeSessionId

        fakeWs.emit(WsEvent.SkillGeneratorModel(sessionId, "anthropic:claude-haiku-4-5"))
        advanceUntilIdle()
        assertEquals("anthropic:claude-haiku-4-5", vm.uiState.value.resolvedModel)

        vm.setModel("claude-cli:claude-sonnet-4-6")
        assertEquals("claude-cli:claude-sonnet-4-6", vm.uiState.value.selectedModel)

        vm.viewModelScope.cancel()
    }

    @Test
    fun skillGeneratorSendsModelInPayloadAndInsertPrompt() = runTest {
        val fakeWs = FakeWsClient()
        val vm = SkillGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.activeSessionId

        vm.setModel("openai:gpt-4o-mini")
        vm.sendMessage("Create a coding skill")
        advanceUntilIdle()

        val cmd = fakeWs.sentCommands.last()
        assertEquals("skill-generator:start", cmd.command)
        assertEquals("openai:gpt-4o-mini", cmd.data["model"])

        vm.insertPromptText("Focus on Python")
        assertEquals("Focus on Python", vm.uiState.value.promptInsert?.second)

        fakeWs.emit(WsEvent.SkillGeneratorError(sessionId, "Timeout"))
        advanceUntilIdle()
        assertEquals("Timeout", vm.uiState.value.error)

        vm.retryLastMessage()
        advanceUntilIdle()
        assertEquals(null, vm.uiState.value.error)

        vm.viewModelScope.cancel()
    }

    @Test
    fun artifactGeneratorModelEventUpdatesResolvedModel() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ArtifactGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.sessionId

        fakeWs.emit(WsEvent.ArtifactGeneratorModel(sessionId, "openai:gpt-4o"))
        advanceUntilIdle()
        assertEquals("openai:gpt-4o", vm.uiState.value.resolvedModel)

        fakeWs.emit(WsEvent.ArtifactGeneratorModel(null, "anthropic:claude-opus-4-8"))
        advanceUntilIdle()
        assertEquals("anthropic:claude-opus-4-8", vm.uiState.value.resolvedModel)

        vm.viewModelScope.cancel()
    }

    @Test
    fun artifactGeneratorSendsModelInPayloadAndInsertPrompt() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ArtifactGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.sessionId

        vm.setModel("openai:gpt-4o")
        vm.sendMessage("Create release notes")
        advanceUntilIdle()

        val cmd = fakeWs.sentCommands.last()
        assertEquals("artifact-generator:start", cmd.command)
        assertEquals("openai:gpt-4o", cmd.data["model"])

        vm.insertPromptText("Keep it concise")
        assertEquals("Keep it concise", vm.uiState.value.promptInsert?.second)

        fakeWs.emit(WsEvent.ArtifactGeneratorError(sessionId, "Model error"))
        advanceUntilIdle()
        assertEquals("Model error", vm.uiState.value.error)

        vm.retryLastMessage()
        advanceUntilIdle()
        assertEquals(null, vm.uiState.value.error)

        vm.viewModelScope.cancel()
    }

    @Test
    fun allGeneratorsParseModelEventsFromJson() = runTest {
        val pgModel = parseEvent(
            """{"event":"project-generator:model","data":{"sessionId":"pg-1","modelId":"anthropic:claude-sonnet-4-6"}}"""
        )
        assertEquals(WsEvent.ProjectGeneratorModel("pg-1", "anthropic:claude-sonnet-4-6"), pgModel)

        val sgModel = parseEvent(
            """{"event":"skill-generator:model","data":{"sessionId":"sg-1","modelId":"openai:gpt-4o"}}"""
        )
        assertEquals(WsEvent.SkillGeneratorModel("sg-1", "openai:gpt-4o"), sgModel)

        val agModel = parseEvent(
            """{"event":"artifact-generator:model","data":{"sessionId":"ag-1","modelId":"claude-cli:claude-haiku-4-5-20251001"}}"""
        )
        assertEquals(WsEvent.ArtifactGeneratorModel("ag-1", "claude-cli:claude-haiku-4-5-20251001"), agModel)
    }

    private data class SentCommand(val command: String, val data: Map<String, Any>)

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

    private class FakeWsClient : WsClient {
        private val mutableEvents = MutableSharedFlow<WsEvent>(extraBufferCapacity = 16)
        override val events: SharedFlow<WsEvent> = mutableEvents
        val sentCommands = mutableListOf<SentCommand>()

        override fun send(command: String, data: Map<String, Any>) {
            sentCommands += SentCommand(command, data)
        }

        suspend fun emit(event: WsEvent) {
            mutableEvents.emit(event)
        }
    }
}
