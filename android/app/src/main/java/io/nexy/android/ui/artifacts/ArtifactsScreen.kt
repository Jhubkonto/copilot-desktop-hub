package io.nexy.android.ui.artifacts

import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Surface
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.ArtifactDetail2
import io.nexy.android.data.model.ArtifactExportFile
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.ArtifactVersionFile
import io.nexy.android.data.model.ArtifactVersionSummary
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyDangerButton
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.NexySortSheet
import java.io.File
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArtifactsScreen(
    onBack: () -> Unit,
    projectId: String? = null,
    initialArtifactId: String? = null,
    vm: ArtifactsViewModel = viewModel(),
) {
    val artifacts by vm.artifacts.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    val selected by vm.selectedArtifact.collectAsState()
    val versions by vm.versions.collectAsState()
    val isLoading by vm.isLoading.collectAsState()
    val error by vm.error.collectAsState()
    val exportPack by vm.exportPack.collectAsState()
    val exportError by vm.exportError.collectAsState()
    val exporting by vm.exporting.collectAsState()
    val deleting by vm.deleting.collectAsState()
    val revisioning by vm.revisioning.collectAsState()
    val context = LocalContext.current
    var searchQuery by remember { mutableStateOf("") }
    var statusFilter by remember { mutableStateOf<String?>(null) }
    var sortOrder by remember { mutableStateOf(ArtifactSortOrder.TITLE_ASC) }
    var showSortSheet by remember { mutableStateOf(false) }
    val statusOptions = remember(artifacts) { artifacts.map { it.status }.distinct().sorted() }
    val filteredArtifacts = remember(artifacts, searchQuery, statusFilter, sortOrder) {
        val query = searchQuery.trim()
        artifacts
            .let { list -> if (statusFilter != null) list.filter { it.status == statusFilter } else list }
            .let { list ->
                if (query.isBlank()) list else list.filter { artifact ->
                    listOfNotNull(artifact.title, artifact.description, artifact.kind, artifact.status)
                        .any { it.contains(query, ignoreCase = true) }
                }
            }
            .let { list ->
                when (sortOrder) {
                    ArtifactSortOrder.TITLE_ASC -> list.sortedBy { it.title.lowercase() }
                    ArtifactSortOrder.TITLE_DESC -> list.sortedByDescending { it.title.lowercase() }
                    ArtifactSortOrder.RECENTLY_UPDATED -> list.sortedByDescending { it.updatedAt }
                }
            }
    }

    if (showSortSheet) {
        NexySortSheet(
            options = listOf("Title A→Z", "Title Z→A", "Recently Updated"),
            selectedIndex = sortOrder.ordinal,
            onSelect = { sortOrder = ArtifactSortOrder.entries[it]; showSortSheet = false },
            onDismiss = { showSortSheet = false },
        )
    }

    LaunchedEffect(projectId) { vm.refresh(projectId) }
    LaunchedEffect(initialArtifactId, artifacts) {
        val artifactId = initialArtifactId?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        if (artifacts.any { it.id == artifactId } && selected?.id != artifactId) {
            vm.selectArtifact(artifactId)
        }
    }
    LifecycleResumeEffect(projectId) {
        vm.refresh(projectId)
        onPauseOrDispose {}
    }

    LaunchedEffect(exportPack) {
        val pack = exportPack ?: return@LaunchedEffect
        shareArtifactFiles(context, pack)
        vm.clearExport()
    }

    if (selected != null) {
        ArtifactDetailScreen(
            artifact = selected!!,
            versions = versions,
            exporting = exporting,
            deleting = deleting,
            revisioning = revisioning,
            exportError = exportError,
            onExport = { versionId -> vm.exportVersion(versionId) },
            onDelete = { vm.deleteSelectedArtifact() },
            onGenerateRevision = { vm.generateNewVersion() },
            onDismissExportError = { vm.clearExport() },
            onBack = { vm.clearSelection() },
        )
        return
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Artifacts", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                actions = {
                    if (artifacts.isNotEmpty()) {
                        IconButton(onClick = { showSortSheet = true }) {
                            Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = "Sort artifacts")
                        }
                    }
                    IconButton(onClick = { vm.refresh(projectId) }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh artifacts")
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isLoading,
            onRefresh = { vm.refresh(projectId) },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
        Column(modifier = Modifier.fillMaxSize()) {
            NexyConnectionBanner(connectionState)
            if (artifacts.isEmpty()) {
                Column(
                    modifier = Modifier.weight(1f).fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    if (isLoading) {
                        CircularProgressIndicator()
                    } else {
                        NexyEmptyState(
                            title = if (error != null) "Connection error" else "No artifacts yet.",
                            detail = error ?: "Saved and generated artifacts will appear here.",
                            action = {
                                TextButton(onClick = { vm.refresh(projectId) }) { Text("Retry") }
                            },
                        )
                    }
                }
            } else {
                NexySearchField(
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    placeholder = "Search artifacts",
                    debounceMs = 300L,
                )
                if (statusOptions.size > 1) {
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
                        items(statusOptions) { status ->
                            FilterChip(
                                selected = statusFilter == status,
                                onClick = { statusFilter = if (statusFilter == status) null else status },
                                label = { Text(status.replaceFirstChar { it.uppercase() }) },
                            )
                        }
                    }
                }
                if (searchQuery.isNotBlank() || statusFilter != null) {
                    Text(
                        "Showing ${filteredArtifacts.size} of ${artifacts.size}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                if (filteredArtifacts.isEmpty()) {
                    NexyEmptyState(
                        title = "No matching artifacts.",
                        detail = "Try a different title, kind, or status.",
                        modifier = Modifier.weight(1f),
                        action = { TextButton(onClick = { searchQuery = ""; statusFilter = null }) { Text("Clear filters") } },
                    )
                } else {
                    LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        items(filteredArtifacts, key = { it.id }) { artifact ->
                            Column(modifier = Modifier.animateItem()) {
                                ArtifactRow(artifact = artifact, onClick = { vm.selectArtifact(artifact.id) })
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                        }
                    }
                }
            }
        }
        }
    }
}

private enum class ArtifactSortOrder { TITLE_ASC, TITLE_DESC, RECENTLY_UPDATED }

@Composable
private fun ArtifactRow(artifact: ArtifactSummary, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(artifact.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                ArtifactKindBadge(artifact.kind)
            }
            if (!artifact.description.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(artifact.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        ArtifactStatusBadge(artifact.status)
    }
}

@Composable
private fun ArtifactKindBadge(kind: String) {
    NexyStatusBadge(
        label = kind,
        containerColor = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    )
}

@Composable
private fun ArtifactStatusBadge(status: String) {
    NexyStatusBadge(
        label = status,
        containerColor = when (status) {
            "ready" -> MaterialTheme.colorScheme.primaryContainer
            "generating" -> MaterialTheme.colorScheme.tertiaryContainer
            else -> MaterialTheme.colorScheme.surfaceVariant
        },
        contentColor = when (status) {
            "ready" -> MaterialTheme.colorScheme.onPrimaryContainer
            "generating" -> MaterialTheme.colorScheme.onTertiaryContainer
            else -> MaterialTheme.colorScheme.onSurfaceVariant
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ArtifactDetailScreen(
    artifact: ArtifactDetail2,
    versions: List<ArtifactVersionSummary>,
    exporting: Boolean,
    deleting: Boolean,
    revisioning: Boolean,
    exportError: String?,
    onExport: (versionId: String) -> Unit,
    onDelete: () -> Unit,
    onGenerateRevision: () -> Unit,
    onDismissExportError: () -> Unit,
    onBack: () -> Unit,
) {
    var confirmDelete by remember { mutableStateOf(false) }
    var diffVersions by remember { mutableStateOf<Pair<ArtifactVersionSummary, ArtifactVersionSummary>?>(null) }
    diffVersions?.let { (newer, older) ->
        AlertDialog(
            onDismissRequest = { diffVersions = null },
            title = { Text("v${older.versionNumber} → v${newer.versionNumber}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val olderPaths = older.files.map { it.relativePath }.toSet()
                    val newerPaths = newer.files.map { it.relativePath }.toSet()
                    val added = newerPaths - olderPaths
                    val removed = olderPaths - newerPaths
                    val unchanged = newerPaths intersect olderPaths
                    if (added.isNotEmpty()) {
                        Text("Added", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        added.sorted().forEach { path ->
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = MaterialTheme.colorScheme.secondaryContainer,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("+ $path", style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, modifier = Modifier.padding(6.dp))
                            }
                        }
                    }
                    if (removed.isNotEmpty()) {
                        Text("Removed", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
                        removed.sorted().forEach { path ->
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = MaterialTheme.colorScheme.errorContainer,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("- $path", style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, modifier = Modifier.padding(6.dp))
                            }
                        }
                    }
                    if (added.isEmpty() && removed.isEmpty()) {
                        Text("${unchanged.size} file(s) unchanged — no structural differences.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { diffVersions = null }) { Text("Close") } },
        )
    }

    if (exportError != null) {
        AlertDialog(
            onDismissRequest = onDismissExportError,
            title = { Text("Export failed") },
            text = { Text(exportError) },
            confirmButton = { TextButton(onClick = onDismissExportError) { Text("OK") } },
        )
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete artifact?") },
            text = { Text("This deletes all versions of ${artifact.title}.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDelete = false
                        onDelete()
                    },
                ) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(artifact.title, style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                actions = {
                    IconButton(onClick = { confirmDelete = true }, enabled = !deleting) {
                        Icon(Icons.Default.Delete, contentDescription = "Delete artifact")
                    }
                    val versionId = artifact.currentVersionId
                    if (versionId != null) {
                        if (exporting) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp).padding(end = 4.dp), strokeWidth = 2.dp)
                        } else {
                            IconButton(onClick = { onExport(versionId) }) {
                                Icon(Icons.Default.Share, contentDescription = "Export artifact")
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { ArtifactHeroCard(artifact) }
            item {
                ArtifactActionsCard(
                    currentVersionId = artifact.currentVersionId,
                    exporting = exporting,
                    deleting = deleting,
                    revisioning = revisioning,
                    onExport = onExport,
                    onGenerateRevision = onGenerateRevision,
                    onDelete = { confirmDelete = true },
                )
            }

            if (artifact.currentVersion == null) {
                item {
                    ArtifactDetailCard {
                        NexyEmptyState(
                            title = "No version available yet.",
                            detail = "Trigger artifact generation from the desktop to populate this artifact.",
                        )
                    }
                }
            }

            artifact.currentVersion?.let { version ->
                item { CurrentVersionCard(version = version, exporting = exporting, onExport = onExport) }
            }

            if (versions.isNotEmpty()) {
                item {
                    VersionHistoryCard(
                        versions = versions,
                        exporting = exporting,
                        onCompare = { newer, older -> diffVersions = newer to older },
                        onExport = onExport,
                    )
                }
            }

            item { Spacer(modifier = Modifier.height(18.dp)) }
        }
    }
}

@Composable
private fun ArtifactDetailCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
private fun ArtifactHeroCard(artifact: ArtifactDetail2) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.24f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.25f)),
    ) {
        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(
                    Icons.Default.Inventory2,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(22.dp),
                )
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        artifact.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        if (artifact.projectId != null) "Project artifact" else "Global artifact",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                artifact.currentVersion?.let {
                    NexyStatusBadge(
                        label = "v${it.versionNumber}",
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                ArtifactKindBadge(artifact.kind)
                ArtifactStatusBadge(artifact.status)
            }

            if (!artifact.description.isNullOrBlank()) {
                Text(
                    artifact.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                ArtifactMetaLine("Updated", formatArtifactTimestamp(artifact.updatedAt))
                ArtifactMetaLine("Created", formatArtifactTimestamp(artifact.createdAt))
                if (!artifact.storageRoot.isNullOrBlank()) {
                    ArtifactMetaLine("Storage", artifact.storageRoot, monospace = true)
                }
            }
        }
    }
}

@Composable
private fun ArtifactMetaLine(label: String, value: String, monospace: Boolean = false) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Text(
            "$label:",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SelectionContainer(modifier = Modifier.weight(1f)) {
            Text(
                value,
                style = if (monospace) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace) else MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ArtifactActionsCard(
    currentVersionId: String?,
    exporting: Boolean,
    deleting: Boolean,
    revisioning: Boolean,
    onExport: (versionId: String) -> Unit,
    onGenerateRevision: () -> Unit,
    onDelete: () -> Unit,
) {
    ArtifactDetailCard {
        Text("Actions", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        NexyPrimaryButton(
            text = if (revisioning) "Generating new version..." else "Generate new version",
            onClick = onGenerateRevision,
            enabled = !revisioning && !deleting,
            modifier = Modifier.fillMaxWidth(),
        )
        if (revisioning) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
        if (currentVersionId != null) {
            NexySecondaryButton(
                text = if (exporting) "Exporting..." else "Export current version",
                onClick = { onExport(currentVersionId) },
                enabled = !exporting && !deleting,
                modifier = Modifier.fillMaxWidth(),
                leadingIcon = Icons.Default.Share,
            )
        }
        NexyDangerButton(
            text = if (deleting) "Deleting..." else "Delete artifact",
            onClick = onDelete,
            enabled = !deleting && !revisioning,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun CurrentVersionCard(
    version: ArtifactVersionSummary,
    exporting: Boolean,
    onExport: (versionId: String) -> Unit,
) {
    ArtifactDetailCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "Current version",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            NexyStatusBadge(
                label = "v${version.versionNumber}",
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
        Text(version.title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
        version.notes?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text("Created ${formatArtifactTimestamp(version.createdAt)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (version.files.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Files", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                version.files.forEach { file -> ArtifactFileRow(file) }
            }
        }
        NexySecondaryButton(
            text = if (exporting) "Exporting..." else "Export version",
            onClick = { onExport(version.id) },
            enabled = !exporting,
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = Icons.Default.Share,
        )
    }
}

@Composable
private fun ArtifactFileRow(file: ArtifactVersionFile) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SelectionContainer(modifier = Modifier.weight(1f)) {
                Text(
                    file.relativePath,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            NexyStatusBadge(
                label = file.role,
                containerColor = MaterialTheme.colorScheme.secondaryContainer,
                contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
            )
        }
    }
}

@Composable
private fun VersionHistoryCard(
    versions: List<ArtifactVersionSummary>,
    exporting: Boolean,
    onCompare: (newer: ArtifactVersionSummary, older: ArtifactVersionSummary) -> Unit,
    onExport: (versionId: String) -> Unit,
) {
    val sortedVersions = versions.sortedByDescending { it.versionNumber }
    ArtifactDetailCard {
        Text("Version history", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        sortedVersions.forEachIndexed { index, version ->
            val olderVersion = sortedVersions.getOrNull(index + 1)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("v${version.versionNumber} · ${version.title}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        version.notes?.takeIf { it.isNotBlank() }?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(
                            "${version.files.size} file(s) · ${formatArtifactTimestamp(version.createdAt)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        if (olderVersion != null) {
                            NexyGhostButton(text = "Compare", onClick = { onCompare(version, olderVersion) })
                        }
                        IconButton(onClick = { onExport(version.id) }, enabled = !exporting) {
                            Icon(Icons.Default.Share, contentDescription = "Export version ${version.versionNumber}")
                        }
                    }
                }
                if (index < sortedVersions.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

private fun formatArtifactTimestamp(timestamp: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(timestamp))

private fun shareArtifactFiles(context: Context, files: List<ArtifactExportFile>) {
    val cacheDir = File(context.cacheDir, "artifact-export").also { it.mkdirs() }
    val uris = files.map { f ->
        val name = f.relativePath.substringAfterLast('/')
        val dest = File(cacheDir, name)
        dest.writeBytes(Base64.decode(f.contentBase64, Base64.DEFAULT))
        FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", dest)
    }
    val intent = if (uris.size == 1) {
        Intent(Intent.ACTION_SEND).apply {
            type = files.first().mediaType.ifBlank { "*/*" }
            putExtra(Intent.EXTRA_STREAM, uris.first())
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    } else {
        Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "*/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
    context.startActivity(Intent.createChooser(intent, "Export artifact"))
}
