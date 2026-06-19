package io.nexy.android.ui.artifacts

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ArtifactDetail2
import io.nexy.android.data.model.ArtifactExportFile
import io.nexy.android.data.model.ArtifactSummary
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
                    is WsEvent.ArtifactDetail -> _selectedArtifact.value = event.artifact
                    is WsEvent.ArtifactExportPack -> {
                        _exporting.value = false
                        _exportPack.value = event.files
                    }
                    is WsEvent.ArtifactExportError -> {
                        _exporting.value = false
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
        _exportPack.value = null
        _exportError.value = null
        _exporting.value = false
    }

    fun exportVersion(versionId: String) {
        _exporting.value = true
        _exportError.value = null
        WsRepository.exportArtifact(versionId)
    }

    fun clearExport() {
        _exportPack.value = null
        _exportError.value = null
    }
}
