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
import androidx.compose.foundation.layout.size
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.CODE_CHANGE_PHASE_GUIDANCE
import io.nexy.android.data.model.CODE_CHANGE_PHASE_LABELS
import io.nexy.android.data.model.CodeChangeRequestPhase
import io.nexy.android.data.model.RemoteEditInvestigationSettings
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.model.deriveCodeChangePhase
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyDiffContent
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.renderDiffHunks
import kotlinx.coroutines.launch

private val CODE_CHANGE_PHASE_ORDER = listOf(
    CodeChangeRequestPhase.DRAFT,
    CodeChangeRequestPhase.INVESTIGATING,
    CodeChangeRequestPhase.PATCH_READY,
    CodeChangeRequestPhase.APPLIED,
    CodeChangeRequestPhase.VERIFYING,
    CodeChangeRequestPhase.READY_TO_COMMIT,
    CodeChangeRequestPhase.COMMITTED,
)

@Composable
private fun PhaseStepper(
    phase: CodeChangeRequestPhase,
    onStepClick: (CodeChangeRequestPhase) -> Unit,
) {
    val currentIndex = if (phase == CodeChangeRequestPhase.NEEDS_ATTENTION) {
        CODE_CHANGE_PHASE_ORDER.indexOf(CodeChangeRequestPhase.VERIFYING)
    } else {
        CODE_CHANGE_PHASE_ORDER.indexOf(phase).coerceAtLeast(0)
    }
    val failed = phase == CodeChangeRequestPhase.NEEDS_ATTENTION

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        CODE_CHANGE_PHASE_ORDER.forEachIndexed { index, step ->
            val isFailedStep = failed && step == CodeChangeRequestPhase.VERIFYING
            val done = !isFailedStep && currentIndex > index
            val active = !isFailedStep && currentIndex == index
            val reached = done || active || isFailedStep
            val container = when {
                isFailedStep -> MaterialTheme.colorScheme.errorContainer
                done -> MaterialTheme.colorScheme.primaryContainer
                active -> MaterialTheme.colorScheme.secondaryContainer
                else -> MaterialTheme.colorScheme.surfaceVariant
            }
            val content = when {
                isFailedStep -> MaterialTheme.colorScheme.onErrorContainer
                done -> MaterialTheme.colorScheme.onPrimaryContainer
                active -> MaterialTheme.colorScheme.onSecondaryContainer
                else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            }
            Card(
                modifier = Modifier
                    .weight(1f)
                    .clickable(enabled = reached) { onStepClick(step) },
                colors = CardDefaults.cardColors(containerColor = container),
            ) {
                Text(
                    text = CODE_CHANGE_PHASE_LABELS.getValue(step),
                    style = MaterialTheme.typography.labelSmall,
                    color = content,
                    modifier = Modifier.padding(vertical = 6.dp, horizontal = 4.dp),
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun RevisePlanControl(
    running: Boolean,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onRevise: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    var notes by remember { mutableStateOf("") }

    if (open) {
        Column(
            modifier = modifier,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("What should the plan do differently?") },
                placeholder = { Text("e.g. Look in the android module instead") },
                modifier = Modifier.fillMaxWidth(),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = { onRevise(notes); open = false; notes = "" },
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Revise plan")
                }
                OutlinedButton(
                    onClick = { open = false; notes = "" },
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Cancel")
                }
            }
        }
        return
    }

    OutlinedButton(
        onClick = { open = true },
        enabled = enabled,
        modifier = modifier,
    ) {
        Text(if (running) "Revising…" else "Revise plan")
    }
}

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
    val scrollState = androidx.compose.foundation.rememberScrollState()
    val sectionOffsets = remember { mutableStateMapOf<CodeChangeRequestPhase, Int>() }

    fun scrollToPhase(phase: CodeChangeRequestPhase) {
        val offset = sectionOffsets[phase] ?: return
        scope.launch { scrollState.animateScrollTo(offset) }
    }

    var stagedFiles by remember { mutableStateOf<List<String>>(emptyList()) }
    var fixError by remember { mutableStateOf<String?>(null) }
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
                    fixError = event.error
                    vm.refresh()
                }
                event is WsEvent.RemoteEditStagedFiles && event.reportId == reportId -> {
                    stagedFiles = event.stagedFiles
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
            title = "Undo this change?",
            message = "This restores the affected files to their state before this change was applied. This cannot be undone.",
            confirmLabel = "Undo",
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
                .verticalScroll(scrollState)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Status row
            val phase = deriveCodeChangePhase(
                report = report,
                verificationStatus = latestVerificationRun?.status,
                committed = false,
            )
            PhaseStepper(phase = phase, onStepClick = ::scrollToPhase)
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

            val planFailed = report.investigationRootCause == "investigation_failed"
            // A plan that finished but hasn't been reviewed yet stays at status "investigating"
            // (see persistResult() in investigator.ts) — it is NOT still running in that case.
            val planAwaitingReview = report.status == "investigating" &&
                !report.investigationMarkdown.isNullOrBlank() && !investigationRunning
            val planHasNoAffectedFiles = planAwaitingReview && report.investigationAffectedFiles.isEmpty()

            Box(
                modifier = Modifier.onGloballyPositioned {
                    sectionOffsets[CodeChangeRequestPhase.INVESTIGATING] = it.positionInParent().y.toInt()
                },
            ) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Root cause
            report.investigationRootCause?.takeIf { it.isNotBlank() && !planFailed }?.let { rootCause ->
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

            // Planning failure
            if (planFailed) {
                Text("Planning failed", style = MaterialTheme.typography.titleSmall)
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Text(
                        text = report.investigationMarkdown
                            ?.substringAfter("# Planning failed\n\n", "")
                            ?.trim()
                            ?.ifBlank { "The plan could not be generated." }
                            ?: "The plan could not be generated.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            // Investigation markdown
            report.investigationMarkdown?.takeIf { it.isNotBlank() && !planFailed }?.let { markdown ->
                Text("Plan", style = MaterialTheme.typography.titleSmall)
                Text(
                    text = markdown,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (planAwaitingReview) {
                if (planHasNoAffectedFiles) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                "This plan didn't identify any files to change",
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                            Text(
                                "Generating a patch from this plan will fail. Revise it or reject it.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                    }
                }
                var reviewAction by remember(reportId) { mutableStateOf<String?>(null) }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = {
                                reviewAction = "accept"
                                WsRepository.setRemoteEditReportStatus(reportId, "investigated")
                            },
                            enabled = reviewAction == null && !planHasNoAffectedFiles,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(if (reviewAction == "accept") "Accepting…" else "Accept")
                        }
                        OutlinedButton(
                            onClick = {
                                reviewAction = "reject"
                                WsRepository.setRemoteEditReportStatus(reportId, "rejected")
                            },
                            enabled = reviewAction == null,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(if (reviewAction == "reject") "Rejecting…" else "Reject")
                        }
                    }
                    RevisePlanControl(
                        running = investigationRunning,
                        enabled = reviewAction == null,
                        modifier = Modifier.fillMaxWidth(),
                        onRevise = { notes ->
                            reviewAction = "revise"
                            investigationRunning = true
                            WsRepository.startRemoteEditInvestigation(reportId, notes)
                        },
                    )
                }
            }

            if (report.status == "rejected") {
                Text(
                    "Plan rejected.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            }
            }

            // Action buttons — investigate / fix
            if (report.status in listOf("open", "investigating", "investigated") && report.fixStatus !in listOf("staged", "applied")) {
                if ((report.status == "open" || report.status == "investigating") && !planAwaitingReview) {
                    // report.status == "investigating" with investigationRunning still false and no
                    // markdown yet means this request was already planning before this screen was
                    // opened (e.g. started, then the user navigated back and returned) — the backend
                    // call is still in flight either way.
                    val resumedInBackground = !investigationRunning && report.status == "investigating"
                    val isPlanning = investigationRunning || resumedInBackground
                    if (resumedInBackground) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                            Text(
                                "Planning is still running in the background.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (!isPlanning) {
                        val settings by vm.investigationSettings.collectAsState()
                        PlanningSettingsSection(
                            settings = settings,
                            onSave = { vm.saveInvestigationSettings(it) },
                        )
                    }
                    Button(
                        onClick = {
                            investigationRunning = true
                            WsRepository.startRemoteEditInvestigation(reportId)
                        },
                        enabled = !isPlanning,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                        Text(if (isPlanning) "Planning…" else if (report.investigationRootCause != null) "Retry" else "Plan change")
                    }
                }
                if (report.status == "investigated") {
                    if (report.fixStatus == "failed" && fixError != null) {
                        Text(
                            fixError ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    if (report.fixStatus == "failed") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            RevisePlanControl(
                                running = investigationRunning,
                                enabled = !fixRunning && !investigationRunning,
                                modifier = Modifier.fillMaxWidth(),
                                onRevise = { notes ->
                                    investigationRunning = true
                                    WsRepository.startRemoteEditInvestigation(reportId, notes)
                                },
                            )
                            Button(
                                onClick = {
                                    fixRunning = true
                                    WsRepository.startRemoteEditFix(reportId)
                                },
                                enabled = !fixRunning && !investigationRunning,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(if (fixRunning) "Generating…" else "Regenerate patch")
                            }
                        }
                    } else {
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
            }

            // Per-file diff cards
            if (stagedFiles.isNotEmpty()) {
                Box(
                    modifier = Modifier.onGloballyPositioned {
                        sectionOffsets[CodeChangeRequestPhase.PATCH_READY] = it.positionInParent().y.toInt()
                    },
                ) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
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
                }
            }

            // Verification
            if (report.fixStatus == "applied") {
                Box(
                    modifier = Modifier.onGloballyPositioned {
                        sectionOffsets[CodeChangeRequestPhase.APPLIED] = it.positionInParent().y.toInt()
                    },
                ) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
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

                if (latestVerificationRun?.status == "failed") {
                    RevisePlanControl(
                        running = investigationRunning,
                        enabled = !investigationRunning,
                        modifier = Modifier.fillMaxWidth(),
                        onRevise = { notes ->
                            investigationRunning = true
                            WsRepository.startRemoteEditInvestigation(reportId, notes)
                        },
                    )
                }

                // Undo
                latestRecoveryRun?.let { run ->
                    if (run.status == "rolled-back") {
                        Text("Undo", style = MaterialTheme.typography.titleSmall)
                        Text(
                            text = "Change undone. Files restored to their state before this change was applied.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else if (run.status in listOf("prepared", "reloading", "confirmed")) {
                        Text("Undo", style = MaterialTheme.typography.titleSmall)
                        OutlinedButton(
                            onClick = { showRollbackDialog = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Undo this change")
                        }
                    }
                }
                }
                }
            }
        }
    }
}

private val PLANNING_BACKENDS = listOf(
    "byok" to "BYOK",
    "claude-cli" to "Claude CLI",
    "codex-cli" to "Codex CLI",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlanningSettingsSection(
    settings: RemoteEditInvestigationSettings?,
    onSave: (RemoteEditInvestigationSettings) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    var backend by remember(settings) { mutableStateOf(settings?.backend ?: "byok") }
    var model by remember(settings) { mutableStateOf(settings?.model ?: "") }
    var retryLimit by remember(settings) { mutableStateOf((settings?.retryLimit ?: 1).toString()) }
    var autoApproveTools by remember(settings) { mutableStateOf(settings?.autoApproveTools ?: false) }
    var backendMenuExpanded by remember { mutableStateOf(false) }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Planning settings", style = MaterialTheme.typography.titleSmall)
                Icon(
                    if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                    contentDescription = if (expanded) "Collapse" else "Expand",
                )
            }
            if (expanded) {
                ExposedDropdownMenuBox(
                    expanded = backendMenuExpanded,
                    onExpandedChange = { backendMenuExpanded = it },
                ) {
                    OutlinedTextField(
                        value = PLANNING_BACKENDS.firstOrNull { it.first == backend }?.second ?: backend,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Backend") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = backendMenuExpanded) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                    )
                    ExposedDropdownMenu(
                        expanded = backendMenuExpanded,
                        onDismissRequest = { backendMenuExpanded = false },
                    ) {
                        PLANNING_BACKENDS.forEach { (value, label) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = { backend = value; backendMenuExpanded = false },
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = { Text("Model") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = retryLimit,
                    onValueChange = { retryLimit = it.filter(Char::isDigit) },
                    label = { Text("Retries") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { autoApproveTools = !autoApproveTools },
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Checkbox(checked = autoApproveTools, onCheckedChange = { autoApproveTools = it })
                    Text(
                        "Auto-approve planning tools",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
                OutlinedButton(
                    onClick = {
                        onSave(
                            RemoteEditInvestigationSettings(
                                backend = backend,
                                model = model,
                                retryLimit = retryLimit.toIntOrNull()?.coerceIn(0, 5) ?: 1,
                                autoApproveTools = autoApproveTools,
                            ),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Save settings")
                }
            }
        }
    }
}
