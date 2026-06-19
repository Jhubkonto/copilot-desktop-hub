package io.nexy.android.ui.chat

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ConversationActionsState(
    val isExporting: Boolean = false,
    val isForkInProgress: Boolean = false,
    val isImporting: Boolean = false,
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

    fun clearExport() { _state.value = _state.value.copy(exportedContent = null) }
    fun clearFork() { _state.value = _state.value.copy(forkedConversationId = null, forkedTitle = null) }
    fun clearImport() { _state.value = _state.value.copy(importedConversationId = null) }
    fun dismissError() { _state.value = _state.value.copy(error = null) }
}
