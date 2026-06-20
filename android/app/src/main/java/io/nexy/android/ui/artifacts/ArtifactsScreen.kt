package io.nexy.android.ui.artifacts

import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.ArtifactDetail2
import io.nexy.android.data.model.ArtifactExportFile
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.ArtifactVersionSummary
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.NexySortSheet
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArtifactsScreen(
    onBack: () -> Unit,
    projectId: String? = null,
    onOpenGenerator: (() -> Unit)? = null,
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
    var sortOrder by remember { mutableStateOf(ArtifactSortOrder.TITLE_ASC) }
    var showSortSheet by remember { mutableStateOf(false) }
    val filteredArtifacts = remember(artifacts, searchQuery, sortOrder) {
        val query = searchQuery.trim()
        artifacts
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
                    if (onOpenGenerator != null) {
                        TextButton(onClick = onOpenGenerator) { Text("Generate") }
                    }
                    if (artifacts.isNotEmpty()) {
                        IconButton(onClick = { showSortSheet = true }) {
                            Icon(Icons.Default.Sort, contentDescription = "Sort artifacts")
                        }
                    }
                    IconButton(onClick = { vm.refresh(projectId) }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh artifacts")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
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
                            detail = error ?: "Generated project artifacts will appear here.",
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
                if (searchQuery.isNotBlank()) {
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
                        action = { TextButton(onClick = { searchQuery = "" }) { Text("Clear search") } },
                    )
                } else {
                    LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        items(filteredArtifacts) { artifact ->
                            ArtifactRow(artifact = artifact, onClick = { vm.selectArtifact(artifact.id) })
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                ArtifactKindBadge(artifact.kind)
                ArtifactStatusBadge(artifact.status)
            }

            if (!artifact.description.isNullOrBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(artifact.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (!artifact.storageRoot.isNullOrBlank()) {
                Spacer(Modifier.height(8.dp))
                Text("Storage root", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(artifact.storageRoot, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
            }
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = onGenerateRevision,
                enabled = !revisioning && !deleting,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (revisioning) "Generating new version..." else "Generate new version")
            }
            if (revisioning) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            if (artifact.currentVersion == null) {
                Spacer(Modifier.height(16.dp))
                NexyEmptyState(
                    title = "No version available yet.",
                    detail = "Trigger artifact generation from the desktop to populate this artifact.",
                )
            }

            artifact.currentVersion?.let { version ->
                Spacer(Modifier.height(16.dp))
                Text("Version ${version.versionNumber}: ${version.title}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
                version.notes?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                if (version.files.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    Text("Files", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(4.dp))
                    version.files.forEach { file ->
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(file.relativePath, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
                            Text(file.role, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }

            if (versions.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                Text("Version history", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(8.dp))
                val sortedVersions = versions.sortedByDescending { it.versionNumber }
                sortedVersions.forEachIndexed { index, version ->
                    val olderVersion = sortedVersions.getOrNull(index + 1)
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("v${version.versionNumber} - ${version.title}", style = MaterialTheme.typography.bodyMedium)
                            version.notes?.takeIf { it.isNotBlank() }?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text("${version.files.size} file(s)", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (olderVersion != null) {
                            TextButton(onClick = { diffVersions = version to olderVersion }) {
                                Text("Compare")
                            }
                        }
                        IconButton(onClick = { onExport(version.id) }, enabled = !exporting) {
                            Icon(Icons.Default.Share, contentDescription = "Export version ${version.versionNumber}")
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

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
