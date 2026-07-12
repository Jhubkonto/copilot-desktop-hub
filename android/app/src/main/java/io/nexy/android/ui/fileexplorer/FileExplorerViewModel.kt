package io.nexy.android.ui.fileexplorer

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.FsEntry
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class FileExplorerUiState(
    // Root-first stack of paths navigated into; empty means "at the root chooser" (home + recents).
    // Last entry is the current directory — this backs the breadcrumb bar.
    val history: List<String> = emptyList(),
    val entries: List<FsEntry> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val truncated: Boolean = false,
    val home: String? = null,
    val recents: List<String> = emptyList(),
) {
    val currentPath: String? get() = history.lastOrNull()
}

class FileExplorerViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(FileExplorerUiState())
    val state: StateFlow<FileExplorerUiState> = _state.asStateFlow()

    init {
        WsRepository.getFsStartRoots()
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.FsStartRoots -> {
                        val stillAtRoot = _state.value.history.isEmpty()
                        _state.value = _state.value.copy(
                            home = event.home,
                            recents = event.recents,
                            loading = if (stillAtRoot) false else _state.value.loading,
                        )
                    }
                    is WsEvent.FsDirectoryListing -> {
                        // The WS protocol has no request-id correlation (see this feature's roadmap,
                        // §5 point 5) — only accept a response for the folder the user is still on,
                        // so a slow reply for a folder already navigated away from is dropped.
                        if (event.path == _state.value.currentPath) {
                            _state.value = _state.value.copy(
                                entries = event.entries.sortedWith(
                                    compareByDescending<FsEntry> { it.isDirectory }.thenBy { it.name.lowercase() },
                                ),
                                loading = false,
                                error = event.error,
                                truncated = event.truncated,
                            )
                        }
                    }
                    else -> {}
                }
            }
        }
    }

    fun open(path: String) {
        _state.value = _state.value.copy(
            history = _state.value.history + path,
            loading = true,
            error = null,
            entries = emptyList(),
        )
        WsRepository.listDirectory(path)
    }

    /** Jump to an ancestor breadcrumb at [index]; -1 returns to the root chooser. */
    fun navigateTo(index: Int) {
        if (index < 0) {
            _state.value = _state.value.copy(history = emptyList(), loading = false, error = null, entries = emptyList())
            return
        }
        val newHistory = _state.value.history.take(index + 1)
        _state.value = _state.value.copy(history = newHistory, loading = true, error = null, entries = emptyList())
        newHistory.lastOrNull()?.let { WsRepository.listDirectory(it) }
    }

    fun retry() {
        val path = _state.value.currentPath ?: return
        _state.value = _state.value.copy(loading = true, error = null)
        WsRepository.listDirectory(path)
    }
}
