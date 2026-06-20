package io.nexy.android.ui.artifactgenerator

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.toPayload
import io.nexy.android.data.model.ArtifactGeneratorSpec
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class ArtifactGenMessage(val role: String, val content: String)

enum class ArtifactGenPhase { CHAT, SPEC_REVIEW, DONE }

data class ArtifactGeneratorUiState(
    val phase: ArtifactGenPhase = ArtifactGenPhase.CHAT,
    val messages: List<ArtifactGenMessage> = listOf(
        ArtifactGenMessage(
            role = "assistant",
            content = "Let's create a new artifact. Describe what you want to produce — a document, code file, data export, prompt pack, or any other deliverable.",
        )
    ),
    val streamingText: String = "",
    val isLoading: Boolean = false,
    val missedSpec: Boolean = false,
    val pendingSpec: ArtifactGeneratorSpec? = null,
    val error: String? = null,
    val createdArtifactId: String? = null,
    val createdArtifactTitle: String? = null,
    val sessionId: String = "android-artifact-${UUID.randomUUID()}",
)

class ArtifactGeneratorViewModel(
    private val wsClient: WsClient = WsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ArtifactGeneratorUiState())
    val uiState: StateFlow<ArtifactGeneratorUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            wsClient.events.collect { event ->
                val state = _uiState.value
                when (event) {
                    is WsEvent.ArtifactGeneratorToken -> {
                        if (event.sessionId == null || event.sessionId == state.sessionId) {
                            _uiState.value = state.copy(streamingText = state.streamingText + event.chunk)
                        }
                    }
                    is WsEvent.ArtifactGeneratorTurnComplete -> {
                        if (event.sessionId == null || event.sessionId == state.sessionId) {
                            val cleanContent = stripSpecTags(event.content)
                            commitAssistantTurn(cleanContent)
                            if (!event.hasSpec) {
                                _uiState.value = _uiState.value.copy(
                                    isLoading = false,
                                    missedSpec = _uiState.value.phase == ArtifactGenPhase.CHAT && _uiState.value.messages.size > 2,
                                )
                            } else {
                                _uiState.value = _uiState.value.copy(isLoading = false, missedSpec = false)
                            }
                        }
                    }
                    is WsEvent.ArtifactGeneratorSpecReady -> {
                        if (event.sessionId == null || event.sessionId == state.sessionId) {
                            _uiState.value = _uiState.value.copy(
                                phase = ArtifactGenPhase.SPEC_REVIEW,
                                pendingSpec = event.spec,
                                isLoading = false,
                                missedSpec = false,
                            )
                        }
                    }
                    is WsEvent.ArtifactGeneratorError -> {
                        if (event.sessionId == null || event.sessionId == state.sessionId) {
                            _uiState.value = _uiState.value.copy(
                                isLoading = false,
                                streamingText = "",
                                error = event.message,
                            )
                        }
                    }
                    is WsEvent.ArtifactGeneratorCreated -> {
                        if (event.sessionId == null || event.sessionId == state.sessionId) {
                            _uiState.value = _uiState.value.copy(
                                phase = ArtifactGenPhase.DONE,
                                isLoading = false,
                                createdArtifactId = event.artifactId,
                                createdArtifactTitle = event.title,
                            )
                        }
                    }
                    is WsEvent.ArtifactGeneratorCancelled -> {
                        if (event.sessionId == null || event.sessionId == state.sessionId) {
                            _uiState.value = ArtifactGeneratorUiState()
                        }
                    }
                    else -> {}
                }
            }
        }
    }

    fun sendMessage(text: String) {
        val state = _uiState.value
        if (state.isLoading) return
        val userMsg = ArtifactGenMessage(role = "user", content = text)
        val updatedMessages = state.messages + userMsg
        _uiState.value = state.copy(messages = updatedMessages, isLoading = true, streamingText = "", missedSpec = false)
        val payload = updatedMessages
            .filter { it.role != "assistant" || it != updatedMessages.first() }
            .map { mapOf("role" to it.role, "content" to it.content) }
        if (state.messages.size <= 1) {
            wsClient.send("artifact-generator:start", mapOf("sessionId" to state.sessionId, "messages" to payload))
        } else {
            wsClient.send("artifact-generator:message", mapOf("sessionId" to state.sessionId, "messages" to payload))
        }
    }

    fun updateSpec(spec: ArtifactGeneratorSpec) {
        _uiState.value = _uiState.value.copy(pendingSpec = spec)
    }

    fun confirmSpec() {
        val state = _uiState.value
        val spec = state.pendingSpec ?: return
        _uiState.value = state.copy(isLoading = true, error = null)
        wsClient.send("artifact-generator:generate", mapOf("sessionId" to state.sessionId, "spec" to spec.toPayload()))
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun reset() {
        val old = _uiState.value
        wsClient.send("artifact-generator:cancel", mapOf("sessionId" to old.sessionId))
        _uiState.value = ArtifactGeneratorUiState(sessionId = "android-artifact-${UUID.randomUUID()}")
    }

    private fun commitAssistantTurn(content: String) {
        val state = _uiState.value
        val assistantMsg = ArtifactGenMessage(role = "assistant", content = content.trim())
        _uiState.value = state.copy(
            messages = state.messages + assistantMsg,
            streamingText = "",
        )
    }

    private fun stripSpecTags(text: String): String {
        val open = text.lastIndexOf("<artifact-spec>")
        val close = text.lastIndexOf("</artifact-spec>")
        if (open == -1 || close == -1 || close <= open) return text
        val before = text.substring(0, open).trimEnd()
        val after = text.substring(close + "</artifact-spec>".length).trimStart()
        return listOf(before, after).filter { it.isNotBlank() }.joinToString("\n\n")
    }
}
