package io.nexy.android.ui.schedulegenerator

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ScheduleGeneratorSpec
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class ScheduleGenMessage(val role: String, val content: String)

enum class ScheduleGenPhase { CHAT, SPEC_REVIEW, DONE }

private const val GREETING = "Let's create a scheduled task. Describe what should run, when it should run, and whether it should use a project or agent."

data class ScheduleGeneratorUiState(
    val phase: ScheduleGenPhase = ScheduleGenPhase.CHAT,
    val messages: List<ScheduleGenMessage> = listOf(ScheduleGenMessage("assistant", GREETING)),
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
    private val wsClient: WsClient = WsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ScheduleGeneratorUiState())
    val uiState: StateFlow<ScheduleGeneratorUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when (event) {
                    is WsEvent.SchedulerGeneratorModel -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(resolvedModel = event.modelId.ifBlank { null })
                    }
                    is WsEvent.SchedulerGeneratorToken -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            streamingText = _uiState.value.streamingText + event.chunk,
                        )
                    }
                    is WsEvent.SchedulerGeneratorTurnComplete -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        commitAssistantTurn(event.content)
                    }
                    is WsEvent.SchedulerGeneratorSpecReady -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            streamingText = "",
                            pendingSpec = event.spec,
                            phase = ScheduleGenPhase.SPEC_REVIEW,
                            isLoading = false,
                        )
                    }
                    is WsEvent.SchedulerGeneratorCreated -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            phase = ScheduleGenPhase.DONE,
                            createdTaskName = event.name,
                            createdTaskId = event.taskId,
                            isLoading = false,
                        )
                    }
                    is WsEvent.SchedulerGeneratorError -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(error = event.message, isLoading = false)
                    }
                    is WsEvent.SchedulerGeneratorCancelled -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = ScheduleGeneratorUiState()
                    }
                    else -> {}
                }
            }
        }
    }

    fun sendMessage(content: String) {
        val current = _uiState.value
        val userMsg = ScheduleGenMessage("user", content)
        val next = current.messages + userMsg
        _uiState.value = current.copy(messages = next, isLoading = true, streamingText = "", error = null)
        val payload = next.map { mapOf("role" to it.role, "content" to it.content) }
        val baseData = buildMap<String, Any> {
            put("sessionId", current.activeSessionId)
            put("messages", payload)
            current.selectedModel?.let { put("model", it) }
        }
        if (current.messages.size <= 1) {
            wsClient.send("scheduler-generator:start", baseData)
        } else {
            wsClient.send("scheduler-generator:message", baseData)
        }
    }

    fun setModel(modelId: String?) {
        _uiState.value = _uiState.value.copy(selectedModel = modelId)
    }

    fun confirmSpec() {
        val spec = _uiState.value.pendingSpec ?: return
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        wsClient.send("scheduler-generator:confirm", mapOf(
            "sessionId" to _uiState.value.activeSessionId,
            "spec" to spec.toPayload(),
        ))
    }

    fun reset() {
        wsClient.send("scheduler-generator:cancel", mapOf("sessionId" to _uiState.value.activeSessionId))
        _uiState.value = ScheduleGeneratorUiState()
    }

    fun updateSpec(spec: ScheduleGeneratorSpec) {
        _uiState.value = _uiState.value.copy(pendingSpec = spec)
    }

    fun backToChat() {
        _uiState.value = _uiState.value.copy(phase = ScheduleGenPhase.CHAT, error = null)
    }

    fun setupManually() {
        _uiState.value = _uiState.value.copy(
            phase = ScheduleGenPhase.SPEC_REVIEW,
            pendingSpec = ScheduleGeneratorSpec(
                name = "",
                prompt = "",
                scheduleType = "daily",
                localTime = "09:00",
                timezone = java.util.TimeZone.getDefault().id,
                notificationPref = "always",
            ),
        )
    }

    fun retryLastMessage() {
        val lastUserMsg = _uiState.value.messages.lastOrNull { it.role == "user" }?.content ?: return
        _uiState.value = _uiState.value.copy(error = null)
        sendMessage(lastUserMsg)
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    private var promptInsertCounter = 0

    fun insertPromptText(body: String) {
        _uiState.value = _uiState.value.copy(promptInsert = Pair(++promptInsertCounter, body))
    }

    private fun isActiveSession(sessionId: String?): Boolean =
        sessionId == null || sessionId == _uiState.value.activeSessionId

    private fun commitAssistantTurn(content: String) {
        val current = _uiState.value
        val clean = content.ifBlank { current.streamingText }
            .replace(Regex("<schedule-spec>[\\s\\S]*?</schedule-spec>"), "")
            .trim()
        _uiState.value = current.copy(
            streamingText = "",
            messages = if (clean.isBlank()) current.messages else current.messages + ScheduleGenMessage("assistant", clean),
            isLoading = false,
        )
    }

    private fun ScheduleGeneratorSpec.toPayload(): Map<String, Any> {
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
        return payload
    }
}
