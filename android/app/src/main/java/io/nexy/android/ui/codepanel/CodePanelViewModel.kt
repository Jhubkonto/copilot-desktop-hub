package io.nexy.android.ui.codepanel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class CodePanelRepo(
    val relativePath: String,
    val branch: String,
    val dirty: Boolean,
)

data class CodePanelBranches(
    val current: String,
    val local: List<String>,
    val remote: List<String>,
)

/** A merge that landed with conflicts — no automatic AI resolution is wired up server-side (see
 *  git-manager.ts's mergeBranch), so this just surfaces the conflicted paths and offers "Resolve
 *  with AI in chat", which reuses the normal /code-change chat flow rather than a bespoke pipeline. */
data class CodePanelConflict(
    val conflictedFiles: List<String>,
    val error: String?,
)

data class CodePanelState(
    val workspaceRoot: String? = null,
    val repos: List<CodePanelRepo> = emptyList(),
    val isLoadingRepos: Boolean = false,
    val selectedRepoRelativePath: String? = null,
    val branches: CodePanelBranches? = null,
    val changedFiles: List<String> = emptyList(),
    val isLoadingRepoDetail: Boolean = false,
    val isActionInProgress: Boolean = false,
    val actionMessage: String? = null,
    val error: String? = null,
    val conflict: CodePanelConflict? = null,
)

/**
 * Backs the Android-only `/code` git panel (branches/checkout/fetch/merge/changed-files) — the
 * mobile-only replacement for typing raw `/code-branch`, `/code-checkout`, etc. on desktop. Hits
 * the exact same `code-change:*` git-housekeeping channels desktop's slash commands use.
 */
class CodePanelViewModel(
    private val projectId: String,
    private val wsRepository: WsRepository = WsRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(CodePanelState())
    val state: StateFlow<CodePanelState> = _state.asStateFlow()

    private var workspaceRoot: String? = null
    private var selectedRepoRoot: String? = null

    init {
        viewModelScope.launch {
            wsRepository.projects.collect { projects ->
                val root = projects.find { it.id == projectId }?.rootDirectory
                if (!root.isNullOrBlank() && root != workspaceRoot) {
                    workspaceRoot = root
                    _state.value = _state.value.copy(workspaceRoot = root, isLoadingRepos = true)
                    wsRepository.listCodeChangeRepos(root)
                }
            }
        }
        viewModelScope.launch {
            wsRepository.events.collect { event -> handleEvent(event) }
        }
    }

    private fun handleEvent(event: WsEvent) {
        when (event) {
            is WsEvent.CodeChangeRepos -> {
                _state.value = _state.value.copy(
                    repos = event.repos.map { CodePanelRepo(it.relativePath, it.branch, it.dirty) },
                    isLoadingRepos = false,
                )
            }
            is WsEvent.CodeChangeBranches -> {
                _state.value = _state.value.copy(
                    branches = CodePanelBranches(event.current, event.local, event.remote),
                    isLoadingRepoDetail = false,
                )
            }
            is WsEvent.CodeChangeChangedFiles -> {
                _state.value = _state.value.copy(changedFiles = event.files)
            }
            is WsEvent.CodeChangeCheckedOut -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Checked out.", isActionInProgress = false)
                } else {
                    _state.value.copy(error = event.error ?: "Checkout failed.", isActionInProgress = false)
                }
                if (event.ok) refreshRepoDetail()
            }
            is WsEvent.CodeChangeBranchCreated -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Branch created and checked out.", isActionInProgress = false)
                } else {
                    _state.value.copy(error = event.error ?: "Could not create branch.", isActionInProgress = false)
                }
                if (event.ok) refreshRepoDetail()
            }
            is WsEvent.CodeChangeFetched -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Fetched latest from remote.", isActionInProgress = false)
                } else {
                    _state.value.copy(error = event.error ?: "Fetch failed.", isActionInProgress = false)
                }
                if (event.ok) refreshRepoDetail()
            }
            is WsEvent.CodeChangeMerged -> {
                _state.value = when {
                    event.conflicted -> _state.value.copy(
                        conflict = CodePanelConflict(
                            conflictedFiles = event.conflictedFiles.map { it.relativePath },
                            error = event.error,
                        ),
                        isActionInProgress = false,
                    )
                    event.ok -> _state.value.copy(
                        // git's own merge output can be multi-line (diffstat etc.) — not
                        // Snackbar-appropriate, and the branch/changed-files views below already
                        // refresh to reflect the real post-merge state.
                        actionMessage = "Merged successfully.",
                        conflict = null,
                        isActionInProgress = false,
                    )
                    else -> _state.value.copy(error = event.error ?: "Merge failed.", isActionInProgress = false)
                }
                if (event.ok && !event.conflicted) refreshRepoDetail()
            }
            is WsEvent.CodeChangeError -> {
                _state.value = _state.value.copy(
                    error = event.error,
                    isLoadingRepos = false,
                    isLoadingRepoDetail = false,
                    isActionInProgress = false,
                )
            }
            else -> Unit
        }
    }

    private fun joinRepoRoot(root: String, relativePath: String): String {
        if (relativePath.isBlank()) return root
        val separator = if (root.contains('\\')) "\\" else "/"
        val normalizedRelative = relativePath.replace('/', separator[0]).replace('\\', separator[0])
        return if (root.endsWith(separator)) "$root$normalizedRelative" else "$root$separator$normalizedRelative"
    }

    fun selectRepo(relativePath: String) {
        val root = workspaceRoot ?: return
        val repoRoot = joinRepoRoot(root, relativePath)
        selectedRepoRoot = repoRoot
        _state.value = _state.value.copy(
            selectedRepoRelativePath = relativePath,
            isLoadingRepoDetail = true,
            branches = null,
            changedFiles = emptyList(),
            conflict = null,
            error = null,
        )
        wsRepository.listCodeChangeBranches(repoRoot)
        wsRepository.listCodeChangeChangedFiles(repoRoot)
    }

    fun closeRepoDetail() {
        selectedRepoRoot = null
        _state.value = _state.value.copy(
            selectedRepoRelativePath = null,
            branches = null,
            changedFiles = emptyList(),
            conflict = null,
        )
        // The repo list's branch/dirty summary was snapshotted when it was first loaded — refresh
        // it so checking out or merging in the detail view is reflected once the user backs out,
        // instead of the list silently showing whatever branch/dirty state existed before.
        workspaceRoot?.let { wsRepository.listCodeChangeRepos(it) }
    }

    fun refreshRepoDetail() {
        val repoRoot = selectedRepoRoot ?: return
        wsRepository.listCodeChangeBranches(repoRoot)
        wsRepository.listCodeChangeChangedFiles(repoRoot)
    }

    fun fetch() {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.fetchCodeChangeRepo(repoRoot)
    }

    fun checkout(branchName: String) {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.checkoutCodeChangeBranch(repoRoot, branchName)
    }

    fun createBranch(branchName: String, fromRef: String? = null) {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.createCodeChangeBranch(repoRoot, branchName, fromRef)
    }

    fun merge(sourceBranch: String) {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.mergeCodeChangeBranch(repoRoot, sourceBranch)
    }

    /** "Resolve with AI in chat": navigates to a brand-new conversation with "/code-change
     *  <description>" prefilled in its composer, rather than firing the WS command here directly.
     *  A freshly-navigated conversation's ChatViewModel starts with awaitingCodeChangeSubmit =
     *  false, so submitting the description from here (before that ViewModel exists to react to
     *  the eventual code-change:submitted event) would silently swallow the completion — the
     *  investigation would still run, but the user would see nothing happen. Prefilling and
     *  letting the user's own send go through ChatViewModel.trySlashCommand's normal /code-change
     *  path avoids that, at the cost of one extra tap to confirm the send. */
    fun resolveConflictsWithAi(): Pair<String, String>? {
        if (workspaceRoot == null) return null
        val conflict = _state.value.conflict ?: return null
        val relativePath = _state.value.selectedRepoRelativePath
        val conversationId = UUID.randomUUID().toString()
        val description = "Resolve git merge conflicts in: ${conflict.conflictedFiles.joinToString(", ")}" +
            (relativePath?.takeIf { it.isNotBlank() }?.let { " (repo: $it)" } ?: "")
        wsRepository.pendingComposerPrefill = "/code-change $description"
        return conversationId to projectId
    }

    fun consumeActionMessage() { _state.value = _state.value.copy(actionMessage = null) }
    fun consumeError() { _state.value = _state.value.copy(error = null) }
}

class CodePanelViewModelFactory(private val projectId: String) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return CodePanelViewModel(projectId) as T
    }
}
