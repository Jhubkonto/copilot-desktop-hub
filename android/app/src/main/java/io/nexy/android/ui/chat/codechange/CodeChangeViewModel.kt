package io.nexy.android.ui.chat.codechange

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class CodeChangeState(
    val conversationId: String,
    val reportId: String? = null,
    val currentStep: String = "describe",
    val workspace: CodeChangeWorkspace? = null,
    val selectedRepoPath: String = "",
    val description: String = "",
    val plan: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val successMessage: String? = null,
)

data class CodeChangeWorkspace(
    val repos: List<RepoInfo>,
    val selectedRepoPath: String = "",
)

data class RepoInfo(
    val relativePath: String,
    val branch: String,
    val dirty: Boolean = false,
    val files: List<String> = emptyList(),
)

/**
 * Owns the 6-step wizard state for a single dedicated Code Changes conversation.
 * The conversation/report are assumed to already exist by the time this ViewModel
 * is created (mounted only when `Conversation.kind == "code-change"`); repo selection
 * happens before the conversation is created, not inside the wizard.
 */
class CodeChangeViewModel(
    private val wsRepository: WsRepository,
    val conversation: Conversation,
) : ViewModel() {
    private val _codeChangeState = MutableStateFlow(
        CodeChangeState(conversationId = conversation.id, isLoading = true)
    )
    val codeChangeState: StateFlow<CodeChangeState> = _codeChangeState.asStateFlow()

    init {
        viewModelScope.launch {
            wsRepository.events.collect { event -> handleEvent(event) }
        }
        loadReportForConversation()
    }

    private fun handleEvent(event: WsEvent) {
        when (event) {
            is WsEvent.CodeChangeReport -> {
                if (event.reportId == null) {
                    _codeChangeState.value = _codeChangeState.value.copy(
                        isLoading = false,
                        error = "No code change request found for this conversation",
                    )
                } else {
                    _codeChangeState.value = _codeChangeState.value.copy(
                        reportId = event.reportId,
                        currentStep = event.step ?: "describe",
                        selectedRepoPath = event.repoRelativePath ?: _codeChangeState.value.selectedRepoPath,
                        plan = event.plan ?: "",
                        isLoading = false,
                        error = null,
                    )
                }
            }

            is WsEvent.CodeChangeStepUpdated -> {
                if (event.reportId == _codeChangeState.value.reportId) {
                    _codeChangeState.value = _codeChangeState.value.copy(
                        currentStep = event.step,
                        isLoading = event.step == "executing" || event.step == "verifying",
                        error = null,
                    )
                    // Plan content isn't carried on step-updated broadcasts; re-fetch the full
                    // report so PlanReviewStep has the latest investigation markdown to show.
                    if (event.step == "plan-review") {
                        loadReportForConversation()
                    }
                }
            }

            is WsEvent.CodeChangeError -> {
                if (event.reportId == null || event.reportId == _codeChangeState.value.reportId) {
                    _codeChangeState.value = _codeChangeState.value.copy(
                        isLoading = false,
                        error = event.error,
                    )
                }
            }

            is WsEvent.CodeChangeAck -> {
                if (event.reportId == _codeChangeState.value.reportId) {
                    when (event.kind) {
                        "code-change:pushed" -> _codeChangeState.value = _codeChangeState.value.copy(
                            isLoading = false,
                            successMessage = "Changes pushed successfully",
                        )
                        "code-change:completed" -> _codeChangeState.value = _codeChangeState.value.copy(
                            isLoading = false,
                            successMessage = "Code changes completed successfully",
                        )
                        else -> _codeChangeState.value = _codeChangeState.value.copy(isLoading = false)
                    }
                }
            }

            is WsEvent.CodeChangeRepos -> {
                updateWorkspaceRepos(event.repos.map { RepoInfo(it.relativePath, it.branch) })
            }

            is WsEvent.CodeChangeFiles -> {
                updateRepoFiles(_codeChangeState.value.selectedRepoPath, event.files)
            }

            else -> Unit
        }
    }

    private fun loadReportForConversation() {
        wsRepository.send("code-change:get-report-for-conversation", mapOf("conversationId" to conversation.id))
    }

    fun discoverWorkspaceRepos(workspaceRoot: String) {
        _codeChangeState.value = _codeChangeState.value.copy(isLoading = true, error = null)
        wsRepository.send("code-change:list-repos", mapOf("workspaceRoot" to workspaceRoot))
    }

    fun selectRepo(relativePath: String) {
        _codeChangeState.value = _codeChangeState.value.copy(selectedRepoPath = relativePath)
    }

    fun submitDescription(description: String) {
        if (description.isBlank()) {
            _codeChangeState.value = _codeChangeState.value.copy(error = "Please describe the code changes")
            return
        }
        val reportId = _codeChangeState.value.reportId
        if (reportId == null) {
            _codeChangeState.value = _codeChangeState.value.copy(error = "No code change request ID")
            return
        }
        _codeChangeState.value = _codeChangeState.value.copy(description = description, isLoading = true, error = null)
        wsRepository.send("code-change:submit-description", mapOf("reportId" to reportId, "description" to description))
    }

    fun acceptPlanAndExecute() {
        val reportId = _codeChangeState.value.reportId
        if (reportId == null) {
            _codeChangeState.value = _codeChangeState.value.copy(error = "No code change request ID")
            return
        }
        _codeChangeState.value = _codeChangeState.value.copy(isLoading = true, error = null)
        wsRepository.send("code-change:accept-plan", mapOf("reportId" to reportId))
    }

    fun revisePlan(notes: String) {
        if (notes.isBlank()) {
            _codeChangeState.value = _codeChangeState.value.copy(error = "Please provide revision notes")
            return
        }
        val reportId = _codeChangeState.value.reportId
        if (reportId == null) {
            _codeChangeState.value = _codeChangeState.value.copy(error = "No code change request ID")
            return
        }
        _codeChangeState.value = _codeChangeState.value.copy(isLoading = true, error = null)
        wsRepository.send("code-change:revise-plan", mapOf("reportId" to reportId, "revisionNotes" to notes))
    }

    fun pushChanges() {
        val reportId = _codeChangeState.value.reportId
        if (reportId == null) {
            _codeChangeState.value = _codeChangeState.value.copy(error = "No code change request ID")
            return
        }
        _codeChangeState.value = _codeChangeState.value.copy(isLoading = true, error = null)
        wsRepository.send("code-change:push", mapOf("reportId" to reportId))
    }

    fun updateWorkspaceRepos(repos: List<RepoInfo>) {
        _codeChangeState.value = _codeChangeState.value.copy(
            workspace = CodeChangeWorkspace(repos),
            isLoading = false,
        )
    }

    fun updateRepoFiles(repoPath: String, files: List<String>) {
        val currentWorkspace = _codeChangeState.value.workspace ?: return
        val updatedRepos = currentWorkspace.repos.map {
            if (it.relativePath == repoPath) it.copy(files = files) else it
        }
        _codeChangeState.value = _codeChangeState.value.copy(
            workspace = currentWorkspace.copy(repos = updatedRepos)
        )
    }
}
