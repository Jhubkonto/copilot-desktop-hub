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

    // Path passed in via openInitial() that we're waiting on the very first listing for — lets
    // the FsDirectoryListing handler tell "configured path doesn't exist, fall back to the
    // chooser" apart from "user navigated somewhere and hit a real error, show Retry".
    private var pendingInitialPath: String? = null
    private var initialPathRequested = false

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
                            if (event.error != null && event.path == pendingInitialPath) {
                                // The project's configured root directory no longer exists — fall
                                // back to the home/recents chooser instead of showing an error.
                                pendingInitialPath = null
                                _state.value = _state.value.copy(
                                    history = emptyList(),
                                    loading = false,
                                    error = null,
                                    entries = emptyList(),
                                )
                            } else {
                                pendingInitialPath = null
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
                    }
                    else -> {}
                }
            }
        }
    }

    /** Called once from the screen on first composition. If [path] is set, jump straight
     *  into it instead of showing the home/recents chooser; falls back to the chooser if
     *  that path turns out not to exist (see the FsDirectoryListing handler above). */
    fun openInitial(path: String) {
        if (initialPathRequested) return
        initialPathRequested = true
        if (path.isBlank()) return
        pendingInitialPath = path
        open(path)
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

    /** Move to the filesystem parent of the current directory. */
    fun goUpOneLevel() {
        val currentPath = _state.value.currentPath ?: return

        // Prefer the existing navigation stack so going up after drilling into a folder does
        // not create duplicate breadcrumb entries. A directly opened project root has no parent
        // in history, so replace it with its filesystem parent instead.
        if (_state.value.history.size > 1) {
            navigateTo(_state.value.history.size - 2)
            return
        }

        currentPath.parentPath()?.let { parent ->
            _state.value = _state.value.copy(
                history = listOf(parent),
                loading = true,
                error = null,
                entries = emptyList(),
            )
            WsRepository.listDirectory(parent)
        }
    }

    fun retry() {
        val path = _state.value.currentPath ?: return
        _state.value = _state.value.copy(loading = true, error = null)
        WsRepository.listDirectory(path)
    }
}

/** Returns the parent while preserving a Unix root or Windows drive root. */
internal fun String.parentPath(): String? {
    val path = trimEnd('/', '\\')
    if (path.isBlank()) return null

    val separatorIndex = maxOf(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    if (separatorIndex < 0) return null
    if (separatorIndex == 0) return path.substring(0, 1)

    val parent = path.substring(0, separatorIndex)
    return if (parent.length == 2 && parent[1] == ':') {
        // Keep a drive root recognizable as a directory for the next navigation.
        "$parent${path[separatorIndex]}"
    } else {
        parent
    }
}
