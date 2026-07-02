package io.nexy.android.ui.remoteedit

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.RemoteEditInvestigationSettings
import io.nexy.android.data.model.RemoteEditRecoveryRun
import io.nexy.android.data.model.RemoteEditVerificationRun
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class RemoteEditActionResult(val reportId: String, val success: Boolean, val message: String)

class RemoteEditViewModel(
    app: Application,
    private val wsClient: WsClient,
) : AndroidViewModel(app) {

    constructor(app: Application) : this(app, WsRepository)

    val errorReports: StateFlow<List<ErrorReport>> = WsRepository.errorReports

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()
    private val _workspaceInfo = MutableStateFlow<WsEvent.BuildWorkspaceInfo?>(null)
    val workspaceInfo: StateFlow<WsEvent.BuildWorkspaceInfo?> = _workspaceInfo.asStateFlow()

    private val _deletingReportId = MutableStateFlow<String?>(null)
    val deletingReportId: StateFlow<String?> = _deletingReportId.asStateFlow()

    private val _isApplying = MutableStateFlow<String?>(null)
    val isApplying: StateFlow<String?> = _isApplying.asStateFlow()

    private val _verificationRunning = MutableStateFlow<String?>(null)
    val verificationRunning: StateFlow<String?> = _verificationRunning.asStateFlow()
    private val _verificationRuns = MutableStateFlow<Map<String, List<RemoteEditVerificationRun>>>(emptyMap())
    val verificationRuns: StateFlow<Map<String, List<RemoteEditVerificationRun>>> = _verificationRuns.asStateFlow()

    private val _gitPushRunning = MutableStateFlow<String?>(null)
    val gitPushRunning: StateFlow<String?> = _gitPushRunning.asStateFlow()

    private val _recoveryRuns = MutableStateFlow<Map<String, List<RemoteEditRecoveryRun>>>(emptyMap())
    val recoveryRuns: StateFlow<Map<String, List<RemoteEditRecoveryRun>>> = _recoveryRuns.asStateFlow()
    private val _rollbackRunning = MutableStateFlow<String?>(null)
    val rollbackRunning: StateFlow<String?> = _rollbackRunning.asStateFlow()

    private val _actionResults = MutableSharedFlow<RemoteEditActionResult>(extraBufferCapacity = 8)
    val actionResults: SharedFlow<RemoteEditActionResult> = _actionResults

    private val _investigationSettings = MutableStateFlow<RemoteEditInvestigationSettings?>(null)
    val investigationSettings: StateFlow<RemoteEditInvestigationSettings?> = _investigationSettings.asStateFlow()

    init {
        _isRefreshing.value = true
        WsRepository.sendLog("RemoteEditVM", "init: requesting reports")
        WsRepository.refreshReports()
        WsRepository.getBuildWorkspaceInfo()
        WsRepository.getInvestigationSettings()
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when (event) {
                    is WsEvent.RemoteEditReports -> {
                        WsRepository.sendLog("RemoteEditVM", "RemoteEditReports received: ${event.reports.size} reports")
                        _isRefreshing.value = false
                    }
                    is WsEvent.BuildWorkspaceInfo -> _workspaceInfo.value = event
                    is WsEvent.RemoteEditInvestigationSettingsLoaded -> {
                        _investigationSettings.value = event.settings
                    }
                    is WsEvent.RemoteEditReportDeleted -> {
                        _deletingReportId.value = null
                        _actionResults.tryEmit(
                            RemoteEditActionResult(
                                reportId = event.reportId,
                                success = event.deleted,
                                message = if (event.deleted) "Change request deleted" else (event.error ?: "Delete failed"),
                            ),
                        )
                    }
                    is WsEvent.RemoteEditApplyResult -> {
                        _isApplying.value = null
                        val success = event.error == null
                        _actionResults.tryEmit(
                            RemoteEditActionResult(
                                reportId = event.reportId,
                                success = success,
                                message = if (success) "Patch applied to workspace" else (event.error ?: "Apply failed"),
                            ),
                        )
                    }
                    is WsEvent.RemoteEditVerificationEvent -> {
                        _verificationRunning.value = event.reportId
                    }
                    is WsEvent.RemoteEditVerificationDone -> {
                        _verificationRunning.value = null
                        updateVerificationRuns(event.reportId) { runs ->
                            val run = RemoteEditVerificationRun(
                                runId = event.runId,
                                status = event.status,
                                error = event.error,
                            )
                            listOf(run) + runs.filter { it.runId != event.runId }
                        }
                        _actionResults.tryEmit(
                            RemoteEditActionResult(
                                reportId = event.reportId,
                                success = event.status == "success",
                                message = if (event.status == "success") "Verification passed" else (event.error ?: "Verification failed"),
                            ),
                        )
                    }
                    is WsEvent.RemoteEditGitEvent -> {
                        if (event.type == "push") {
                            _gitPushRunning.value = null
                            _actionResults.tryEmit(
                                RemoteEditActionResult(
                                    reportId = event.reportId,
                                    success = event.error == null,
                                    message = event.error ?: event.label,
                                ),
                            )
                        }
                    }
                    is WsEvent.RemoteEditRecoveryEvent -> {
                        if (event.type == "rollback") {
                            _rollbackRunning.value = null
                        }
                        val run = RemoteEditRecoveryRun(
                            recoveryId = event.recoveryId ?: "",
                            status = event.status ?: event.type,
                            error = event.error,
                        )
                        updateRecoveryRuns(event.reportId) { runs ->
                            listOf(run) + runs.filter { it.recoveryId != run.recoveryId }
                        }
                        if (event.type == "rollback") {
                            _actionResults.tryEmit(
                                RemoteEditActionResult(
                                    reportId = event.reportId,
                                    success = event.error == null,
                                    message = event.error ?: event.label,
                                ),
                            )
                        }
                    }
                    else -> {}
                }
            }
        }
    }

    private fun updateVerificationRuns(
        reportId: String,
        transform: (List<RemoteEditVerificationRun>) -> List<RemoteEditVerificationRun>,
    ) {
        _verificationRuns.value = _verificationRuns.value + (reportId to transform(_verificationRuns.value[reportId] ?: emptyList()))
    }

    private fun updateRecoveryRuns(
        reportId: String,
        transform: (List<RemoteEditRecoveryRun>) -> List<RemoteEditRecoveryRun>,
    ) {
        _recoveryRuns.value = _recoveryRuns.value + (reportId to transform(_recoveryRuns.value[reportId] ?: emptyList()))
    }

    fun refresh() {
        _isRefreshing.value = true
        WsRepository.sendLog("RemoteEditVM", "refresh: requesting reports")
        WsRepository.refreshReports()
        WsRepository.getBuildWorkspaceInfo()
    }

    fun deleteReport(reportId: String) {
        _deletingReportId.value = reportId
        WsRepository.deleteRemoteEditReport(reportId)
    }

    fun applyPatch(reportId: String) {
        _isApplying.value = reportId
        WsRepository.applyStagedPatch(reportId)
    }

    fun startVerification(reportId: String) {
        _verificationRunning.value = reportId
        WsRepository.startVerification(reportId)
    }

    fun pushFix(reportId: String) {
        _gitPushRunning.value = reportId
        WsRepository.pushRemoteEditFix(reportId)
    }

    fun requestRollback(recoveryId: String) {
        _rollbackRunning.value = recoveryId
        WsRepository.requestRemoteEditRollback(recoveryId)
    }

    fun saveInvestigationSettings(settings: RemoteEditInvestigationSettings) {
        WsRepository.setInvestigationSettings(settings)
    }
}
