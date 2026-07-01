package io.nexy.android.ui.chat

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.CompressionDraft
import io.nexy.android.data.model.CompressionPreview
import io.nexy.android.data.model.ContextInspectorSnapshot
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ContextInspectorState(
    val loading: Boolean = false,
    val snapshot: ContextInspectorSnapshot? = null,
    val error: String? = null,
    val compressionPreviewLoading: Boolean = false,
    val compressionDraftLoading: Boolean = false,
    val compressionSaving: Boolean = false,
    val compressionPreview: CompressionPreview? = null,
    val compressionDraft: CompressionDraft? = null,
    val showCompressionDetails: Boolean = false,
)

class ContextInspectorViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(ContextInspectorState())
    val state: StateFlow<ContextInspectorState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.InspectorSnapshot -> {
                        _state.value = _state.value.copy(loading = false, snapshot = event.snapshot)
                    }
                    is WsEvent.InspectorSnapshotError -> {
                        _state.value = _state.value.copy(loading = false, error = event.message)
                    }
                    is WsEvent.CompressionPreview -> {
                        _state.value = _state.value.copy(compressionPreviewLoading = false, compressionPreview = event)
                    }
                    is WsEvent.CompressionDraft -> {
                        _state.value = _state.value.copy(compressionDraftLoading = false, compressionDraft = event)
                    }
                    is WsEvent.CompressionSaved -> {
                        _state.value = _state.value.copy(compressionSaving = false, compressionDraft = null)
                        _state.value.snapshot?.conversationId?.let { WsRepository.getCompressionPreview(it) }
                    }
                    is WsEvent.CompressionError -> {
                        _state.value = _state.value.copy(
                            compressionPreviewLoading = false,
                            compressionDraftLoading = false,
                            compressionSaving = false,
                            error = event.message,
                        )
                    }
                    else -> {}
                }
            }
        }
    }

    fun load(conversationId: String) {
        _state.value = _state.value.copy(loading = true, error = null)
        WsRepository.getInspectorSnapshot(conversationId)
        _state.value = _state.value.copy(compressionPreviewLoading = true)
        WsRepository.getCompressionPreview(conversationId)
    }

    fun prepareCompression(conversationId: String) {
        _state.value = _state.value.copy(compressionDraftLoading = true)
        WsRepository.prepareCompressionSummary(conversationId)
    }

    fun saveCompression(conversationId: String) {
        val draft = _state.value.compressionDraft ?: return
        _state.value = _state.value.copy(compressionSaving = true)
        val sections = draft.sections
        val payload = mapOf(
            "sections" to mapOf(
                "goals" to sections.goals,
                "decisions" to sections.decisions,
                "constraints" to sections.constraints,
                "filesTouched" to sections.filesTouched,
                "commandsRun" to sections.commandsRun,
                "openQuestions" to sections.openQuestions,
                "nextActions" to sections.nextActions,
                "recentContextNotes" to sections.recentContextNotes,
            ),
            "summarizedMessageCount" to draft.summarizedMessageCount,
            "retainedMessageCount" to draft.retainedMessageCount,
            "omittedMessageCount" to 0,
            "estimatedTokensBefore" to draft.estimatedTokensBefore,
            "targetBudget" to draft.targetBudget,
            "strategy" to draft.strategy,
        )
        WsRepository.saveCompressionSummary(conversationId, payload)
    }

    fun dismissCompressionDraft() { _state.value = _state.value.copy(compressionDraft = null) }
    fun toggleCompressionDetails() { _state.value = _state.value.copy(showCompressionDetails = !_state.value.showCompressionDetails) }
    fun dismissError() { _state.value = _state.value.copy(error = null) }
    fun reset() { _state.value = ContextInspectorState() }
}
