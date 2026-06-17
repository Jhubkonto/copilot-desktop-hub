package io.nexy.android.ui.featuregenerator

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.FeatureGeneratorRun
import io.nexy.android.data.model.FeatureSpec
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class FeatureGeneratorMessage(val role: String, val content: String)

enum class FeatureGenPhase {
    CHAT, SPEC_REVIEW, PLAN_REVIEW, DIFF_REVIEW, DONE
}

data class FeatureGeneratorUiState(
    val phase: FeatureGenPhase = FeatureGenPhase.CHAT,
    val messages: List<FeatureGeneratorMessage> = emptyList(),
    val streamingText: String = "",
    val pendingSpec: FeatureSpec? = null,
    val currentRunId: String? = null,
    val plan: String? = null,
    val stagedFiles: List<String> = emptyList(),
    val appliedFiles: List<String> = emptyList(),
    val commitSha: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

class FeatureGeneratorViewModel(app: Application) : AndroidViewModel(app) {

    val runs: StateFlow<List<FeatureGeneratorRun>> = WsRepository.featureGeneratorRuns

    private val _uiState = MutableStateFlow(FeatureGeneratorUiState())
    val uiState: StateFlow<FeatureGeneratorUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.FeatureGeneratorToken -> {
                        _uiState.value = _uiState.value.copy(
                            streamingText = _uiState.value.streamingText + event.chunk
                        )
                    }
                    is WsEvent.FeatureGeneratorSpecReady -> {
                        val current = _uiState.value
                        val assistantMsg = FeatureGeneratorMessage("assistant", current.streamingText)
                        _uiState.value = current.copy(
                            streamingText = "",
                            messages = current.messages + assistantMsg,
                            pendingSpec = event.spec,
                            phase = FeatureGenPhase.SPEC_REVIEW,
                            isLoading = false,
                        )
                    }
                    is WsEvent.FeatureGeneratorRunCreated -> {
                        _uiState.value = _uiState.value.copy(currentRunId = event.runId)
                    }
                    is WsEvent.FeatureGeneratorPlanReady -> {
                        _uiState.value = _uiState.value.copy(
                            plan = event.plan,
                            phase = FeatureGenPhase.PLAN_REVIEW,
                            isLoading = false,
                        )
                    }
                    is WsEvent.FeatureGeneratorDiffReady -> {
                        _uiState.value = _uiState.value.copy(
                            phase = FeatureGenPhase.DIFF_REVIEW,
                            isLoading = false,
                        )
                        val runId = _uiState.value.currentRunId ?: event.runId
                        WsRepository.listFeatureDiffs(runId)
                    }
                    is WsEvent.FeatureGeneratorDiffList -> {
                        _uiState.value = _uiState.value.copy(stagedFiles = event.files)
                    }
                    is WsEvent.FeatureGeneratorApplied -> {
                        _uiState.value = _uiState.value.copy(appliedFiles = event.appliedFiles)
                    }
                    is WsEvent.FeatureGeneratorCommitted -> {
                        _uiState.value = _uiState.value.copy(
                            commitSha = event.commitSha,
                            phase = FeatureGenPhase.DONE,
                        )
                    }
                    is WsEvent.FeatureGeneratorError -> {
                        _uiState.value = _uiState.value.copy(
                            error = event.message,
                            isLoading = false,
                        )
                    }
                    else -> {}
                }
            }
        }
    }

    fun sendMessage(content: String) {
        val current = _uiState.value
        val userMsg = FeatureGeneratorMessage("user", content)
        val next = current.messages + userMsg
        _uiState.value = current.copy(messages = next, isLoading = true, streamingText = "")
        val payload = next.map { mapOf("role" to it.role, "content" to it.content) }
        if (current.messages.isEmpty()) {
            WsRepository.startFeatureGeneratorChat(payload)
        } else {
            WsRepository.sendFeatureGeneratorMessage(payload)
        }
    }

    fun confirmSpec() {
        val spec = _uiState.value.pendingSpec ?: return
        val runId = _uiState.value.currentRunId ?: java.util.UUID.randomUUID().toString()
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        WsRepository.confirmFeatureSpec(runId, spec)
    }

    fun confirmPlan() {
        val runId = _uiState.value.currentRunId ?: return
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        WsRepository.startFeatureImplementation(runId)
    }

    fun applyAll() {
        val runId = _uiState.value.currentRunId ?: return
        WsRepository.applyAllFeatureDiffs(runId)
    }

    fun commit(message: String) {
        val runId = _uiState.value.currentRunId ?: return
        WsRepository.commitFeatureChanges(runId, message)
    }

    fun refreshRuns() {
        WsRepository.getFeatureGeneratorRuns()
    }

    fun reset() {
        _uiState.value = FeatureGeneratorUiState()
    }

    fun dismissError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
