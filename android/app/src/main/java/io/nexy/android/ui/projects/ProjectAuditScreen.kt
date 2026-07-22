package io.nexy.android.ui.projects

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ProjectAuditFile
import io.nexy.android.data.model.ProjectAuditSession
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyDiffContent
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.renderDiffHunks
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ProjectAuditScreen(
    projectId: String,
    onBack: () -> Unit,
    vm: ProjectAuditViewModel = viewModel(),
) {
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val sessions by vm.sessions.collectAsStateWithLifecycle()
    val filesBySession by vm.filesBySession.collectAsStateWithLifecycle()
    val diffsByKey by vm.diffsByKey.collectAsStateWithLifecycle()
    val loadingSessions by vm.loadingSessions.collectAsStateWithLifecycle()
    val loadingFiles by vm.loadingFiles.collectAsStateWithLifecycle()
    val loadingDiffs by vm.loadingDiffs.collectAsStateWithLifecycle()
    val project = projects.find { it.id == projectId }

    val expandedSessions = remember { mutableStateMapOf<String, Boolean>() }
    val expandedFiles = remember { mutableStateMapOf<String, Boolean>() }

    LaunchedEffect(projectId) {
        vm.load(projectId)
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(project?.name?.let { "$it Changes" } ?: "Project Changes") },
                onBack = onBack,
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            NexyConnectionBanner(connectionState)

            if (loadingSessions) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
                return@Column
            }

            if (sessions.isEmpty()) {
                NexyEmptyState(
                    title = "No project changes recorded yet.",
                    detail = "Edits from chat tools, remote edit, and project-scoped file writes will appear here.",
                    modifier = Modifier.padding(top = 32.dp),
                )
                return@Column
            }

            sessions.forEach { session ->
                val sessionExpanded = expandedSessions[session.id] == true
                val sessionFiles = filesBySession[session.id]
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            val next = !sessionExpanded
                            expandedSessions[session.id] = next
                            if (next) vm.ensureFilesLoaded(session.id)
                        },
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Column(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    text = session.title.ifBlank { "Untitled session" },
                                    style = MaterialTheme.typography.titleSmall,
                                )
                                Text(
                                    text = "${sessionSourceLabel(session.source)} · ${formatAuditTime(session.updatedAt)} · ${session.fileCount} file${if (session.fileCount == 1) "" else "s"}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            androidx.compose.material3.Icon(
                                imageVector = if (sessionExpanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        if (sessionExpanded) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                when {
                                    loadingFiles.contains(session.id) -> {
                                        Text(
                                            "Loading files…",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    sessionFiles.isNullOrEmpty() -> {
                                        Text(
                                            "No files recorded for this session.",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    else -> {
                                        sessionFiles.forEach { file ->
                                            ProjectAuditFileCard(
                                                file = file,
                                                expanded = expandedFiles[vm.diffKey(session.id, file.relativePath)] == true,
                                                diffText = diffsByKey[vm.diffKey(session.id, file.relativePath)]?.hunksJson?.let(::renderDiffHunks),
                                                diffLoading = loadingDiffs.contains(vm.diffKey(session.id, file.relativePath)),
                                                onToggle = {
                                                    val key = vm.diffKey(session.id, file.relativePath)
                                                    val next = expandedFiles[key] != true
                                                    expandedFiles[key] = next
                                                    if (next && file.diffAvailable) {
                                                        vm.ensureDiffLoaded(session.id, file.relativePath)
                                                    }
                                                },
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectAuditFileCard(
    file: ProjectAuditFile,
    expanded: Boolean,
    diffText: String?,
    diffLoading: Boolean,
    onToggle: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, MaterialTheme.shapes.medium)
            .clickable(onClick = onToggle)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = file.relativePath,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
                Text(
                    text = "${file.lastOperation} · ${formatAuditTime(file.lastTouchedAt)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                FileStatusBadge(file.status)
                androidx.compose.material3.Icon(
                    imageVector = if (expanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (expanded) {
            when {
                !file.diffAvailable -> {
                    Text(
                        "Diff unavailable for this file.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                diffLoading && diffText == null -> {
                    Text(
                        "Loading diff…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                diffText != null -> {
                    NexyDiffContent(diffText = diffText)
                }
                else -> {
                    Text(
                        "No diff available.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun FileStatusBadge(status: String) {
    val (container, content) = when (status.lowercase(Locale.ROOT)) {
        "created" -> Color(0xFFDCFCE7) to Color(0xFF166534)
        "deleted" -> Color(0xFFFEE2E2) to Color(0xFF991B1B)
        else -> Color(0xFFDBEAFE) to Color(0xFF1D4ED8)
    }
    NexyStatusBadge(
        label = status.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() },
        containerColor = container,
        contentColor = content,
    )
}

private fun sessionSourceLabel(source: String): String = when (source) {
    "remote-edit" -> "Code Changes"
    "self-heal" -> "Legacy code repair"
    "manual-apply" -> "Manual apply"
    "chat-tool" -> "Chat tool"
    "cli-tool" -> "CLI tool"
    else -> source.ifBlank { "Unknown" }
}

private fun formatAuditTime(epochMs: Long): String {
    if (epochMs <= 0L) return "Unknown time"
    return SimpleDateFormat("MMM d, yyyy HH:mm", Locale.getDefault()).format(Date(epochMs))
}
