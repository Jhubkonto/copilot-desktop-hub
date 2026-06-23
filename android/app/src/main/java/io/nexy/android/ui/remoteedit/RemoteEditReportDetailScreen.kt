package io.nexy.android.ui.remoteedit

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar
import org.json.JSONArray

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

    var stagedFiles by remember { mutableStateOf<List<String>>(emptyList()) }
    var fixStatus by remember { mutableStateOf<String?>(null) }
    val expandedDiffs = remember { mutableStateMapOf<String, Boolean>() }
    val diffContents = remember { mutableStateMapOf<String, String?>() }
    var investigationRunning by remember { mutableStateOf(false) }
    var fixRunning by remember { mutableStateOf(false) }
    var commitRunning by remember { mutableStateOf(false) }
    var commitSha by remember { mutableStateOf<String?>(null) }
    var commitMessage by remember { mutableStateOf("") }
    var showCommitField by remember { mutableStateOf(false) }
    var rebuildStarted by remember { mutableStateOf(false) }

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
                    diffContents[event.relativePath] = event.hunksJson?.let { renderHunks(it) }
                }
                event is WsEvent.RemoteEditGitCommitResult && event.reportId == reportId -> {
                    commitRunning = false
                    if (event.error != null) {
                        snackbarHostState.showSnackbar("Commit failed: ${event.error}")
                    } else {
                        commitSha = event.sha
                        showCommitField = false
                        vm.refresh()
                    }
                }
                else -> {}
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(report?.title ?: "Report") },
                onBack = onBack,
            )
        },
    ) { padding ->
        if (report == null) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(
                    "Report not found.",
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
            Text(
                "Status: ${report.status}  ·  Fix: ${report.fixStatus}",
                style = MaterialTheme.typography.labelMedium,
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
                        Icon(Icons.Default.BugReport, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
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
                        Text(if (fixRunning) "Applying fix…" else "Apply AI Fix")
                    }
                }
            }

            // Per-file diff cards
            if (stagedFiles.isNotEmpty()) {
                Text("Staged Changes", style = MaterialTheme.typography.titleSmall)
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
                                DiffContent(content)
                            }
                        }
                    }
                }

                // Git commit section
                if (fixStatus == "staged" && commitSha == null) {
                    if (!showCommitField) {
                        Button(
                            onClick = { showCommitField = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("Commit Changes")
                        }
                    } else {
                        OutlinedTextField(
                            value = commitMessage,
                            onValueChange = { commitMessage = it },
                            label = { Text("Commit message") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(
                            onClick = {
                                if (commitMessage.isNotBlank() && !commitRunning) {
                                    commitRunning = true
                                    WsRepository.remoteEditGitCommit(reportId, commitMessage)
                                }
                            },
                            enabled = commitMessage.isNotBlank() && !commitRunning,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(if (commitRunning) "Committing…" else "Commit")
                        }
                    }
                }
            }

            // Rebuild now button — shown after successful commit
            commitSha?.let { sha ->
                Text(
                    "Committed: ${sha.take(8)}",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color(0xFF22C55E),
                )
                if (!rebuildStarted) {
                    OutlinedButton(
                        onClick = {
                            rebuildStarted = true
                            WsRepository.startDesktopBuild("build")
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.Build, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                        Text("Rebuild now")
                    }
                } else {
                    Text(
                        "Build started — check Build Dashboard for progress.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun DiffContent(diffText: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        diffText.lines().forEach { line ->
            val bg = when {
                line.startsWith("+") -> Color(0xFF22C55E).copy(alpha = 0.12f)
                line.startsWith("-") -> Color(0xFFEF4444).copy(alpha = 0.12f)
                line.startsWith("@@") -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.4f)
                else -> Color.Transparent
            }
            val textColor = when {
                line.startsWith("+") -> Color(0xFF22C55E)
                line.startsWith("-") -> Color(0xFFEF4444)
                line.startsWith("@@") -> MaterialTheme.colorScheme.onSecondaryContainer
                else -> MaterialTheme.colorScheme.onSurface
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(bg),
            ) {
                Text(
                    text = line,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = textColor,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }
    }
}

private fun renderHunks(hunksJson: String): String {
    return try {
        val hunks = JSONArray(hunksJson)
        buildString {
            for (i in 0 until hunks.length()) {
                val hunk = hunks.getJSONObject(i)
                val header = hunk.optString("header")
                if (header.isNotBlank()) appendLine(header)
                val lines = hunk.optJSONArray("lines")
                if (lines != null) {
                    for (j in 0 until lines.length()) {
                        val lineObj = lines.optJSONObject(j)
                        if (lineObj != null) {
                            val kind = lineObj.optString("kind", " ")
                            val content = lineObj.optString("content", "")
                            val prefix = when (kind) {
                                "add" -> "+"
                                "del" -> "-"
                                else -> " "
                            }
                            appendLine("$prefix$content")
                        } else {
                            appendLine(lines.optString(j, ""))
                        }
                    }
                }
            }
        }.trimEnd()
    } catch (_: Exception) {
        hunksJson
    }
}
