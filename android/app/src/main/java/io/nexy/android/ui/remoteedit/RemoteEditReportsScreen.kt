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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyStatusBadge
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteEditReportsScreen(
    onBack: () -> Unit,
    onOpenReport: (String) -> Unit,
    vm: RemoteEditViewModel = viewModel(),
) {
    val reports by vm.errorReports.collectAsState()
    val isRefreshing by vm.isRefreshing.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    var statusFilter by remember { mutableStateOf<String?>(null) }
    val statusValues = remember(reports) { reports.map { it.status }.distinct().sorted() }
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
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Remote Edit") },
                onBack = onBack,
                subtitle = "Settings › Developer",
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { vm.refresh() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (reports.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    NexyEmptyState(
                        title = "No edit requests yet.",
                        detail = "Start a remote edit from chat to describe a change or fix.",
                        action = {
                            TextButton(onClick = { vm.refresh() }) { Text("Refresh") }
                        },
                    )
                }
            } else {
                Column(modifier = Modifier.fillMaxSize()) {
                    NexySearchField(
                        query = searchQuery,
                        onQueryChange = { searchQuery = it },
                        placeholder = "Search reports",
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
                            title = "No matching reports.",
                            detail = "Try a different title, status, or root cause.",
                            modifier = Modifier.weight(1f),
                            action = { TextButton(onClick = { searchQuery = "" }) { Text("Clear search") } },
                        )
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            items(filteredReports, key = { it.id }) { report ->
                                ReportRow(report = report, onClick = { onOpenReport(report.id) })
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
private fun ReportRow(report: ErrorReport, onClick: () -> Unit) {
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
            StatusBadge(status = report.status)
        }
    }
}

@Composable
private fun StatusBadge(status: String) {
    val (label, color) = when (status) {
        "open" -> "Open" to Color(0xFFB00020)
        "investigating" -> "Investigating" to Color(0xFFE65100)
        "investigated" -> "Investigated" to Color(0xFF1565C0)
        "fixed" -> "Fixed" to Color(0xFF2E7D32)
        "rejected" -> "Rejected" to Color(0xFF616161)
        else -> status.replaceFirstChar { it.uppercase() } to Color(0xFF616161)
    }
    NexyStatusBadge(
        label = label,
        containerColor = color.copy(alpha = 0.15f),
        contentColor = color,
    )
}

private fun formatTimestamp(ms: Long): String {
    if (ms == 0L) return ""
    return SimpleDateFormat("MMM d, yyyy HH:mm", Locale.getDefault()).format(Date(ms))
}
