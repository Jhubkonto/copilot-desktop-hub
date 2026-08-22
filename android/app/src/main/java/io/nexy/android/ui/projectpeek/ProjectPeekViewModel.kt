package io.nexy.android.ui.projectpeek

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ProjectPeekEntry
import io.nexy.android.data.model.ProjectPeekSource
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ProjectPeekUiState(
    val sources: List<ProjectPeekSource> = emptyList(),
    val sourceId: String? = null,
    val relativePath: String = "",
    val filter: String = "all",
    val entries: List<ProjectPeekEntry> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val truncated: Boolean = false,
)

class ProjectPeekViewModel(app: Application, private val projectId: String) : AndroidViewModel(app) {
    private val _state = MutableStateFlow(ProjectPeekUiState())
    val state: StateFlow<ProjectPeekUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.ProjectPeekSources -> if (event.projectId == projectId) {
                        val primary = event.sources.firstOrNull { it.isPrimary } ?: event.sources.firstOrNull()
                        _state.value = _state.value.copy(sources = event.sources, sourceId = primary?.id, loading = primary != null)
                        if (primary == null) _state.value = _state.value.copy(loading = false, error = "No enabled project sources are available")
                        else requestDirectory(primary.id, "", _state.value.filter)
                    }
                    is WsEvent.ProjectPeekDirectory -> if (
                        event.projectId == projectId && event.sourceId == _state.value.sourceId &&
                        event.relativePath == _state.value.relativePath && event.filter == _state.value.filter
                    ) {
                        _state.value = _state.value.copy(
                            entries = event.entries, loading = false, error = event.error, truncated = event.truncated,
                        )
                    }
                    else -> Unit
                }
            }
        }
        WsRepository.getProjectPeekSources(projectId)
    }

    fun selectSource(sourceId: String) {
        _state.value = _state.value.copy(sourceId = sourceId, relativePath = "", entries = emptyList(), loading = true, error = null)
        requestDirectory(sourceId, "", _state.value.filter)
    }

    fun open(relativePath: String) {
        val sourceId = _state.value.sourceId ?: return
        _state.value = _state.value.copy(relativePath = relativePath, entries = emptyList(), loading = true, error = null)
        requestDirectory(sourceId, relativePath, _state.value.filter)
    }

    fun setFilter(filter: String) {
        val sourceId = _state.value.sourceId ?: return
        _state.value = _state.value.copy(filter = filter, entries = emptyList(), loading = true, error = null)
        requestDirectory(sourceId, _state.value.relativePath, filter)
    }

    fun goUp() {
        val current = _state.value.relativePath
        if (current.isBlank()) return
        open(current.substringBeforeLast('/', ""))
    }

    fun retry() {
        _state.value.sourceId?.let { requestDirectory(it, _state.value.relativePath, _state.value.filter) }
    }

    private fun requestDirectory(sourceId: String, relativePath: String, filter: String) {
        WsRepository.listProjectPeekDirectory(projectId, sourceId, relativePath, filter)
    }
}
