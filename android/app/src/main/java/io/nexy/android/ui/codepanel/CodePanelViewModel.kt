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

/** Detect-only summary of which already-configured auth (provider CLI / SSH agent / credential
 *  helper) would be used to push/fetch this repo's remote — Nexy never stores a secret itself. */
data class CodePanelCredentials(
    val remoteUrl: String?,
    val host: String?,
    val methods: List<String>,
)

data class CodePanelChangedFile(
    val relativePath: String,
    /** Already in the index — `git commit` alone (without staging first) would include it. */
    val staged: Boolean,
)

data class CodePanelState(
    val workspaceRoot: String? = null,
    val repos: List<CodePanelRepo> = emptyList(),
    val isLoadingRepos: Boolean = false,
    val selectedRepoRelativePath: String? = null,
    val branches: CodePanelBranches? = null,
    val changedFiles: List<CodePanelChangedFile> = emptyList(),
    val selectedChangedFiles: Set<String> = emptySet(),
    val isLoadingRepoDetail: Boolean = false,
    val isActionInProgress: Boolean = false,
    val actionMessage: String? = null,
    val error: String? = null,
    val conflict: CodePanelConflict? = null,
    val credentials: CodePanelCredentials? = null,
    val isInitializingRepo: Boolean = false,
    val stashCount: Int = 0,
    val diffFile: String? = null,
    val diffText: String? = null,
    val diffBinary: Boolean = false,
    val isLoadingDiff: Boolean = false,
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

    // The WS protocol has no request/reply correlation — two async requests for the same thing
    // fired close together (e.g. a stage action's refresh landing right after the initial repo
    // load) can resolve out of order, letting a slow stale reply clobber fresher state. Each of
    // these is incremented before every request and echoed back by the server; a reply is only
    // applied if its seq still matches the latest one sent; anything older is dropped as stale.
    private var changedFilesSeq = 0
    private var branchesSeq = 0
    private var diffSeq = 0

    private fun requestChangedFiles(repoRoot: String) {
        changedFilesSeq += 1
        wsRepository.listCodeChangeChangedFiles(repoRoot, changedFilesSeq)
    }

    private fun requestBranches(repoRoot: String) {
        branchesSeq += 1
        wsRepository.listCodeChangeBranches(repoRoot, branchesSeq)
    }

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
                if (event.seq != branchesSeq) return
                _state.value = _state.value.copy(
                    branches = CodePanelBranches(event.current, event.local, event.remote),
                    isLoadingRepoDetail = false,
                )
            }
            is WsEvent.CodeChangeChangedFiles -> {
                if (event.seq != changedFilesSeq) return
                val files = event.files.map { CodePanelChangedFile(it.relativePath, it.staged) }
                val stillPresent = files.map { it.relativePath }.toSet()
                _state.value = _state.value.copy(
                    changedFiles = files,
                    // Drop any selection for files that no longer show up as changed (e.g. just
                    // committed/discarded) instead of holding a stale, invisible selection.
                    selectedChangedFiles = _state.value.selectedChangedFiles.filterTo(mutableSetOf()) { it in stillPresent },
                )
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
            is WsEvent.CodeChangeRepoInitialized -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Repository initialized.", isInitializingRepo = false)
                } else {
                    _state.value.copy(error = event.error ?: "Failed to initialize repository.", isInitializingRepo = false)
                }
                if (event.ok) workspaceRoot?.let { root ->
                    _state.value = _state.value.copy(isLoadingRepos = true)
                    wsRepository.listCodeChangeRepos(root)
                }
            }
            is WsEvent.CodeChangeCredentials -> {
                _state.value = _state.value.copy(
                    credentials = CodePanelCredentials(
                        remoteUrl = event.remoteUrl,
                        host = event.host,
                        methods = event.methods.map { "${it.label}: ${it.detail}" },
                    ),
                )
            }
            is WsEvent.CodeChangePulled -> {
                _state.value = when {
                    event.conflicted -> _state.value.copy(
                        conflict = CodePanelConflict(
                            conflictedFiles = event.conflictedFiles.map { it.relativePath },
                            error = event.error,
                        ),
                        isActionInProgress = false,
                    )
                    event.ok -> _state.value.copy(actionMessage = "Pulled latest changes.", conflict = null, isActionInProgress = false)
                    else -> _state.value.copy(error = event.error ?: "Pull failed.", isActionInProgress = false)
                }
                if (event.ok && !event.conflicted) refreshRepoDetail()
            }
            is WsEvent.CodeChangeBranchPushed -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Pushed.", isActionInProgress = false)
                } else {
                    _state.value.copy(error = event.error ?: "Push failed.", isActionInProgress = false)
                }
            }
            is WsEvent.CodeChangeCommitted -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Committed.", isActionInProgress = false)
                } else {
                    _state.value.copy(error = event.error ?: "Commit failed.", isActionInProgress = false)
                }
                if (event.ok) refreshRepoDetail()
            }
            is WsEvent.CodeChangeFileDiscarded -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Discarded changes to ${event.relativePath}.", isActionInProgress = false)
                } else {
                    _state.value.copy(error = event.error ?: "Failed to discard changes.", isActionInProgress = false)
                }
                if (event.ok) refreshRepoDetail()
            }
            is WsEvent.CodeChangeStashed -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Stashed current changes.", isActionInProgress = false)
                } else {
                    _state.value.copy(error = event.error ?: "Stash failed.", isActionInProgress = false)
                }
                if (event.ok) {
                    refreshRepoDetail()
                    selectedRepoRoot?.let { wsRepository.getCodeChangeStashCount(it) }
                }
            }
            is WsEvent.CodeChangeStashPopped -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Restored the most recent stash.", isActionInProgress = false)
                } else {
                    _state.value.copy(error = event.error ?: "Stash pop failed.", isActionInProgress = false)
                }
                if (event.ok) {
                    refreshRepoDetail()
                    selectedRepoRoot?.let { wsRepository.getCodeChangeStashCount(it) }
                }
            }
            is WsEvent.CodeChangeStashCount -> {
                _state.value = _state.value.copy(stashCount = event.count)
            }
            is WsEvent.CodeChangeBranchDeleted -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Deleted branch ${event.branchName}.", isActionInProgress = false)
                } else {
                    _state.value.copy(error = event.error ?: "Failed to delete branch.", isActionInProgress = false)
                }
                if (event.ok) refreshRepoDetail()
            }
            is WsEvent.CodeChangeStaged -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Staged.", isActionInProgress = false, selectedChangedFiles = emptySet())
                } else {
                    _state.value.copy(error = event.error ?: "Failed to stage.", isActionInProgress = false)
                }
                if (event.ok) refreshRepoDetail()
            }
            is WsEvent.CodeChangeUnstaged -> {
                _state.value = if (event.ok) {
                    _state.value.copy(actionMessage = "Unstaged.", isActionInProgress = false, selectedChangedFiles = emptySet())
                } else {
                    _state.value.copy(error = event.error ?: "Failed to unstage.", isActionInProgress = false)
                }
                if (event.ok) refreshRepoDetail()
            }
            is WsEvent.CodeChangeFileDiff -> {
                if (event.relativePath == _state.value.diffFile && event.seq == diffSeq) {
                    _state.value = _state.value.copy(diffText = event.diff, diffBinary = event.binary, isLoadingDiff = false)
                }
            }
            is WsEvent.CodeChangeError -> {
                _state.value = _state.value.copy(
                    error = event.error,
                    isLoadingRepos = false,
                    isLoadingRepoDetail = false,
                    isActionInProgress = false,
                    isLoadingDiff = false,
                    isInitializingRepo = false,
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
            selectedChangedFiles = emptySet(),
            conflict = null,
            error = null,
            credentials = null,
            stashCount = 0,
            diffFile = null,
            diffText = null,
        )
        requestBranches(repoRoot)
        requestChangedFiles(repoRoot)
        wsRepository.detectCodeChangeCredentials(repoRoot)
        wsRepository.getCodeChangeStashCount(repoRoot)
    }

    /** Closes the empty-state dead end: lets the user create a repo right from the panel instead
     *  of switching to a terminal. `relativePath` is blank for "init at the workspace root". */
    fun initRepo(relativePath: String? = null) {
        val root = workspaceRoot ?: return
        if (_state.value.isInitializingRepo) return
        _state.value = _state.value.copy(isInitializingRepo = true)
        wsRepository.initCodeChangeRepo(root, relativePath)
    }

    fun closeRepoDetail() {
        selectedRepoRoot = null
        _state.value = _state.value.copy(
            selectedRepoRelativePath = null,
            branches = null,
            changedFiles = emptyList(),
            selectedChangedFiles = emptySet(),
            conflict = null,
            credentials = null,
            stashCount = 0,
            diffFile = null,
            diffText = null,
        )
        // The repo list's branch/dirty summary was snapshotted when it was first loaded — refresh
        // it so checking out or merging in the detail view is reflected once the user backs out,
        // instead of the list silently showing whatever branch/dirty state existed before.
        workspaceRoot?.let { wsRepository.listCodeChangeRepos(it) }
    }

    fun refreshRepoDetail() {
        val repoRoot = selectedRepoRoot ?: return
        requestBranches(repoRoot)
        requestChangedFiles(repoRoot)
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

    fun pull() {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.pullCodeChangeRepo(repoRoot)
    }

    fun pushBranch() {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.pushCodeChangeBranch(repoRoot)
    }

    fun commit(message: String) {
        if (_state.value.isActionInProgress || message.isBlank()) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.commitCodeChangeFiles(repoRoot, message)
    }

    fun discardFile(relativePath: String) {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.discardCodeChangeFile(repoRoot, relativePath)
    }

    fun toggleFileSelection(relativePath: String) {
        val current = _state.value.selectedChangedFiles
        _state.value = _state.value.copy(
            selectedChangedFiles = if (relativePath in current) current - relativePath else current + relativePath,
        )
    }

    fun clearFileSelection() {
        _state.value = _state.value.copy(selectedChangedFiles = emptySet())
    }

    /** Stages the current selection, or a single file when tapped directly from its row's quick
     *  stage icon (bypassing multi-select for the common one-file case). */
    fun stageFiles(relativePaths: Set<String> = _state.value.selectedChangedFiles) {
        if (_state.value.isActionInProgress || relativePaths.isEmpty()) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.stageCodeChangeFiles(repoRoot, relativePaths.toList())
    }

    fun unstageFiles(relativePaths: Set<String> = _state.value.selectedChangedFiles) {
        if (_state.value.isActionInProgress || relativePaths.isEmpty()) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.unstageCodeChangeFiles(repoRoot, relativePaths.toList())
    }

    fun stash() {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.stashCodeChanges(repoRoot)
    }

    fun stashPop() {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.stashPopCodeChanges(repoRoot)
    }

    fun deleteBranch(branchName: String, deleteRemote: Boolean = false, force: Boolean = false) {
        if (_state.value.isActionInProgress) return
        val repoRoot = selectedRepoRoot ?: return
        _state.value = _state.value.copy(isActionInProgress = true)
        wsRepository.deleteCodeChangeBranch(repoRoot, branchName, deleteRemote, force)
    }

    /** Opens the diff view for a changed file — mirrors the repo-detail drill-down (state field +
     *  a WS round-trip), not a separate navigation route, so back behaves consistently with the
     *  rest of this screen. */
    fun openDiff(relativePath: String) {
        val repoRoot = selectedRepoRoot ?: return
        diffSeq += 1
        _state.value = _state.value.copy(diffFile = relativePath, diffText = null, diffBinary = false, isLoadingDiff = true)
        wsRepository.getCodeChangeFileDiff(repoRoot, relativePath, diffSeq)
    }

    fun closeDiff() {
        _state.value = _state.value.copy(diffFile = null, diffText = null, diffBinary = false, isLoadingDiff = false)
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
