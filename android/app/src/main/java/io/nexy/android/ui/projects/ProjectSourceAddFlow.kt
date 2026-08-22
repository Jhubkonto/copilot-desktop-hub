package io.nexy.android.ui.projects

import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.WsEvent

internal data class ProjectSourceAddState private constructor(
    val awaitingAcknowledgement: Boolean,
    val selectedPath: String,
) {
    companion object {
        fun inFlight(selectedPath: String = "") = ProjectSourceAddState(
            awaitingAcknowledgement = true,
            selectedPath = selectedPath,
        )
    }
}

internal sealed interface ProjectSourceAddResult {
    data object Pending : ProjectSourceAddResult
    data object Added : ProjectSourceAddResult
    data class Error(val message: String) : ProjectSourceAddResult
}

internal fun projectSourceAddResult(
    state: ProjectSourceAddState,
    projectId: String,
    event: WsEvent,
): ProjectSourceAddResult {
    if (!state.awaitingAcknowledgement) return ProjectSourceAddResult.Pending
    return when (event) {
        is WsEvent.ProjectSourcesUpdated -> if (event.id == projectId && event.config.containsSource(state.selectedPath)) {
            ProjectSourceAddResult.Added
        } else {
            ProjectSourceAddResult.Pending
        }
        is WsEvent.ProjectConfigChanged -> if (event.id == projectId && event.config?.containsSource(state.selectedPath) == true) {
            ProjectSourceAddResult.Added
        } else {
            ProjectSourceAddResult.Pending
        }
        is WsEvent.ProjectConfig -> if (event.id == projectId && event.config.containsSource(state.selectedPath)) {
            ProjectSourceAddResult.Added
        } else {
            ProjectSourceAddResult.Pending
        }
        is WsEvent.ProjectSourcesError -> if (event.id == projectId && event.action == "add") {
            ProjectSourceAddResult.Error(event.message)
        } else {
            ProjectSourceAddResult.Pending
        }
        else -> ProjectSourceAddResult.Pending
    }
}

private fun ProjectSettingsConfig.containsSource(path: String): Boolean {
    if (path.isBlank()) return false
    val expected = normalizeSourcePath(path)
    return sources.any { normalizeSourcePath(it.localPath) == expected }
}

private fun normalizeSourcePath(path: String): String =
    path.trim().trimEnd('/', '\\').replace('/', '\\').lowercase()

internal fun shouldRefreshProjectConfigOnResume(pendingProjectId: String?, projectId: String): Boolean =
    pendingProjectId == projectId
