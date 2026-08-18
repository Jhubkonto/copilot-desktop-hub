package io.nexy.android.ui.scheduler

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ScheduledRun
import io.nexy.android.data.model.ScheduledTask
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class SchedulerViewModel(app: Application) : AndroidViewModel(app) {

    val tasks: StateFlow<List<ScheduledTask>> = WsRepository.scheduledTasks
    val runs: StateFlow<Map<String, List<ScheduledRun>>> = WsRepository.scheduledRuns

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    private var timeoutJob: Job? = null

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.SchedulerTaskList -> {
                        timeoutJob?.cancel()
                        _isLoading.value = false
                        _error.value = null
                    }
                    is WsEvent.SchedulerRunError -> {
                        _actionError.value = event.error
                    }
                    else -> {}
                }
            }
        }
        viewModelScope.launch {
            WsRepository.connectionState.collect { state ->
                if (state == ConnectionState.CONNECTED) refresh()
            }
        }
    }

    fun refresh() {
        if (WsRepository.connectionState.value != ConnectionState.CONNECTED) {
            _isLoading.value = false
            _error.value = "Not connected to desktop."
            return
        }
        _isLoading.value = true
        _error.value = null
        WsRepository.schedulerList()
        timeoutJob?.cancel()
        timeoutJob = viewModelScope.launch {
            delay(10_000)
            if (_isLoading.value) {
                _isLoading.value = false
                _error.value = "Request timed out. Check desktop connection."
            }
        }
    }

    fun loadRuns(taskId: String) {
        WsRepository.schedulerListRuns(taskId)
    }

    fun create(input: Map<String, Any?>) {
        WsRepository.schedulerCreate(input)
    }

    fun update(taskId: String, input: Map<String, Any?>) {
        WsRepository.schedulerUpdate(taskId, input)
    }

    fun delete(taskId: String) {
        WsRepository.schedulerDelete(taskId)
    }

    fun setEnabled(taskId: String, enabled: Boolean) {
        WsRepository.schedulerSetEnabled(taskId, enabled)
    }

    fun runNow(taskId: String) {
        _actionError.value = null
        WsRepository.schedulerRunNow(taskId)
    }

    fun resumeRun(runId: String) {
        _actionError.value = null
        WsRepository.schedulerResumeRun(runId)
    }

    fun dismissError() { _error.value = null }
    fun dismissActionError() { _actionError.value = null }
}
