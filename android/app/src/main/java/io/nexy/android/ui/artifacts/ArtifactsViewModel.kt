package io.nexy.android.ui.artifacts

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ArtifactDetail2
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.WsEvent
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

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.ArtifactList -> _isLoading.value = false
                    is WsEvent.ArtifactDetail -> _selectedArtifact.value = event.artifact
                    else -> {}
                }
            }
        }
    }

    fun refresh(projectId: String? = null) {
        _isLoading.value = true
        WsRepository.listArtifacts(projectId)
    }

    fun selectArtifact(id: String) {
        WsRepository.getArtifact(id)
    }

    fun clearSelection() {
        _selectedArtifact.value = null
    }
}
