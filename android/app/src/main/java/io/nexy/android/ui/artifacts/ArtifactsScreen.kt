package io.nexy.android.ui.artifacts

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.filled.Difference
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.automirrored.filled.Article
import androidx.compose.material.icons.automirrored.filled.MenuBook
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
import androidx.compose.runtime.saveable.rememberSaveable
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
import io.nexy.android.data.model.ArtifactVersionSummary
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyDangerButton
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.NexySortSheet
import java.io.File
import java.text.DateFormat
import java.util.Date
import java.util.Locale

private enum class ArtifactExportAction { SHARE, DOWNLOAD }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArtifactsScreen(
    onBack: () -> Unit,
    onOpenMarkdown: (path: String) -> Unit = {},
    projectId: String? = null,
    initialArtifactId: String? = null,
    vm: ArtifactsViewModel = viewModel(),
) {
    val artifacts by vm.artifacts.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val selected by vm.selectedArtifact.collectAsStateWithLifecycle()
    val versions by vm.versions.collectAsStateWithLifecycle()
    val isLoading by vm.isLoading.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val exportPack by vm.exportPack.collectAsStateWithLifecycle()
    val exportError by vm.exportError.collectAsStateWithLifecycle()
    val exporting by vm.exporting.collectAsStateWithLifecycle()
    val deleting by vm.deleting.collectAsStateWithLifecycle()
    val deletingVersionId by vm.deletingVersionId.collectAsStateWithLifecycle()
    val deletingArtifactId by vm.deletingArtifactId.collectAsStateWithLifecycle()
    val listDeleteError by vm.listDeleteError.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var searchQuery by remember { mutableStateOf("") }
    var statusFilter by remember { mutableStateOf<String?>(null) }
    var sortOrder by remember { mutableStateOf(ArtifactSortOrder.TITLE_ASC) }
    var showSortSheet by remember { mutableStateOf(false) }
    var confirmDeleteArtifact by remember { mutableStateOf<ArtifactSummary?>(null) }
    var exportAction by remember { mutableStateOf<ArtifactExportAction?>(null) }
    var pendingDownloadFiles by remember { mutableStateOf<List<ArtifactExportFile>?>(null) }
    var pendingDownloadFolder by remember { mutableStateOf("artifact") }
    // NavHost can dispose and recreate this destination while the Markdown viewer is on top. Keep
    // the guard in the destination's saveable state, otherwise returning from the viewer would
    // immediately auto-open the same artifact again.
    var autoOpenedMarkdownArtifactId by rememberSaveable { mutableStateOf<String?>(null) }
    val downloadDirectoryPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { treeUri ->
        val files = pendingDownloadFiles
        if (treeUri != null && files != null) {
            val result = saveArtifactFilesToTree(context, treeUri, pendingDownloadFolder, files)
            Toast.makeText(
                context,
                if (result.isSuccess) "Artifact downloaded" else "Download failed: ${result.exceptionOrNull()?.message}",
                Toast.LENGTH_LONG,
            ).show()
        }
        pendingDownloadFiles = null
        exportAction = null
    }
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
    LaunchedEffect(selected?.id, selected?.kind, selected?.currentVersion?.id) {
        val artifact = selected ?: return@LaunchedEffect
        if (artifact.kind != "plan" || autoOpenedMarkdownArtifactId == artifact.id) return@LaunchedEffect
        val primaryFile = artifact.currentVersion?.files
            ?.firstOrNull { it.role == "primary" }
            ?: artifact.currentVersion?.files?.firstOrNull()
        val isMarkdown = primaryFile?.mediaType.equals("text/markdown", ignoreCase = true) ||
            primaryFile?.relativePath?.lowercase(Locale.ROOT)?.endsWith(".md") == true
        val path = primaryFile?.absolutePath
        if (isMarkdown && !path.isNullOrBlank()) {
            autoOpenedMarkdownArtifactId = artifact.id
            onOpenMarkdown(path)
        }
    }
    LifecycleResumeEffect(projectId) {
        vm.refresh(projectId)
        onPauseOrDispose {}
    }

    LaunchedEffect(exportPack) {
        val pack = exportPack ?: return@LaunchedEffect
        if (exportAction == ArtifactExportAction.DOWNLOAD) {
            pendingDownloadFiles = pack
            downloadDirectoryPicker.launch(null)
        } else {
            shareArtifactFiles(context, pack)
            exportAction = null
        }
        vm.clearExport()
    }

    // Without this, system/gesture back exits the whole Artifacts screen even while viewing a
    // single artifact's detail, instead of returning to the list first (mirrors the detail
    // screen's own `onBack = { vm.clearSelection() }` below).
    BackHandler(enabled = selected != null) { vm.clearSelection() }

    confirmDeleteArtifact?.let { artifact ->
        AlertDialog(
            onDismissRequest = { confirmDeleteArtifact = null },
            title = { Text("Delete artifact?") },
            text = { Text("This deletes all versions of ${artifactDisplayTitle(artifact.title, artifact.kind)}.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDeleteArtifact = null
                        vm.deleteArtifact(artifact.id)
                    },
                ) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDeleteArtifact = null }) { Text("Cancel") } },
        )
    }
    if (listDeleteError != null) {
        AlertDialog(
            onDismissRequest = { vm.dismissListDeleteError() },
            title = { Text("Delete failed") },
            text = { Text(listDeleteError!!) },
            confirmButton = { TextButton(onClick = { vm.dismissListDeleteError() }) { Text("OK") } },
        )
    }

    if (selected != null) {
        ArtifactDetailScreen(
            artifact = selected!!,
            versions = versions,
            exporting = exporting,
            deleting = deleting,
            deletingVersionId = deletingVersionId,
            exportError = exportError,
            onExport = { versionId ->
                exportAction = ArtifactExportAction.SHARE
                vm.exportVersion(versionId)
            },
            onDownload = { versionId ->
                val versionNumber = versions.firstOrNull { it.id == versionId }?.versionNumber
                    ?: selected?.currentVersion?.versionNumber
                pendingDownloadFolder = buildArtifactDownloadFolderName(
                    selected?.title.orEmpty(),
                    versionNumber,
                )
                exportAction = ArtifactExportAction.DOWNLOAD
                vm.exportVersion(versionId)
            },
            onDelete = { vm.deleteSelectedArtifact() },
            onDeleteVersion = { versionId -> vm.deleteVersion(versionId) },
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
                            Column {
                                ArtifactRow(
                                    artifact = artifact,
                                    deleting = deletingArtifactId == artifact.id,
                                    onClick = { vm.selectArtifact(artifact.id) },
                                    onDelete = { confirmDeleteArtifact = artifact },
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
}

private enum class ArtifactSortOrder { TITLE_ASC, TITLE_DESC, RECENTLY_UPDATED }

@Composable
private fun ArtifactRow(artifact: ArtifactSummary, deleting: Boolean, onClick: () -> Unit, onDelete: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(6.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                iconForArtifactKind(artifact.kind),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(16.dp),
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                artifactDisplayTitle(artifact.title, artifact.kind),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!artifact.description.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    artifact.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ArtifactStatusBadge(artifact.status)
            ArtifactKindBadge(artifact.kind)
        }
        if (deleting) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        } else {
            IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "Delete ${artifactDisplayTitle(artifact.title, artifact.kind)}",
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun iconForArtifactKind(kind: String) = when (kind) {
    "debrief" -> Icons.AutoMirrored.Filled.MenuBook
    "quiz" -> Icons.Default.Psychology
    else -> Icons.AutoMirrored.Filled.Article
}

private fun artifactKindLabel(kind: String) = when (kind) {
    "debrief" -> "Debrief"
    "quiz" -> "Quiz"
    else -> kind.replaceFirstChar { it.uppercase() }
}

/**
 * Debrief/quiz titles are generated as "Debrief: <chat name>" — the kind is already shown via
 * [ArtifactKindBadge], so strip that prefix here and show just the source chat's name. Other
 * artifact kinds (promoted from a chat message) keep a user-given title with no such prefix.
 */
private fun artifactDisplayTitle(title: String, kind: String): String {
    val prefix = "${artifactKindLabel(kind)}: "
    return title.removePrefix(prefix)
}

@Composable
private fun ArtifactKindBadge(kind: String) {
    NexyStatusBadge(
        label = artifactKindLabel(kind),
        containerColor = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    )
}

@Composable
private fun ArtifactStatusBadge(status: String) {
    NexyStatusBadge(
        label = status.replaceFirstChar { it.uppercase() },
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
    deletingVersionId: String?,
    exportError: String?,
    onExport: (versionId: String) -> Unit,
    onDownload: (versionId: String) -> Unit,
    onDelete: () -> Unit,
    onDeleteVersion: (versionId: String) -> Unit,
    onDismissExportError: () -> Unit,
    onBack: () -> Unit,
) {
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmDeleteVersion by remember { mutableStateOf<ArtifactVersionSummary?>(null) }
    var diffVersions by remember { mutableStateOf<Pair<ArtifactVersionSummary, ArtifactVersionSummary>?>(null) }
    diffVersions?.let { (newer, older) ->
        AlertDialog(
            onDismissRequest = { diffVersions = null },
            title = { Text("v${older.versionNumber} → v${newer.versionNumber}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Compares which files exist in each version, by file path only — it doesn't check whether a file's contents changed. Use it to spot files that were added or dropped between versions.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
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
    confirmDeleteVersion?.let { version ->
        AlertDialog(
            onDismissRequest = { confirmDeleteVersion = null },
            title = { Text("Delete version v${version.versionNumber}?") },
            text = { Text("This permanently removes v${version.versionNumber} and its files. Other versions are unaffected.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmDeleteVersion = null
                        onDeleteVersion(version.id)
                    },
                ) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDeleteVersion = null }) { Text("Cancel") } },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        artifactDisplayTitle(artifact.title, artifact.kind),
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                onBack = onBack,
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
                    onDownload = onDownload,
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

            if (versions.isNotEmpty()) {
                item {
                    VersionHistoryCard(
                        versions = versions,
                        kind = artifact.kind,
                        exporting = exporting,
                        deletingVersionId = deletingVersionId,
                        onCompare = { newer, older -> diffVersions = newer to older },
                        onExport = onExport,
                        onDeleteVersion = { version -> confirmDeleteVersion = version },
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
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(8.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        iconForArtifactKind(artifact.kind),
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(20.dp),
                    )
                }
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        artifactDisplayTitle(artifact.title, artifact.kind),
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
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            SelectionContainer {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    ArtifactMetaLine("Updated", formatArtifactTimestamp(artifact.updatedAt))
                    ArtifactMetaLine("Created", formatArtifactTimestamp(artifact.createdAt))
                }
            }
        }
    }
}

@Composable
private fun ArtifactMetaLine(label: String, value: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(0.3f),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(0.7f),
        )
    }
}

@Composable
private fun ArtifactActionsCard(
    currentVersionId: String?,
    exporting: Boolean,
    deleting: Boolean,
    onDownload: (versionId: String) -> Unit,
    onDelete: () -> Unit,
) {
    ArtifactDetailCard {
        Text("Actions", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        if (currentVersionId != null) {
            NexySecondaryButton(
                text = if (exporting) "Preparing download..." else "Download",
                onClick = { onDownload(currentVersionId) },
                enabled = !exporting && !deleting,
                modifier = Modifier.fillMaxWidth(),
                leadingIcon = Icons.Default.FileDownload,
            )
        }
        NexyDangerButton(
            text = if (deleting) "Deleting..." else "Delete artifact",
            onClick = onDelete,
            enabled = !deleting,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun VersionHistoryCard(
    versions: List<ArtifactVersionSummary>,
    kind: String,
    exporting: Boolean,
    deletingVersionId: String?,
    onCompare: (newer: ArtifactVersionSummary, older: ArtifactVersionSummary) -> Unit,
    onExport: (versionId: String) -> Unit,
    onDeleteVersion: (version: ArtifactVersionSummary) -> Unit,
) {
    val sortedVersions = versions.sortedByDescending { it.versionNumber }
    ArtifactDetailCard {
        Text(
            "Version history",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            "Compare shows which files changed by path between two versions, not their content. Each version can be exported or deleted individually.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column {
            sortedVersions.forEachIndexed { index, version ->
                val olderVersion = sortedVersions.getOrNull(index + 1)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "v${version.versionNumber} · ${artifactDisplayTitle(version.title, kind)}",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            "${version.files.size} file(s) · ${formatArtifactTimestamp(version.createdAt)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (olderVersion != null) {
                        IconButton(onClick = { onCompare(version, olderVersion) }, modifier = Modifier.size(36.dp)) {
                            Icon(
                                Icons.Default.Difference,
                                contentDescription = "Compare v${version.versionNumber} with v${olderVersion.versionNumber}",
                                modifier = Modifier.size(18.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    IconButton(onClick = { onExport(version.id) }, enabled = !exporting, modifier = Modifier.size(36.dp)) {
                        Icon(
                            Icons.Default.Share,
                            contentDescription = "Export version ${version.versionNumber}",
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (deletingVersionId == version.id) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        IconButton(
                            onClick = { onDeleteVersion(version) },
                            enabled = sortedVersions.size > 1 && deletingVersionId == null,
                            modifier = Modifier.size(36.dp),
                        ) {
                            Icon(
                                Icons.Default.Delete,
                                contentDescription = if (sortedVersions.size > 1) "Delete version ${version.versionNumber}" else "Can't delete the only version",
                                modifier = Modifier.size(18.dp),
                                tint = if (sortedVersions.size > 1) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                            )
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

private fun buildArtifactDownloadFolderName(title: String, versionNumber: Int?): String {
    val safeTitle = title
        .replace(Regex("""[<>:"/\\|?*\u0000-\u001f]"""), "-")
        .trim()
        .trimEnd('.')
        .take(80)
        .ifBlank { "artifact" }
    return if (versionNumber != null) "$safeTitle-v$versionNumber" else safeTitle
}

private fun saveArtifactFilesToTree(
    context: Context,
    treeUri: Uri,
    folderName: String,
    files: List<ArtifactExportFile>,
): Result<Unit> = runCatching {
    val resolver = context.contentResolver
    runCatching {
        resolver.takePersistableUriPermission(
            treeUri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
    }
    val rootId = DocumentsContract.getTreeDocumentId(treeUri)
    val rootUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootId)
    val artifactDirectory = findOrCreateTreeChild(
        context = context,
        treeUri = treeUri,
        parentUri = rootUri,
        displayName = folderName,
        mimeType = DocumentsContract.Document.MIME_TYPE_DIR,
    )

    files.forEach { file ->
        val segments = file.relativePath
            .replace('\\', '/')
            .split('/')
            .filter { it.isNotBlank() && it != "." && it != ".." }
        require(segments.isNotEmpty()) { "Artifact contains an invalid file path" }
        var parent = artifactDirectory
        segments.dropLast(1).forEach { segment ->
            parent = findOrCreateTreeChild(
                context = context,
                treeUri = treeUri,
                parentUri = parent,
                displayName = segment,
                mimeType = DocumentsContract.Document.MIME_TYPE_DIR,
            )
        }
        val destination = findOrCreateTreeChild(
            context = context,
            treeUri = treeUri,
            parentUri = parent,
            displayName = segments.last(),
            mimeType = file.mediaType.ifBlank { "application/octet-stream" },
        )
        resolver.openOutputStream(destination, "wt").use { output ->
            requireNotNull(output) { "Unable to open ${file.relativePath}" }
            output.write(Base64.decode(file.contentBase64, Base64.DEFAULT))
        }
    }
}

private fun findOrCreateTreeChild(
    context: Context,
    treeUri: Uri,
    parentUri: Uri,
    displayName: String,
    mimeType: String,
): Uri {
    val resolver = context.contentResolver
    val parentId = DocumentsContract.getDocumentId(parentUri)
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
    resolver.query(
        childrenUri,
        arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
        ),
        null,
        null,
        null,
    )?.use { cursor ->
        val idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
        val nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        val typeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
        while (cursor.moveToNext()) {
            if (cursor.getString(nameIndex) == displayName && cursor.getString(typeIndex) == mimeType) {
                return DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(idIndex))
            }
        }
    }
    return requireNotNull(DocumentsContract.createDocument(resolver, parentUri, mimeType, displayName)) {
        "Unable to create $displayName"
    }
}
