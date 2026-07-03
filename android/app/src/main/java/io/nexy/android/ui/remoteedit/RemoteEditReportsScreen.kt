package io.nexy.android.ui.remoteedit

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.CODE_CHANGE_PHASE_LABELS
import io.nexy.android.data.model.CodeChangeRequestPhase
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.deriveCodeChangePhase
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyStatusBadge
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteEditReportsScreen(
    onBack: () -> Unit,
    onOpenReport: (String) -> Unit,
    onNewRequest: () -> Unit,
    vm: RemoteEditViewModel = viewModel(),
) {
    val reports by vm.errorReports.collectAsState()
    val isRefreshing by vm.isRefreshing.collectAsState()
    val workspaceInfo by vm.workspaceInfo.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    var statusFilter by remember { mutableStateOf<String?>(null) }
    var pendingDeleteReport by remember { mutableStateOf<ErrorReport?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val statusValues = remember(reports) { reports.map { it.status }.distinct().sorted() }

    LaunchedEffect(Unit) {
        vm.actionResults.collect { result ->
            scope.launch { snackbarHostState.showSnackbar(result.message) }
        }
    }

    pendingDeleteReport?.let { report ->
        NexyConfirmDialog(
            title = "Delete change request?",
            message = "\"${report.title}\" and all associated data will be permanently deleted.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                vm.deleteReport(report.id)
                pendingDeleteReport = null
            },
            onDismiss = { pendingDeleteReport = null },
        )
    }
    val filteredReports = remember(reports, searchQuery, statusFilter) {
        val query = searchQuery.trim()
        reports
            .let { list -> if (statusFilter != null) list.filter { it.status == statusFilter } else list }
            .let { list ->
                if (query.isBlank()) list else list.filter { report ->
                    listOfNotNull(
                        report.title,
                        report.description,
                        report.status,
                        report.fixStatus,
                        report.investigationRootCause,
                    ).any { it.contains(query, ignoreCase = true) }
                }
            }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Code Changes") },
                onBack = onBack,
                actions = {
                    IconButton(onClick = onNewRequest) {
                        Icon(Icons.Default.Add, contentDescription = "New request")
                    }
                },
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { vm.refresh() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (reports.isEmpty()) {
                Column(modifier = Modifier.fillMaxSize()) {
                    WorkspaceSummary(workspaceInfo)
                    Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        NexyEmptyState(
                            title = "No edit requests yet.",
                            detail = "Create a code change from chat or the desktop Code Changes screen.",
                            action = {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TextButton(onClick = onNewRequest) { Text("New request") }
                                    TextButton(onClick = { vm.refresh() }) { Text("Refresh") }
                                }
                            },
                        )
                    }
                }
            } else {
                Column(modifier = Modifier.fillMaxSize()) {
                    WorkspaceSummary(workspaceInfo)
                    NexySearchField(
                        query = searchQuery,
                        onQueryChange = { searchQuery = it },
                        placeholder = "Search change requests",
                    )
                    if (statusValues.size > 1) {
                        LazyRow(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            item {
                                FilterChip(
                                    selected = statusFilter == null,
                                    onClick = { statusFilter = null },
                                    label = { Text("All") },
                                )
                            }
                            items(statusValues) { status ->
                                FilterChip(
                                    selected = statusFilter == status,
                                    onClick = { statusFilter = if (statusFilter == status) null else status },
                                    label = { Text(status.replaceFirstChar { it.uppercase() }) },
                                )
                            }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    if (filteredReports.isEmpty()) {
                        NexyEmptyState(
                            title = "No matching requests.",
                            detail = "Try a different title, status, or root cause.",
                            modifier = Modifier.weight(1f),
                            action = { TextButton(onClick = { searchQuery = "" }) { Text("Clear search") } },
                        )
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            items(filteredReports, key = { it.id }) { report ->
                                ReportRow(
                                    report = report,
                                    onClick = { onOpenReport(report.id) },
                                    onDelete = { pendingDeleteReport = report },
                                )
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkspaceSummary(workspace: io.nexy.android.data.model.WsEvent.BuildWorkspaceInfo?) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = if (workspace?.path.isNullOrBlank()) "No desktop workspace connected" else "Connected desktop workspace",
                style = MaterialTheme.typography.labelMedium,
            )
            Text(
                text = workspace?.path?.takeIf { it.isNotBlank() }
                    ?: "Connect a workspace from Nexy desktop before creating a code change.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            workspace?.takeIf { it.path.isNotBlank() }?.let { info ->
                Text(
                    text = listOfNotNull(
                        if (info.isGitRepo) "Git repository" else "Folder workspace",
                        info.branch,
                        if (info.dirty) "Uncommitted changes" else null,
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (info.dirty) Color(0xFFE65100) else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ReportRow(report: ErrorReport, onClick: () -> Unit, onDelete: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = report.title,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = formatTimestamp(report.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            StatusBadge(phase = deriveCodeChangePhase(report))
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, contentDescription = "Delete ${report.title}")
            }
        }
    }
}

@Composable
private fun StatusBadge(phase: CodeChangeRequestPhase) {
    val color = when (phase) {
        CodeChangeRequestPhase.DRAFT -> Color(0xFF616161)
        CodeChangeRequestPhase.INVESTIGATING -> Color(0xFFE65100)
        CodeChangeRequestPhase.PATCH_READY, CodeChangeRequestPhase.READY_TO_APPLY -> Color(0xFF1565C0)
        CodeChangeRequestPhase.APPLIED, CodeChangeRequestPhase.READY_TO_COMMIT, CodeChangeRequestPhase.COMMITTED -> Color(0xFF2E7D32)
        CodeChangeRequestPhase.VERIFYING -> Color(0xFF1565C0)
        CodeChangeRequestPhase.NEEDS_ATTENTION -> Color(0xFFB00020)
    }
    NexyStatusBadge(
        label = CODE_CHANGE_PHASE_LABELS.getValue(phase),
        containerColor = color.copy(alpha = 0.15f),
        contentColor = color,
    )
}

private fun formatTimestamp(ms: Long): String {
    if (ms == 0L) return ""
    return SimpleDateFormat("MMM d, yyyy HH:mm", Locale.getDefault()).format(Date(ms))
}
