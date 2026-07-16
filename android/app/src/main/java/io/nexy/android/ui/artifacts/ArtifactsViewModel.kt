package io.nexy.android.ui.artifacts

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ArtifactDetail2
import io.nexy.android.data.model.ArtifactExportFile
import io.nexy.android.data.model.ArtifactGeneratorSpec
import io.nexy.android.data.model.ArtifactOutputFile
import io.nexy.android.data.model.ArtifactSourceContext
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.ArtifactVersionSummary
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ArtifactsViewModel(app: Application) : AndroidViewModel(app) {

    val artifacts: StateFlow<List<ArtifactSummary>> = WsRepository.artifacts

    private val _selectedArtifact = MutableStateFlow<ArtifactDetail2?>(null)
    val selectedArtifact: StateFlow<ArtifactDetail2?> = _selectedArtifact.asStateFlow()

    private val _versions = MutableStateFlow<List<ArtifactVersionSummary>>(emptyList())
    val versions: StateFlow<List<ArtifactVersionSummary>> = _versions.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _exportPack = MutableStateFlow<List<ArtifactExportFile>?>(null)
    val exportPack: StateFlow<List<ArtifactExportFile>?> = _exportPack.asStateFlow()

    private val _exportError = MutableStateFlow<String?>(null)
    val exportError: StateFlow<String?> = _exportError.asStateFlow()

    private val _exporting = MutableStateFlow(false)
    val exporting: StateFlow<Boolean> = _exporting.asStateFlow()

    private val _deleting = MutableStateFlow(false)
    val deleting: StateFlow<Boolean> = _deleting.asStateFlow()

    private val _deletingVersionId = MutableStateFlow<String?>(null)
    val deletingVersionId: StateFlow<String?> = _deletingVersionId.asStateFlow()

    private val _deletingArtifactId = MutableStateFlow<String?>(null)
    val deletingArtifactId: StateFlow<String?> = _deletingArtifactId.asStateFlow()

    private val _listDeleteError = MutableStateFlow<String?>(null)
    val listDeleteError: StateFlow<String?> = _listDeleteError.asStateFlow()

    private val _revisioning = MutableStateFlow(false)
    val revisioning: StateFlow<Boolean> = _revisioning.asStateFlow()

    private var timeoutJob: Job? = null
    private var pendingProjectId: String? = null

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.ArtifactList -> {
                        timeoutJob?.cancel()
                        _isLoading.value = false
                        _error.value = null
                    }
                    is WsEvent.ArtifactDetail -> {
                        _selectedArtifact.value = event.artifact
                        _versions.value = event.artifact?.currentVersion?.let { listOf(it) }.orEmpty()
                        event.artifact?.id?.let { WsRepository.listArtifactVersions(it) }
                    }
                    is WsEvent.ArtifactVersions -> {
                        if (_selectedArtifact.value?.id == event.artifactId) {
                            _versions.value = event.versions
                        }
                    }
                    is WsEvent.ArtifactDeleted -> {
                        _deleting.value = false
                        val wasListDelete = _deletingArtifactId.value == event.id
                        _deletingArtifactId.value = null
                        if (event.deleted) {
                            if (_selectedArtifact.value?.id == event.id) clearSelection()
                            refresh(pendingProjectId)
                        } else {
                            val message = "Artifact could not be deleted."
                            if (wasListDelete) _listDeleteError.value = message else _exportError.value = message
                        }
                    }
                    is WsEvent.ArtifactVersionDeleted -> {
                        _deletingVersionId.value = null
                        if (!event.deleted) {
                            _exportError.value = "Version could not be deleted."
                        }
                    }
                    is WsEvent.ArtifactVersionDeleteError -> {
                        _deletingVersionId.value = null
                        _exportError.value = event.message
                    }
                    is WsEvent.ArtifactGeneratorCreated -> {
                        _revisioning.value = false
                        _error.value = null
                        val selected = _selectedArtifact.value
                        refresh(pendingProjectId)
                        if (selected != null && event.artifactId == selected.id) {
                            WsRepository.getArtifact(selected.id)
                        }
                    }
                    is WsEvent.ArtifactExportPack -> {
                        _exporting.value = false
                        _exportPack.value = event.files
                    }
                    is WsEvent.ArtifactExportError -> {
                        _exporting.value = false
                        _exportError.value = event.message
                    }
                    is WsEvent.ArtifactGeneratorError -> {
                        _revisioning.value = false
                        _exportError.value = event.message
                    }
                    else -> {}
                }
            }
        }
        // Retry when the connection is established
        viewModelScope.launch {
            WsRepository.connectionState.collect { state ->
                if (state == ConnectionState.CONNECTED) refresh(pendingProjectId)
            }
        }
    }

    fun refresh(projectId: String? = null) {
        pendingProjectId = projectId
        if (WsRepository.connectionState.value != ConnectionState.CONNECTED) {
            _isLoading.value = false
            _error.value = "Not connected to desktop."
            return
        }
        _isLoading.value = true
        _error.value = null
        WsRepository.listArtifacts(projectId)
        timeoutJob?.cancel()
        timeoutJob = viewModelScope.launch {
            delay(10_000)
            if (_isLoading.value) {
                _isLoading.value = false
                _error.value = "Request timed out. Check desktop connection."
            }
        }
    }

    fun dismissError() { _error.value = null }

    fun selectArtifact(id: String) {
        WsRepository.getArtifact(id)
    }

    fun clearSelection() {
        _selectedArtifact.value = null
        _versions.value = emptyList()
        _exportPack.value = null
        _exportError.value = null
        _exporting.value = false
        _deleting.value = false
        _deletingVersionId.value = null
        _revisioning.value = false
    }

    fun exportVersion(versionId: String) {
        _exporting.value = true
        _exportError.value = null
        WsRepository.exportArtifact(versionId)
    }

    fun deleteSelectedArtifact() {
        val id = _selectedArtifact.value?.id ?: return
        _deleting.value = true
        _exportError.value = null
        WsRepository.deleteArtifact(id)
    }

    fun deleteArtifact(id: String) {
        if (_deletingArtifactId.value != null) return
        _deletingArtifactId.value = id
        _listDeleteError.value = null
        WsRepository.deleteArtifact(id)
    }

    fun dismissListDeleteError() { _listDeleteError.value = null }

    fun deleteVersion(versionId: String) {
        if (_deletingVersionId.value != null) return
        _deletingVersionId.value = versionId
        _exportError.value = null
        WsRepository.deleteArtifactVersion(versionId)
    }

    fun generateNewVersion() {
        val artifact = _selectedArtifact.value ?: return
        if (_revisioning.value) return
        val currentFiles = artifact.currentVersion?.files.orEmpty()
        val outputFiles = currentFiles.map {
            ArtifactOutputFile(
                path = it.relativePath,
                mediaType = it.mediaType,
                role = it.role,
                description = null,
            )
        }.ifEmpty {
            listOf(
                ArtifactOutputFile(
                    path = "output.md",
                    mediaType = "text/markdown",
                    role = "primary",
                    description = "Primary artifact output",
                )
            )
        }
        val spec = ArtifactGeneratorSpec(
            title = artifact.title,
            kind = artifact.kind,
            scopeType = if (artifact.projectId != null) "project" else "global",
            scopeProjectId = artifact.projectId,
            intendedUse = artifact.description ?: "Generate a revised version of ${artifact.title}",
            audience = null,
            outputFiles = outputFiles,
            acceptanceCriteria = listOf("Preserves the existing artifact intent", "Improves or refreshes the content for a new version"),
            exportFormats = listOf("raw-files", "markdown"),
            sourceContext = ArtifactSourceContext(
                useProjectInstructions = artifact.projectId != null,
                useProjectWiki = false,
                useConversationContext = false,
                referencedFiles = emptyList(),
            ),
        )
        _revisioning.value = true
        _error.value = null
        WsRepository.generateArtifact("android-artifact-revise-${artifact.id}-${System.currentTimeMillis()}", spec)
    }

    fun clearExport() {
        _exportPack.value = null
        _exportError.value = null
    }
}
