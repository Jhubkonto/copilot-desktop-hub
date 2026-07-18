package io.nexy.android.ui.schedulegenerator

import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ScheduleGeneratorSpec
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.generator.GenEvent
import io.nexy.android.ui.generator.GenMessage
import io.nexy.android.ui.generator.GenPhase
import io.nexy.android.ui.generator.GeneratorViewModel
import io.nexy.android.ui.generator.mapState
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

typealias ScheduleGenMessage = GenMessage

typealias ScheduleGenPhase = GenPhase

private const val GREETING = "Let's create a scheduled task. Describe what should run, when it should run, and whether it should use a project or agent."

data class ScheduleGeneratorUiState(
    val phase: ScheduleGenPhase = GenPhase.CHAT,
    val messages: List<ScheduleGenMessage> = listOf(GenMessage("assistant", GREETING)),
    val streamingText: String = "",
    val pendingSpec: ScheduleGeneratorSpec? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val createdTaskName: String? = null,
    val createdTaskId: String? = null,
    val activeSessionId: String = UUID.randomUUID().toString(),
    val promptInsert: Pair<Int, String>? = null,
    val selectedModel: String? = null,
    val resolvedModel: String? = null,
)

class ScheduleGeneratorViewModel(
    wsClient: WsClient = WsRepository,
) : GeneratorViewModel<ScheduleGeneratorSpec>(wsClient, "scheduler-generator", "schedule-spec", GREETING) {

    val uiState: StateFlow<ScheduleGeneratorUiState> = state.mapState { s ->
        ScheduleGeneratorUiState(
            phase = s.phase,
            messages = s.messages,
            streamingText = s.streamingText,
            pendingSpec = s.pendingSpec,
            isLoading = s.isLoading,
            error = s.error,
            createdTaskName = s.createdName,
            createdTaskId = s.createdId,
            activeSessionId = s.activeSessionId,
            promptInsert = s.promptInsert,
            selectedModel = s.selectedModel,
            resolvedModel = s.resolvedModel,
        )
    }

    override fun mapEvent(event: WsEvent): GenEvent<ScheduleGeneratorSpec>? = when (event) {
        is WsEvent.SchedulerGeneratorModel -> GenEvent.Model(event.sessionId, event.modelId)
        is WsEvent.SchedulerGeneratorToken -> GenEvent.Token(event.sessionId, event.chunk)
        is WsEvent.SchedulerGeneratorTurnComplete -> GenEvent.TurnComplete(event.sessionId, event.content, event.hasSpec)
        is WsEvent.SchedulerGeneratorSpecReady -> GenEvent.SpecReady(event.sessionId, event.spec)
        is WsEvent.SchedulerGeneratorCreated -> GenEvent.Created(event.sessionId, event.taskId, event.name)
        is WsEvent.SchedulerGeneratorError -> GenEvent.Error(event.sessionId, event.message)
        is WsEvent.SchedulerGeneratorCancelled -> GenEvent.Cancelled(event.sessionId)
        else -> null
    }

    fun setupManually() {
        enterSpecReview(
            ScheduleGeneratorSpec(
                name = "",
                prompt = "",
                scheduleType = "daily",
                localTime = "09:00",
                timezone = java.util.TimeZone.getDefault().id,
                notificationPref = "always",
            ),
        )
    }

    override fun specPayload(spec: ScheduleGeneratorSpec): Map<String, Any> = with(spec) {
        val payload = mutableMapOf<String, Any>(
            "name" to name,
            "prompt" to prompt,
            "scheduleType" to scheduleType,
            "localTime" to localTime,
            "timezone" to timezone,
            "notificationPref" to notificationPref,
        )
        weekday?.let { payload["weekday"] = it }
        monthDay?.let { payload["monthDay"] = it }
        agentId?.let { payload["agentId"] = it }
        projectId?.let { payload["projectId"] = it }
        payload["targetType"] = targetType
        sourceRunId?.let { payload["sourceRunId"] = it }
        payload
    }
}
