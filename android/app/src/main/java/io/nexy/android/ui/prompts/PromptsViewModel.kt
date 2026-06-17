package io.nexy.android.ui.prompts

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PromptsUiState(
    val entries: List<PromptEntry> = emptyList(),
    val selectedEntry: PromptEntry? = null,
    val isEditing: Boolean = false,
    val showCreateSheet: Boolean = false,
    val editTitle: String = "",
    val editBody: String = "",
    val editDescription: String = "",
    val editCategory: String = "",
    val editTags: String = "",
    val editScope: String = "global",
    val isLoading: Boolean = false,
    val error: String? = null,
    val insertedText: String? = null,
)

class PromptsViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(PromptsUiState())
    val state: StateFlow<PromptsUiState> = _state.asStateFlow()

    private var currentProjectId: String? = null

    init {
        viewModelScope.launch {
            WsRepository.promptEntries.collect { entries ->
                _state.value = _state.value.copy(entries = entries)
            }
        }
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.PromptEntryCreated -> _state.value = _state.value.copy(showCreateSheet = false, isLoading = false)
                    is WsEvent.PromptEntryUpdated -> _state.value = _state.value.copy(selectedEntry = null, isEditing = false, isLoading = false)
                    is WsEvent.PromptEntryDeleted -> _state.value = _state.value.copy(selectedEntry = null)
                    else -> {}
                }
            }
        }
    }

    fun load(projectId: String? = null) {
        currentProjectId = projectId
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.listPrompts(projectId)
        _state.value = _state.value.copy(isLoading = false)
    }

    fun selectEntry(entry: PromptEntry) {
        _state.value = _state.value.copy(
            selectedEntry = entry,
            isEditing = false,
            editTitle = entry.title,
            editBody = entry.body,
            editDescription = entry.description,
            editCategory = entry.category,
            editTags = entry.tags.joinToString(", "),
            editScope = entry.scope,
        )
    }

    fun startEdit() {
        val entry = _state.value.selectedEntry ?: return
        _state.value = _state.value.copy(
            isEditing = true,
            editTitle = entry.title,
            editBody = entry.body,
            editDescription = entry.description,
            editCategory = entry.category,
            editTags = entry.tags.joinToString(", "),
        )
    }

    fun cancelEdit() { _state.value = _state.value.copy(isEditing = false) }

    fun saveEdit() {
        val id = _state.value.selectedEntry?.id ?: return
        val title = _state.value.editTitle.trim()
        val body = _state.value.editBody
        if (title.isBlank() || body.isBlank()) { _state.value = _state.value.copy(error = "Title and body are required"); return }
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.updatePrompt(id, title, body, _state.value.editDescription, _state.value.editCategory.ifBlank { "Custom" }, parseTags(_state.value.editTags))
    }

    fun showCreate() {
        _state.value = _state.value.copy(showCreateSheet = true, editTitle = "", editBody = "", editDescription = "", editCategory = "", editTags = "", editScope = "global")
    }

    fun dismissCreate() { _state.value = _state.value.copy(showCreateSheet = false) }

    fun createEntry() {
        val title = _state.value.editTitle.trim()
        val body = _state.value.editBody
        if (title.isBlank() || body.isBlank()) { _state.value = _state.value.copy(error = "Title and body are required"); return }
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.createPrompt(
            title = title,
            body = body,
            description = _state.value.editDescription,
            category = _state.value.editCategory.ifBlank { "Custom" },
            tags = parseTags(_state.value.editTags),
            scope = _state.value.editScope,
            projectId = if (_state.value.editScope == "project") currentProjectId else null,
        )
    }

    fun deleteEntry(id: String) { WsRepository.deletePrompt(id) }

    fun insertPrompt(body: String) { _state.value = _state.value.copy(insertedText = body) }

    fun clearInserted() { _state.value = _state.value.copy(insertedText = null) }

    fun clearSelection() { _state.value = _state.value.copy(selectedEntry = null, isEditing = false) }

    fun setEditTitle(v: String) { _state.value = _state.value.copy(editTitle = v) }
    fun setEditBody(v: String) { _state.value = _state.value.copy(editBody = v) }
    fun setEditDescription(v: String) { _state.value = _state.value.copy(editDescription = v) }
    fun setEditCategory(v: String) { _state.value = _state.value.copy(editCategory = v) }
    fun setEditTags(v: String) { _state.value = _state.value.copy(editTags = v) }
    fun setEditScope(v: String) { _state.value = _state.value.copy(editScope = v) }
    fun dismissError() { _state.value = _state.value.copy(error = null) }

    private fun parseTags(raw: String): List<String> =
        raw.split(",").map { it.trim() }.filter { it.isNotBlank() }
}
