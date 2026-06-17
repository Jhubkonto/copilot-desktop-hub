package io.nexy.android.ui.projectgenerator

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ProjectGeneratorSpec
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

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
)

class ProjectGeneratorViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(ProjectGeneratorUiState())
    val uiState: StateFlow<ProjectGeneratorUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.ProjectGeneratorToken -> {
                        _uiState.value = _uiState.value.copy(
                            streamingText = _uiState.value.streamingText + event.chunk,
                        )
                    }
                    is WsEvent.ProjectGeneratorSpecReady -> {
                        val current = _uiState.value
                        val assistantMsg = ProjectGenMessage("assistant", current.streamingText)
                        _uiState.value = current.copy(
                            streamingText = "",
                            messages = current.messages + assistantMsg,
                            pendingSpec = event.spec,
                            phase = ProjectGenPhase.SPEC_REVIEW,
                            isLoading = false,
                        )
                    }
                    is WsEvent.ProjectGeneratorCreated -> {
                        _uiState.value = _uiState.value.copy(
                            phase = ProjectGenPhase.DONE,
                            createdProjectName = event.name,
                            isLoading = false,
                        )
                    }
                    is WsEvent.ProjectGeneratorError -> {
                        _uiState.value = _uiState.value.copy(
                            error = event.message,
                            isLoading = false,
                        )
                    }
                    is WsEvent.ProjectGeneratorCancelled -> {
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
            WsRepository.startProjectGeneratorChat(payload)
        } else {
            WsRepository.sendProjectGeneratorMessage(payload)
        }
    }

    fun confirmSpec() {
        val spec = _uiState.value.pendingSpec ?: return
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        WsRepository.confirmProjectSpec(spec)
    }

    fun reset() {
        WsRepository.cancelProjectGenerator()
        _uiState.value = ProjectGeneratorUiState()
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
