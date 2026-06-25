package io.nexy.android.ui.schedulegenerator

import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.model.ScheduleGeneratorSpec
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
class ScheduleGeneratorViewModelTest {
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
        val vm = ScheduleGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val sessionId = vm.uiState.value.activeSessionId

        vm.sendMessage("Create a daily task")
        fakeWs.emit(WsEvent.SchedulerGeneratorToken(sessionId, "What time?"))
        fakeWs.emit(WsEvent.SchedulerGeneratorTurnComplete(sessionId, "What time?"))
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
        assertEquals(ScheduleGenMessage("assistant", "What time?"), vm.uiState.value.messages.last())

        vm.viewModelScope.cancel()
    }

    @Test
    fun ignoresEventsForOtherSessions() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ScheduleGeneratorViewModel(fakeWs)
        advanceUntilIdle()

        vm.sendMessage("Create a daily task")
        fakeWs.emit(WsEvent.SchedulerGeneratorToken("other-session", "Ignored"))
        fakeWs.emit(WsEvent.SchedulerGeneratorTurnComplete("other-session", "Ignored"))
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isLoading)
        assertEquals("", vm.uiState.value.streamingText)
        assertEquals(ScheduleGenMessage("user", "Create a daily task"), vm.uiState.value.messages.last())

        vm.viewModelScope.cancel()
    }

    @Test
    fun confirmSendsCompleteSpecPayload() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ScheduleGeneratorViewModel(fakeWs)
        advanceUntilIdle()
        val spec = ScheduleGeneratorSpec(
            name = "Daily review",
            prompt = "Review open tasks",
            scheduleType = "daily",
            localTime = "09:00",
            timezone = "Europe/Berlin",
            agentId = "agent-1",
            projectId = "project-1",
            notificationPref = "always",
        )

        vm.updateSpec(spec)
        vm.confirmSpec()
        advanceUntilIdle()

        val command = fakeWs.sentCommands.single()
        assertEquals("scheduler-generator:confirm", command.command)
        val payload = command.data["spec"] as Map<*, *>
        assertEquals("Daily review", payload["name"])
        assertEquals("Review open tasks", payload["prompt"])
        assertEquals("daily", payload["scheduleType"])
        assertEquals("09:00", payload["localTime"])
        assertEquals("Europe/Berlin", payload["timezone"])
        assertEquals("agent-1", payload["agentId"])
        assertEquals("project-1", payload["projectId"])
        assertEquals("always", payload["notificationPref"])

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
