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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
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
    val selected by vm.selectedArtifact.collectAsState()
    val isLoading by vm.isLoading.collectAsState()
    val error by vm.error.collectAsState()
    val exportPack by vm.exportPack.collectAsState()
    val exportError by vm.exportError.collectAsState()
    val exporting by vm.exporting.collectAsState()
    val context = LocalContext.current
    var searchQuery by remember { mutableStateOf("") }
    val filteredArtifacts = remember(artifacts, searchQuery) {
        val query = searchQuery.trim()
        if (query.isBlank()) artifacts else artifacts.filter { artifact ->
            listOfNotNull(artifact.title, artifact.description, artifact.kind, artifact.status)
                .any { it.contains(query, ignoreCase = true) }
        }
    }

    LaunchedEffect(Unit) { vm.refresh(projectId) }

    LaunchedEffect(exportPack) {
        val pack = exportPack ?: return@LaunchedEffect
        shareArtifactFiles(context, pack)
        vm.clearExport()
    }

    if (selected != null) {
        ArtifactDetailScreen(
            artifact = selected!!,
            exporting = exporting,
            exportError = exportError,
            onExport = { versionId -> vm.exportVersion(versionId) },
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
                    IconButton(onClick = { vm.refresh(projectId) }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh artifacts")
                    }
                },
            )
        },
    ) { padding ->
        if (artifacts.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
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
            Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                NexySearchField(
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    placeholder = "Search artifacts",
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                if (filteredArtifacts.isEmpty()) {
                    NexyEmptyState(
                        title = "No matching artifacts.",
                        detail = "Try a different title, kind, or status.",
                        modifier = Modifier.weight(1f),
                        action = { TextButton(onClick = { searchQuery = "" }) { Text("Clear search") } },
                    )
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
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
    exporting: Boolean,
    exportError: String?,
    onExport: (versionId: String) -> Unit,
    onDismissExportError: () -> Unit,
    onBack: () -> Unit,
) {
    if (exportError != null) {
        AlertDialog(
            onDismissRequest = onDismissExportError,
            title = { Text("Export failed") },
            text = { Text(exportError) },
            confirmButton = { TextButton(onClick = onDismissExportError) { Text("OK") } },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(artifact.title, style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                actions = {
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
