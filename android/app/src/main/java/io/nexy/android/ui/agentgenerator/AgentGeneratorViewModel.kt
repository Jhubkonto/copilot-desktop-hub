package io.nexy.android.ui.agentgenerator

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AgentGeneratorSpec
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class AgentGenMessage(val role: String, val content: String)

enum class AgentGenPhase { CHAT, SPEC_REVIEW, DONE }

private const val GREETING = "Let's create a new agent. Describe what you want it to do, its personality, and any tools it should use."

data class AgentGeneratorUiState(
    val phase: AgentGenPhase = AgentGenPhase.CHAT,
    val messages: List<AgentGenMessage> = listOf(AgentGenMessage("assistant", GREETING)),
    val streamingText: String = "",
    val pendingSpec: AgentGeneratorSpec? = null,
    val isLoading: Boolean = false,
    val missedSpec: Boolean = false,
    val error: String? = null,
    val createdAgentName: String? = null,
    val createdAgentId: String? = null,
    val activeSessionId: String = UUID.randomUUID().toString(),
)

class AgentGeneratorViewModel(
    private val wsClient: WsClient = WsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AgentGeneratorUiState())
    val uiState: StateFlow<AgentGeneratorUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when (event) {
                    is WsEvent.AgentGeneratorToken -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            streamingText = _uiState.value.streamingText + event.chunk,
                        )
                    }
                    is WsEvent.AgentGeneratorTurnComplete -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        commitAssistantTurn(event.content, event.hasSpec)
                    }
                    is WsEvent.AgentGeneratorSpecReady -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            streamingText = "",
                            pendingSpec = event.spec,
                            phase = AgentGenPhase.SPEC_REVIEW,
                            isLoading = false,
                        )
                    }
                    is WsEvent.AgentGeneratorCreated -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            phase = AgentGenPhase.DONE,
                            createdAgentName = event.name,
                            createdAgentId = event.agentId,
                            isLoading = false,
                        )
                    }
                    is WsEvent.AgentGeneratorError -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            error = event.message,
                            isLoading = false,
                        )
                    }
                    is WsEvent.AgentGeneratorCancelled -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = AgentGeneratorUiState()
                    }
                    else -> {}
                }
            }
        }
    }

    fun sendMessage(content: String) {
        val current = _uiState.value
        val userMsg = AgentGenMessage("user", content)
        val next = current.messages + userMsg
        _uiState.value = current.copy(messages = next, isLoading = true, streamingText = "", missedSpec = false)
        val payload = next.map { mapOf("role" to it.role, "content" to it.content) }
        if (current.messages.size <= 1) {
            wsClient.send("agent-generator:start", mapOf("sessionId" to current.activeSessionId, "messages" to payload))
        } else {
            wsClient.send("agent-generator:message", mapOf("sessionId" to current.activeSessionId, "messages" to payload))
        }
    }

    fun confirmSpec() {
        val spec = _uiState.value.pendingSpec ?: return
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        wsClient.send("agent-generator:confirm", mapOf(
            "sessionId" to _uiState.value.activeSessionId,
            "spec" to spec.toPayload(),
        ))
    }

    fun reset() {
        wsClient.send("agent-generator:cancel", mapOf("sessionId" to _uiState.value.activeSessionId))
        _uiState.value = AgentGeneratorUiState()
    }

    fun updateSpec(spec: AgentGeneratorSpec) {
        _uiState.value = _uiState.value.copy(pendingSpec = spec)
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    private fun isActiveSession(sessionId: String?): Boolean =
        sessionId == null || sessionId == _uiState.value.activeSessionId

    private fun commitAssistantTurn(content: String, hasSpec: Boolean = false) {
        val current = _uiState.value
        val clean = content.ifBlank { current.streamingText }
            .replace(Regex("<agent-spec>[\\s\\S]*?</agent-spec>"), "")
            .trim()
        _uiState.value = current.copy(
            streamingText = "",
            messages = if (clean.isBlank()) current.messages else current.messages + AgentGenMessage("assistant", clean),
            isLoading = false,
            missedSpec = !hasSpec && clean.isBlank(),
        )
    }

    private fun AgentGeneratorSpec.toPayload(): Map<String, Any> {
        val payload = mutableMapOf<String, Any>(
            "name" to name,
            "icon" to icon,
            "systemPrompt" to systemPrompt,
            "temperature" to temperature,
            "responseFormat" to responseFormat,
            "agenticMode" to agenticMode,
            "tools" to mapOf(
                "fileEdit" to tools.fileEdit,
                "terminal" to tools.terminal,
                "webFetch" to tools.webFetch,
            ),
            "contextDirectories" to contextDirectories,
        )
        rootDirectory?.let { payload["rootDirectory"] = it }
        memory?.let { payload["memory"] = it }
        return payload
    }
}
