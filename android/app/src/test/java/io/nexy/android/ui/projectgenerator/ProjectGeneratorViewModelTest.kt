package io.nexy.android.ui.projectgenerator

import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.model.ProjectGeneratorAgentSpec
import io.nexy.android.data.model.ProjectGeneratorAgentTools
import io.nexy.android.data.model.ProjectGeneratorNewAgent
import io.nexy.android.data.model.ProjectGeneratorSpec
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
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
class ProjectGeneratorViewModelTest {
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
    fun commitsAssistantTurnAndStopsLoading() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ProjectGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.activeSessionId

        vm.sendMessage("Create a project")
        fakeWs.emit(WsEvent.ProjectGeneratorToken(sessionId, "What is "))
        fakeWs.emit(WsEvent.ProjectGeneratorToken(sessionId, "the path?"))
        fakeWs.emit(WsEvent.ProjectGeneratorTurnComplete(sessionId, "What is the path?"))
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
        assertEquals(ProjectGenMessage("assistant", "What is the path?"), vm.uiState.value.messages.last())

        vm.viewModelScope.cancel()
    }

    @Test
    fun ignoresEventsForOtherSessions() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ProjectGeneratorViewModel(fakeWs)
        advanceUntilIdle()

        vm.sendMessage("Create a project")
        fakeWs.emit(WsEvent.ProjectGeneratorToken("other-session", "Ignored"))
        fakeWs.emit(WsEvent.ProjectGeneratorTurnComplete("other-session", "Ignored"))
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isLoading)
        assertEquals("", vm.uiState.value.streamingText)
        assertEquals(2, vm.uiState.value.messages.size)
        assertEquals(ProjectGenMessage("user", "Create a project"), vm.uiState.value.messages.last())

        vm.viewModelScope.cancel()
    }

    @Test
    fun confirmSendsCompleteSpecPayload() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ProjectGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val spec = ProjectGeneratorSpec(
            name = "Demo",
            color = "blue",
            instructions = "Use tests",
            rootDirectory = "/tmp/demo",
            instructionMode = "prepend",
            variables = listOf(mapOf("key" to "ENV", "value" to "dev")),
            inScope = listOf(mapOf("description" to "Source", "pathGlob" to "src/**")),
            outOfScope = listOf(mapOf("description" to "Build output")),
            milestones = listOf(mapOf("title" to "MVP", "status" to "active")),
            orchestrationEnabled = true,
            defaultModel = "openai:gpt-5-mini",
            agents = listOf(
                ProjectGeneratorAgentSpec(
                    role = "Lead",
                    description = "Leads work",
                    existingAgentId = null,
                    isLeader = true,
                    newAgent = ProjectGeneratorNewAgent(
                        name = "Lead",
                        icon = "L",
                        systemPrompt = "Lead the work",
                        temperature = 0.5,
                        responseFormat = "detailed",
                        tools = ProjectGeneratorAgentTools(fileEdit = true, terminal = true, webFetch = false),
                    ),
                ),
            ),
        )

        vm.updateSpec(spec)
        vm.confirmSpec()
        advanceUntilIdle()

        val command = fakeWs.sentCommands.single()
        assertEquals("project-generator:confirm", command.command)
        val payload = command.data["spec"] as Map<*, *>
        assertEquals("/tmp/demo", payload["rootDirectory"])
        assertEquals("prepend", payload["instructionMode"])
        assertEquals("openai:gpt-5-mini", payload["defaultModel"])
        val agents = payload["agents"] as List<*>
        val agent = agents.single() as Map<*, *>
        val newAgent = agent["newAgent"] as Map<*, *>
        assertEquals("detailed", newAgent["responseFormat"])
        assertEquals(0.5, newAgent["temperature"])

        vm.viewModelScope.cancel()
    }

    private data class SentCommand(val command: String, val data: Map<String, Any>)

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
