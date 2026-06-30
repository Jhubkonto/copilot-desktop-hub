package io.nexy.android.ui.remoteedit

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class RemoteEditViewModel(app: Application) : AndroidViewModel(app) {
    val errorReports: StateFlow<List<ErrorReport>> = WsRepository.errorReports

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()
    private val _workspaceInfo = MutableStateFlow<WsEvent.BuildWorkspaceInfo?>(null)
    val workspaceInfo: StateFlow<WsEvent.BuildWorkspaceInfo?> = _workspaceInfo.asStateFlow()

    init {
        _isRefreshing.value = true
        WsRepository.sendLog("RemoteEditVM", "init: requesting reports")
        WsRepository.refreshReports()
        WsRepository.getBuildWorkspaceInfo()
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.RemoteEditReports -> {
                        WsRepository.sendLog("RemoteEditVM", "RemoteEditReports received: ${event.reports.size} reports")
                        _isRefreshing.value = false
                    }
                    is WsEvent.BuildWorkspaceInfo -> _workspaceInfo.value = event
                    else -> {}
                }
            }
        }
    }

    fun refresh() {
        _isRefreshing.value = true
        WsRepository.sendLog("RemoteEditVM", "refresh: requesting reports")
        WsRepository.refreshReports()
        WsRepository.getBuildWorkspaceInfo()
    }
}
