package io.nexy.android.ui.wiki

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class WikiUiState(
    val entries: List<WikiEntry> = emptyList(),
    val selectedEntry: WikiEntry? = null,
    val isEditing: Boolean = false,
    val showCreateSheet: Boolean = false,
    val editTitle: String = "",
    val editBody: String = "",
    val editTags: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val isExtracting: Boolean = false,
    val extractionCandidates: List<io.nexy.android.data.model.WikiExtractionCandidate> = emptyList(),
    val showExtractionSheet: Boolean = false,
    val selectedCandidateIndices: Set<Int> = emptySet(),
)

class WikiViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(WikiUiState())
    val state: StateFlow<WikiUiState> = _state.asStateFlow()

    private var currentProjectId: String? = null

    init {
        viewModelScope.launch {
            WsRepository.wikiEntries.collect { entries ->
                _state.value = _state.value.copy(entries = entries)
            }
        }
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.WikiList -> _state.value = _state.value.copy(isLoading = false)
                    is WsEvent.WikiEntryCreated -> _state.value = _state.value.copy(showCreateSheet = false, isLoading = false)
                    is WsEvent.WikiEntryUpdated -> _state.value = _state.value.copy(selectedEntry = null, isEditing = false, isLoading = false)
                    is WsEvent.WikiEntryDeleted -> _state.value = _state.value.copy(selectedEntry = null)
                    is WsEvent.WikiExtractionCandidates -> _state.value = _state.value.copy(
                        isExtracting = false,
                        extractionCandidates = event.candidates,
                        showExtractionSheet = event.candidates.isNotEmpty(),
                        selectedCandidateIndices = event.candidates.indices.toSet(),
                    )
                    is WsEvent.WikiExtractionError -> _state.value = _state.value.copy(isExtracting = false, error = event.message)
                    else -> {}
                }
            }
        }
    }

    fun load(projectId: String) {
        currentProjectId = projectId
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.listWikiEntries(projectId)
    }

    fun selectEntry(entry: WikiEntry) {
        _state.value = _state.value.copy(
            selectedEntry = entry,
            isEditing = false,
            editTitle = entry.title,
            editBody = entry.body,
            editTags = entry.tags.joinToString(", "),
        )
    }

    fun startEdit() {
        val entry = _state.value.selectedEntry ?: return
        _state.value = _state.value.copy(
            isEditing = true,
            editTitle = entry.title,
            editBody = entry.body,
            editTags = entry.tags.joinToString(", "),
        )
    }

    fun cancelEdit() { _state.value = _state.value.copy(isEditing = false) }

    fun saveEdit() {
        val id = _state.value.selectedEntry?.id ?: return
        val title = _state.value.editTitle.trim()
        val body = _state.value.editBody
        val tags = parseTags(_state.value.editTags)
        if (title.isBlank()) { _state.value = _state.value.copy(error = "Title is required"); return }
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.updateWikiEntry(id, title, body, tags)
    }

    fun showCreate() { _state.value = _state.value.copy(showCreateSheet = true, editTitle = "", editBody = "", editTags = "") }

    fun dismissCreate() { _state.value = _state.value.copy(showCreateSheet = false) }

    fun createEntry() {
        val projectId = currentProjectId ?: return
        val title = _state.value.editTitle.trim()
        val body = _state.value.editBody
        val tags = parseTags(_state.value.editTags)
        if (title.isBlank()) { _state.value = _state.value.copy(error = "Title is required"); return }
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.createWikiEntry(projectId, title, body, tags)
    }

    fun deleteEntry(id: String) { WsRepository.deleteWikiEntry(id) }

    fun clearSelection() { _state.value = _state.value.copy(selectedEntry = null, isEditing = false) }

    fun extractFromConversation(conversationId: String) {
        val projectId = currentProjectId ?: return
        _state.value = _state.value.copy(isExtracting = true, error = null)
        WsRepository.extractWikiFromConversation(conversationId, projectId)
    }

    fun toggleCandidateSelection(index: Int) {
        val current = _state.value.selectedCandidateIndices
        _state.value = _state.value.copy(selectedCandidateIndices = if (index in current) current - index else current + index)
    }

    fun confirmExtraction() {
        val projectId = currentProjectId ?: return
        val candidates = _state.value.extractionCandidates
        val selected = _state.value.selectedCandidateIndices
        selected.forEach { i ->
            val c = candidates.getOrNull(i) ?: return@forEach
            WsRepository.createWikiEntry(projectId, c.title, c.body, c.tags)
        }
        _state.value = _state.value.copy(showExtractionSheet = false, extractionCandidates = emptyList(), selectedCandidateIndices = emptySet())
    }

    fun dismissExtraction() { _state.value = _state.value.copy(showExtractionSheet = false, extractionCandidates = emptyList(), selectedCandidateIndices = emptySet()) }

    fun setEditTitle(v: String) { _state.value = _state.value.copy(editTitle = v) }
    fun setEditBody(v: String) { _state.value = _state.value.copy(editBody = v) }
    fun setEditTags(v: String) { _state.value = _state.value.copy(editTags = v) }
    fun dismissError() { _state.value = _state.value.copy(error = null) }

    private fun parseTags(raw: String): List<String> =
        raw.split(",").map { it.trim() }.filter { it.isNotBlank() }
}
