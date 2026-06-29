package io.nexy.android.ui.projects

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ProjectAuditDiff
import io.nexy.android.data.model.ProjectAuditFile
import io.nexy.android.data.model.ProjectAuditSession
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ProjectAuditViewModel(app: Application) : AndroidViewModel(app) {
    private val _sessions = MutableStateFlow<List<ProjectAuditSession>>(emptyList())
    val sessions: StateFlow<List<ProjectAuditSession>> = _sessions.asStateFlow()

    private val _filesBySession = MutableStateFlow<Map<String, List<ProjectAuditFile>>>(emptyMap())
    val filesBySession: StateFlow<Map<String, List<ProjectAuditFile>>> = _filesBySession.asStateFlow()

    private val _diffsByKey = MutableStateFlow<Map<String, ProjectAuditDiff?>>(emptyMap())
    val diffsByKey: StateFlow<Map<String, ProjectAuditDiff?>> = _diffsByKey.asStateFlow()

    private val _loadingSessions = MutableStateFlow(false)
    val loadingSessions: StateFlow<Boolean> = _loadingSessions.asStateFlow()

    private val _loadingFiles = MutableStateFlow<Set<String>>(emptySet())
    val loadingFiles: StateFlow<Set<String>> = _loadingFiles.asStateFlow()

    private val _loadingDiffs = MutableStateFlow<Set<String>>(emptySet())
    val loadingDiffs: StateFlow<Set<String>> = _loadingDiffs.asStateFlow()

    private var currentProjectId: String? = null

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.ProjectAuditSessions -> {
                        if (event.projectId == null || event.projectId == currentProjectId) {
                            _sessions.value = event.sessions
                            _loadingSessions.value = false
                        }
                    }
                    is WsEvent.ProjectAuditFiles -> {
                        _filesBySession.value = _filesBySession.value + (event.sessionId to event.files)
                        _loadingFiles.value = _loadingFiles.value - event.sessionId
                    }
                    is WsEvent.ProjectAuditDiffLoaded -> {
                        val path = event.diff?.relativePath
                        if (!path.isNullOrBlank()) {
                            _diffsByKey.value = _diffsByKey.value + (diffKey(event.sessionId, path) to event.diff)
                            _loadingDiffs.value = _loadingDiffs.value - diffKey(event.sessionId, path)
                        }
                    }
                    else -> {}
                }
            }
        }
    }

    fun load(projectId: String) {
        currentProjectId = projectId
        _loadingSessions.value = true
        _sessions.value = emptyList()
        _filesBySession.value = emptyMap()
        _diffsByKey.value = emptyMap()
        _loadingFiles.value = emptySet()
        _loadingDiffs.value = emptySet()
        WsRepository.listProjectAuditSessions(projectId)
    }

    fun ensureFilesLoaded(sessionId: String) {
        if (_filesBySession.value.containsKey(sessionId) || _loadingFiles.value.contains(sessionId)) return
        _loadingFiles.value = _loadingFiles.value + sessionId
        WsRepository.listProjectAuditFiles(sessionId)
    }

    fun ensureDiffLoaded(sessionId: String, relativePath: String) {
        val key = diffKey(sessionId, relativePath)
        if (_diffsByKey.value.containsKey(key) || _loadingDiffs.value.contains(key)) return
        _loadingDiffs.value = _loadingDiffs.value + key
        WsRepository.getProjectAuditDiff(sessionId, relativePath)
    }

    fun diffKey(sessionId: String, relativePath: String): String = "$sessionId::$relativePath"
}
