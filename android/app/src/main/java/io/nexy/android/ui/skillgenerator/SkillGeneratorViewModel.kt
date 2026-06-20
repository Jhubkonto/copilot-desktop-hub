package io.nexy.android.ui.skillgenerator

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.SkillGeneratorSpec
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class SkillGenMessage(val role: String, val content: String)

enum class SkillGenPhase { CHAT, SPEC_REVIEW, DONE }

private const val GREETING = "Let's create a new skill. Describe what you want it to do, which tools it should use, and any approval or instruction details."

data class SkillGeneratorUiState(
    val phase: SkillGenPhase = SkillGenPhase.CHAT,
    val messages: List<SkillGenMessage> = listOf(SkillGenMessage("assistant", GREETING)),
    val streamingText: String = "",
    val pendingSpec: SkillGeneratorSpec? = null,
    val isLoading: Boolean = false,
    val missedSpec: Boolean = false,
    val error: String? = null,
    val createdSkillName: String? = null,
    val createdSkillId: String? = null,
    val activeSessionId: String = UUID.randomUUID().toString(),
)

class SkillGeneratorViewModel(
    private val wsClient: WsClient = WsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SkillGeneratorUiState())
    val uiState: StateFlow<SkillGeneratorUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when (event) {
                    is WsEvent.SkillGeneratorToken -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            streamingText = _uiState.value.streamingText + event.chunk,
                        )
                    }
                    is WsEvent.SkillGeneratorTurnComplete -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        commitAssistantTurn(event.content, event.hasSpec)
                    }
                    is WsEvent.SkillGeneratorSpecReady -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            streamingText = "",
                            pendingSpec = event.spec,
                            phase = SkillGenPhase.SPEC_REVIEW,
                            isLoading = false,
                        )
                    }
                    is WsEvent.SkillGeneratorCreated -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            phase = SkillGenPhase.DONE,
                            createdSkillName = event.name,
                            createdSkillId = event.skillId,
                            isLoading = false,
                        )
                    }
                    is WsEvent.SkillGeneratorError -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            error = event.message,
                            isLoading = false,
                        )
                    }
                    is WsEvent.SkillGeneratorCancelled -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = SkillGeneratorUiState()
                    }
                    else -> {}
                }
            }
        }
    }

    fun sendMessage(content: String) {
        val current = _uiState.value
        val userMsg = SkillGenMessage("user", content)
        val next = current.messages + userMsg
        _uiState.value = current.copy(messages = next, isLoading = true, streamingText = "", missedSpec = false)
        val payload = next.map { mapOf("role" to it.role, "content" to it.content) }
        if (current.messages.size <= 1) {
            wsClient.send("skill-generator:start", mapOf("sessionId" to current.activeSessionId, "messages" to payload))
        } else {
            wsClient.send("skill-generator:message", mapOf("sessionId" to current.activeSessionId, "messages" to payload))
        }
    }

    fun confirmSpec() {
        val spec = _uiState.value.pendingSpec ?: return
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        wsClient.send("skill-generator:confirm", mapOf("sessionId" to _uiState.value.activeSessionId, "spec" to spec.toPayload()))
    }

    fun reset() {
        wsClient.send("skill-generator:cancel", mapOf("sessionId" to _uiState.value.activeSessionId))
        _uiState.value = SkillGeneratorUiState()
    }

    fun updateSpec(spec: SkillGeneratorSpec) {
        _uiState.value = _uiState.value.copy(pendingSpec = spec)
    }

    fun backToChat() {
        _uiState.value = _uiState.value.copy(phase = SkillGenPhase.CHAT, error = null)
    }

    fun retryLastMessage() {
        val lastUserMsg = _uiState.value.messages.lastOrNull { it.role == "user" }?.content ?: return
        _uiState.value = _uiState.value.copy(error = null)
        sendMessage(lastUserMsg)
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    private fun isActiveSession(sessionId: String?): Boolean =
        sessionId == null || sessionId == _uiState.value.activeSessionId

    private fun commitAssistantTurn(content: String, hasSpec: Boolean = false) {
        val current = _uiState.value
        val clean = content.ifBlank { current.streamingText }
            .replace(Regex("<skill-spec>[\\s\\S]*?</skill-spec>"), "")
            .trim()
        _uiState.value = current.copy(
            streamingText = "",
            messages = if (clean.isBlank()) current.messages else current.messages + SkillGenMessage("assistant", clean),
            isLoading = false,
            missedSpec = !hasSpec && clean.isBlank(),
        )
    }

    private fun SkillGeneratorSpec.toPayload(): Map<String, Any> =
        mapOf(
            "name" to name,
            "icon" to icon,
            "description" to description,
            "instructions" to instructions,
            "tools" to mapOf(
                "fileEdit" to tools.fileEdit,
                "terminal" to tools.terminal,
                "webFetch" to tools.webFetch,
            ),
            "toolInstructions" to toolInstructions,
            "approval" to approval,
            "mcpServers" to mcpServers,
            "tags" to tags,
            "knowledge" to knowledge.map { mapOf("title" to it.title, "content" to it.content) },
            "suggestedAgents" to suggestedAgents,
        )
}
