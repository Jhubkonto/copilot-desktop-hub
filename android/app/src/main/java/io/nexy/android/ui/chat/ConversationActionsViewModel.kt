package io.nexy.android.ui.chat

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.model.Conversation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ConversationActionsState(
    val isExporting: Boolean = false,
    val isForkInProgress: Boolean = false,
    val isImporting: Boolean = false,
    val isPinned: Boolean = false,
    val isPinning: Boolean = false,
    val compressionPreviewLoading: Boolean = false,
    val compressionDraftLoading: Boolean = false,
    val compressionSaving: Boolean = false,
    val compressionPreview: io.nexy.android.data.model.CompressionPreview? = null,
    val compressionDraft: io.nexy.android.data.model.CompressionDraft? = null,
    val exportedContent: ExportedConversation? = null,
    val forkedConversationId: String? = null,
    val forkedTitle: String? = null,
    val importedConversationId: String? = null,
    val error: String? = null,
)

data class ExportedConversation(
    val fileName: String,
    val mimeType: String,
    val content: String,
    val format: String,
)

class ConversationActionsViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(ConversationActionsState())
    val state: StateFlow<ConversationActionsState> = _state.asStateFlow()

    fun initPin(conversations: List<Conversation>, conversationId: String) {
        val pinned = conversations.find { it.id == conversationId }?.pinned ?: false
        _state.value = _state.value.copy(isPinned = pinned)
    }

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.ConversationExportPackResult -> {
                        val pack = event.pack
                        _state.value = _state.value.copy(
                            isExporting = false,
                            exportedContent = ExportedConversation(
                                fileName = pack.fileName,
                                mimeType = pack.mimeType,
                                content = pack.content,
                                format = pack.format,
                            ),
                        )
                    }
                    is WsEvent.ConversationExportError -> {
                        _state.value = _state.value.copy(isExporting = false, error = event.message)
                    }
                    is WsEvent.ConversationForked -> {
                        _state.value = _state.value.copy(
                            isForkInProgress = false,
                            forkedConversationId = event.conversationId,
                            forkedTitle = event.title,
                        )
                    }
                    is WsEvent.ConversationForkError -> {
                        _state.value = _state.value.copy(isForkInProgress = false, error = event.message)
                    }
                    is WsEvent.ConversationImported -> {
                        _state.value = _state.value.copy(
                            isImporting = false,
                            importedConversationId = event.conversationId,
                        )
                    }
                    is WsEvent.ConversationImportError -> {
                        _state.value = _state.value.copy(isImporting = false, error = event.message)
                    }
                    is WsEvent.ConversationPinned -> {
                        _state.value = _state.value.copy(isPinned = event.pinned, isPinning = false)
                    }
                    is WsEvent.CompressionPreview -> {
                        _state.value = _state.value.copy(compressionPreviewLoading = false, compressionPreview = event)
                    }
                    is WsEvent.CompressionDraft -> {
                        _state.value = _state.value.copy(compressionDraftLoading = false, compressionDraft = event)
                    }
                    is WsEvent.CompressionSaved -> {
                        _state.value = _state.value.copy(compressionSaving = false, compressionDraft = null)
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

    fun exportJson(conversationId: String) {
        _state.value = _state.value.copy(isExporting = true)
        WsRepository.exportConversationPack(conversationId, "json")
    }

    fun exportMarkdown(conversationId: String) {
        _state.value = _state.value.copy(isExporting = true)
        WsRepository.exportConversationPack(conversationId, "markdown")
    }

    fun fork(conversationId: String) {
        _state.value = _state.value.copy(isForkInProgress = true)
        WsRepository.forkConversation(conversationId)
    }

    fun importJson(json: String) {
        _state.value = _state.value.copy(isImporting = true)
        WsRepository.importConversationJson(json)
    }

    fun togglePin(conversationId: String) {
        val newPinned = !_state.value.isPinned
        _state.value = _state.value.copy(isPinning = true)
        WsRepository.setPinnedConversation(conversationId, newPinned)
    }

    fun loadCompressionPreview(conversationId: String) {
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

    fun dismissCompression() { _state.value = _state.value.copy(compressionDraft = null, compressionPreview = null) }

    fun clearExport() { _state.value = _state.value.copy(exportedContent = null) }
    fun clearFork() { _state.value = _state.value.copy(forkedConversationId = null, forkedTitle = null) }
    fun clearImport() { _state.value = _state.value.copy(importedConversationId = null) }
    fun dismissError() { _state.value = _state.value.copy(error = null) }
}
