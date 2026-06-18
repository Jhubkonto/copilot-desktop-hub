package io.nexy.android.ui.projectgenerator

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ProjectGeneratorSpec
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class ProjectGenMessage(val role: String, val content: String)

enum class ProjectGenPhase { CHAT, SPEC_REVIEW, DONE }

data class ProjectGeneratorUiState(
    val phase: ProjectGenPhase = ProjectGenPhase.CHAT,
    val messages: List<ProjectGenMessage> = emptyList(),
    val streamingText: String = "",
    val pendingSpec: ProjectGeneratorSpec? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val createdProjectName: String? = null,
    val createdProjectId: String? = null,
    val activeSessionId: String = UUID.randomUUID().toString(),
)

class ProjectGeneratorViewModel(
    private val wsClient: WsClient = WsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProjectGeneratorUiState())
    val uiState: StateFlow<ProjectGeneratorUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when (event) {
                    is WsEvent.ProjectGeneratorToken -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            streamingText = _uiState.value.streamingText + event.chunk,
                        )
                    }
                    is WsEvent.ProjectGeneratorTurnComplete -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        commitAssistantTurn(event.content)
                    }
                    is WsEvent.ProjectGeneratorSpecReady -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        val current = _uiState.value
                        _uiState.value = current.copy(
                            streamingText = "",
                            pendingSpec = event.spec,
                            phase = ProjectGenPhase.SPEC_REVIEW,
                            isLoading = false,
                        )
                    }
                    is WsEvent.ProjectGeneratorCreated -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            phase = ProjectGenPhase.DONE,
                            createdProjectName = event.name,
                            createdProjectId = event.projectId,
                            isLoading = false,
                        )
                    }
                    is WsEvent.ProjectGeneratorError -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = _uiState.value.copy(
                            error = event.message,
                            isLoading = false,
                        )
                    }
                    is WsEvent.ProjectGeneratorCancelled -> {
                        if (!isActiveSession(event.sessionId)) return@collect
                        _uiState.value = ProjectGeneratorUiState()
                    }
                    else -> {}
                }
            }
        }
    }

    fun sendMessage(content: String) {
        val current = _uiState.value
        val userMsg = ProjectGenMessage("user", content)
        val next = current.messages + userMsg
        _uiState.value = current.copy(messages = next, isLoading = true, streamingText = "")
        val payload = next.map { mapOf("role" to it.role, "content" to it.content) }
        if (current.messages.isEmpty()) {
            wsClient.send("project-generator:start", mapOf("sessionId" to current.activeSessionId, "messages" to payload))
        } else {
            wsClient.send("project-generator:message", mapOf("sessionId" to current.activeSessionId, "messages" to payload))
        }
    }

    fun confirmSpec() {
        val spec = _uiState.value.pendingSpec ?: return
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        wsClient.send("project-generator:confirm", mapOf(
            "sessionId" to _uiState.value.activeSessionId,
            "spec" to spec.toPayload(),
        ))
    }

    fun reset() {
        wsClient.send("project-generator:cancel", mapOf("sessionId" to _uiState.value.activeSessionId))
        _uiState.value = ProjectGeneratorUiState()
    }

    fun updateSpec(spec: ProjectGeneratorSpec) {
        _uiState.value = _uiState.value.copy(pendingSpec = spec)
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    private fun isActiveSession(sessionId: String?): Boolean =
        sessionId == null || sessionId == _uiState.value.activeSessionId

    private fun commitAssistantTurn(content: String) {
        val current = _uiState.value
        val clean = content.ifBlank { current.streamingText }
            .replace(Regex("<project-spec>[\\s\\S]*?</project-spec>"), "")
            .trim()
        _uiState.value = current.copy(
            streamingText = "",
            messages = if (clean.isBlank()) current.messages else current.messages + ProjectGenMessage("assistant", clean),
            isLoading = false,
        )
    }

    private fun ProjectGeneratorSpec.toPayload(): Map<String, Any> {
        val agentsList = agents.map { agent ->
            val map = mutableMapOf<String, Any>(
                "role" to agent.role,
                "description" to agent.description,
                "isLeader" to agent.isLeader,
            )
            agent.existingAgentId?.let { map["existingAgentId"] = it }
            if (agent.existingAgentId == null) {
                val newAgent = agent.newAgent
                map["newAgent"] = mapOf(
                    "name" to (newAgent?.name ?: agent.role),
                    "icon" to (newAgent?.icon ?: ""),
                    "systemPrompt" to (newAgent?.systemPrompt ?: ""),
                    "temperature" to (newAgent?.temperature ?: 0.7),
                    "responseFormat" to (newAgent?.responseFormat ?: "default"),
                    "tools" to mapOf(
                        "fileEdit" to (newAgent?.tools?.fileEdit ?: false),
                        "terminal" to (newAgent?.tools?.terminal ?: false),
                        "webFetch" to (newAgent?.tools?.webFetch ?: false),
                    ),
                )
            }
            map
        }
        val payload = mutableMapOf<String, Any>(
            "name" to name,
            "color" to color,
            "instructions" to instructions,
            "variables" to variables,
            "inScope" to inScope,
            "outOfScope" to outOfScope,
            "milestones" to milestones,
            "orchestrationEnabled" to orchestrationEnabled,
            "agents" to agentsList,
        )
        rootDirectory?.let { payload["rootDirectory"] = it }
        instructionMode?.let { payload["instructionMode"] = it }
        defaultModel?.let { payload["defaultModel"] = it }
        return payload
    }
}
