package io.nexy.android.ui.remoteedit

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.CODE_CHANGE_PHASE_GUIDANCE
import io.nexy.android.data.model.CODE_CHANGE_PHASE_LABELS
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.model.deriveCodeChangePhase
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyDiffContent
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.renderDiffHunks
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteEditReportDetailScreen(
    reportId: String,
    onBack: () -> Unit,
    vm: RemoteEditViewModel = viewModel(),
) {
    val reports by vm.errorReports.collectAsState()
    val report = reports.find { it.id == reportId }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var stagedFiles by remember { mutableStateOf<List<String>>(emptyList()) }
    var fixStatus by remember { mutableStateOf<String?>(null) }
    val expandedDiffs = remember { mutableStateMapOf<String, Boolean>() }
    val diffContents = remember { mutableStateMapOf<String, String?>() }
    var investigationRunning by remember { mutableStateOf(false) }
    var fixRunning by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var showRollbackDialog by remember { mutableStateOf(false) }

    val isApplying by vm.isApplying.collectAsState()
    val verificationRunning by vm.verificationRunning.collectAsState()
    val verificationRuns by vm.verificationRuns.collectAsState()
    val gitPushRunning by vm.gitPushRunning.collectAsState()
    val recoveryRuns by vm.recoveryRuns.collectAsState()
    val latestVerificationRun = verificationRuns[reportId]?.firstOrNull()
    val latestRecoveryRun = recoveryRuns[reportId]?.firstOrNull()

    LaunchedEffect(reportId) {
        WsRepository.listStagedFiles(reportId)
        WsRepository.events.collect { event ->
            when {
                event is WsEvent.RemoteEditInvestigationDone && event.reportId == reportId -> {
                    investigationRunning = false
                    vm.refresh()
                }
                event is WsEvent.RemoteEditFixDone && event.reportId == reportId -> {
                    fixRunning = false
                    stagedFiles = event.stagedFiles
                    fixStatus = event.status
                    vm.refresh()
                }
                event is WsEvent.RemoteEditStagedFiles && event.reportId == reportId -> {
                    stagedFiles = event.stagedFiles
                    fixStatus = event.fixStatus
                }
                event is WsEvent.RemoteEditStagedDiff && event.reportId == reportId -> {
                    diffContents[event.relativePath] = event.hunksJson?.let { renderDiffHunks(it) }
                }
                else -> {}
            }
        }
    }

    LaunchedEffect(Unit) {
        vm.actionResults.collect { result ->
            if (result.reportId == reportId || result.reportId.isBlank()) {
                scope.launch { snackbarHostState.showSnackbar(result.message) }
                if (result.reportId == reportId) vm.refresh()
            }
        }
    }

    if (showDeleteDialog) {
        NexyConfirmDialog(
            title = "Delete change request?",
            message = "\"${report?.title ?: "This request"}\" and all associated data will be permanently deleted.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                showDeleteDialog = false
                vm.deleteReport(reportId)
                onBack()
            },
            onDismiss = { showDeleteDialog = false },
        )
    }

    if (showRollbackDialog) {
        NexyConfirmDialog(
            title = "Roll back this change?",
            message = "This restores the workspace to its pre-heal state and cannot be undone.",
            confirmLabel = "Roll back",
            destructive = true,
            onConfirm = {
                showRollbackDialog = false
                latestRecoveryRun?.recoveryId?.takeIf { it.isNotBlank() }?.let { vm.requestRollback(it) }
            },
            onDismiss = { showRollbackDialog = false },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(report?.title ?: "Change request") },
                onBack = onBack,
                actions = {
                    IconButton(onClick = { showDeleteDialog = true }) {
                        Icon(Icons.Default.Delete, contentDescription = "Delete")
                    }
                },
            )
        },
    ) { padding ->
        if (report == null) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(
                    "Change request not found.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Status row
            val phase = deriveCodeChangePhase(
                report = report,
                verificationStatus = latestVerificationRun?.status,
                committed = false,
            )
            Text(
                "Phase: ${CODE_CHANGE_PHASE_LABELS.getValue(phase)}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                CODE_CHANGE_PHASE_GUIDANCE.getValue(phase),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // Description
            if (report.description.isNotBlank()) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Text(
                        text = report.description,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            // Root cause
            report.investigationRootCause?.takeIf { it.isNotBlank() }?.let { rootCause ->
                Text("Root Cause / Plan", style = MaterialTheme.typography.titleSmall)
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Text(
                        text = rootCause,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            // Investigation markdown
            report.investigationMarkdown?.takeIf { it.isNotBlank() }?.let { markdown ->
                Text("Investigation", style = MaterialTheme.typography.titleSmall)
                Text(
                    text = markdown,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Action buttons — investigate / fix
            if (report.status in listOf("open", "investigated") && report.fixStatus !in listOf("staged", "applied")) {
                if (report.status == "open" || report.status == "investigating") {
                    Button(
                        onClick = {
                            investigationRunning = true
                            WsRepository.startRemoteEditInvestigation(reportId)
                        },
                        enabled = !investigationRunning,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                        Text(if (investigationRunning) "Investigating…" else "Run Analysis")
                    }
                }
                if (report.status == "investigated" || report.investigationRootCause != null) {
                    Button(
                        onClick = {
                            fixRunning = true
                            WsRepository.startRemoteEditFix(reportId)
                        },
                        enabled = !fixRunning,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (fixRunning) "Generating patch…" else "Generate staged patch")
                    }
                }
            }

            // Per-file diff cards
            if (stagedFiles.isNotEmpty()) {
                Text("Staged patch", style = MaterialTheme.typography.titleSmall)
                stagedFiles.forEach { path ->
                    val expanded = expandedDiffs[path] == true
                    val diff = diffContents[path]
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                val nowExpanded = !expanded
                                expandedDiffs[path] = nowExpanded
                                if (nowExpanded && diff == null) {
                                    WsRepository.getStagedDiff(reportId, path)
                                }
                            },
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = path,
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.weight(1f),
                            )
                            Icon(
                                if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                                contentDescription = null,
                            )
                        }
                        AnimatedVisibility(
                            visible = expanded,
                            enter = expandVertically(),
                            exit = shrinkVertically(),
                        ) {
                            val content = diff
                            if (content == null) {
                                Text(
                                    "Loading diff…",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(12.dp),
                                )
                            } else {
                                NexyDiffContent(content)
                            }
                        }
                    }
                }

                if (report.fixStatus == "staged") {
                    Button(
                        onClick = { vm.applyPatch(reportId) },
                        enabled = isApplying == null,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (isApplying == reportId) "Applying…" else "Apply patch")
                    }
                }
            }

            // Verification
            if (report.fixStatus == "applied") {
                Text("Verification", style = MaterialTheme.typography.titleSmall)
                Button(
                    onClick = { vm.startVerification(reportId) },
                    enabled = verificationRunning == null,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (verificationRunning == reportId) "Verifying…" else "Run verification")
                }
                latestVerificationRun?.let { run ->
                    Text(
                        text = "Last run: ${run.status}${run.error?.let { " — $it" } ?: ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (run.status == "success") {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.error
                        },
                    )
                }

                if (latestVerificationRun?.status == "success") {
                    Text("Git", style = MaterialTheme.typography.titleSmall)
                    OutlinedButton(
                        onClick = { vm.pushFix(reportId) },
                        enabled = gitPushRunning == null,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (gitPushRunning == reportId) "Pushing…" else "Push")
                    }
                }

                // Recovery / rollback
                latestRecoveryRun?.let { run ->
                    Text("Recovery", style = MaterialTheme.typography.titleSmall)
                    Text(
                        text = "Status: ${run.status}${run.error?.let { " — $it" } ?: ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (run.status in listOf("reloading", "confirmed")) {
                        OutlinedButton(
                            onClick = { showRollbackDialog = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Roll back")
                        }
                    }
                }
            }
        }
    }
}

