package io.nexy.android.ui.fileexplorer

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.FsEntry
import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.ProjectSource
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.fileviewer.isRemoteImagePath
import io.nexy.android.ui.projects.ProjectSourceAddResult
import io.nexy.android.ui.projects.ProjectSourceAddState
import io.nexy.android.ui.projects.projectSourceAddResult

/** Shows the tail of a long path (the part nearest the leaf), since that's what identifies
 *  "where am I" at a glance — the drive/home prefix is usually the least useful part. */
private fun String.displayTail(maxLength: Int = 40): String {
    if (length <= maxLength) return this
    return "…" + takeLast(maxLength - 1)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileExplorerScreen(
    onBack: () -> Unit,
    onFolderSelected: (String) -> Unit,
    projectId: String = "",
    onOpenProjectSettings: (() -> Unit)? = null,
    initialPath: String = "",
    allowFileSelection: Boolean = false,
    isAddingProjectSource: Boolean = false,
    // Pure content-consumption mode: browse folders and open Markdown to read, with no
    // "Select this folder" affordance — nothing is picked or returned to a caller.
    browseMode: Boolean = false,
    onMarkdownSelected: ((String) -> Unit)? = null,
    onImageSelected: ((String) -> Unit)? = null,
    vm: FileExplorerViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val lastError by WsRepository.lastError.collectAsStateWithLifecycle()
    var searchQuery by remember { mutableStateOf("") }
    var projectSourceAddState by remember { mutableStateOf<ProjectSourceAddState?>(null) }
    var projectSourceAddError by remember { mutableStateOf<String?>(null) }
    val projectScoped = browseMode && projectId.isNotBlank()
    var projectConfig by remember(projectId) { mutableStateOf<ProjectSettingsConfig?>(null) }

    // Project Files is rooted in the project's registered sources, not the desktop's generic
    // home/recents list. Keep the source list fresh when settings change elsewhere.
    LaunchedEffect(projectId, projectScoped) {
        if (!projectScoped) return@LaunchedEffect
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.ProjectConfig -> if (event.id == projectId) projectConfig = event.config
                is WsEvent.ProjectSourcesUpdated -> if (event.id == projectId) projectConfig = event.config
                is WsEvent.ProjectConfigChanged -> if (event.id == projectId) WsRepository.getProjectConfig(projectId)
                is WsEvent.ProjectConfigUpdated -> if (event.id == projectId) WsRepository.getProjectConfig(projectId)
                else -> Unit
            }
        }
    }

    LaunchedEffect(projectId, projectScoped) {
        if (projectScoped) WsRepository.getProjectConfig(projectId)
    }

    val projectLocations = projectConfig?.toFileLocations().orEmpty()

    // A single project source has no useful choice to present, so enter it directly. With two or
    // more sources, the source chooser below becomes the explorer's project-scoped first level.
    LaunchedEffect(projectConfig, projectScoped) {
        if (projectScoped && projectConfig != null && projectLocations.size == 1) {
            vm.openInitial(projectLocations.single().path)
        }
    }

    // Jump straight into the project's already-configured root directory (if any) instead of
    // showing the home/recents chooser first — falls back to the chooser only if that path
    // turns out not to exist (see FileExplorerViewModel.openInitial).
    LaunchedEffect(initialPath, projectScoped) {
        if (!projectScoped) vm.openInitial(initialPath)
    }

    // Keep the picker open until the desktop has persisted and acknowledged the new source. If we
    // pop immediately after sending the command, the settings screen can miss the one-shot WS
    // event and continue displaying its stale in-memory source list.
    LaunchedEffect(projectId, isAddingProjectSource) {
        if (!isAddingProjectSource || projectId.isBlank()) return@LaunchedEffect
        WsRepository.events.collect { event ->
            val state = projectSourceAddState ?: return@collect
            if (event is WsEvent.ProjectConfigChanged && event.id == projectId && event.config == null) {
                // The desktop broadcasts this event alongside the source reply. Fetching the
                // authoritative config here preserves compatibility with older desktops that do
                // not include the hierarchy in their config-changed broadcast.
                WsRepository.getProjectConfig(projectId)
                return@collect
            }
            when (val result = projectSourceAddResult(state, projectId, event)) {
                ProjectSourceAddResult.Added -> {
                    projectSourceAddState = null
                    // The settings destination may still be below this screen, or may be
                    // recreated after navigation. Leave a durable refresh marker for it rather
                    // than relying on its activity lifecycle receiving another ON_RESUME event.
                    WsRepository.pendingProjectSourceRefresh.value = projectId
                    onBack()
                }
                is ProjectSourceAddResult.Error -> {
                    projectSourceAddState = null
                    projectSourceAddError = result.message
                }
                ProjectSourceAddResult.Pending -> Unit
            }
        }
    }

    // `history` is a breadcrumb stack the user drills into via folder taps, with no NavGraph
    // route per level — without this, system/gesture back exits the whole screen from any depth
    // instead of going up one directory at a time the way the breadcrumb bar's own taps do.
    BackHandler(enabled = state.history.isNotEmpty()) { vm.navigateTo(state.history.size - 2) }

    Scaffold(
        topBar = {
            Column {
                NexyTopAppBar(
                    titleContent = {
                        Text(
                            when {
                                allowFileSelection -> "Attach from desktop"
                                isAddingProjectSource -> "Add project folder"
                                browseMode -> "Project files"
                                else -> "Choose folder"
                            },
                        )
                    },
                    onBack = onBack,
                )
                NexyConnectionBanner(connectionState, lastError)
            }
        },
        bottomBar = {
            val currentPath = state.currentPath
            if (currentPath != null && !browseMode) {
                Surface(tonalElevation = 3.dp) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            currentPath.displayTail(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Button(
                            enabled = projectSourceAddState == null,
                            onClick = {
                                if (isAddingProjectSource) {
                                    projectSourceAddState = ProjectSourceAddState.inFlight(currentPath)
                                    projectSourceAddError = null
                                }
                                onFolderSelected(currentPath)
                            },
                        ) {
                            Text(
                                when {
                                    allowFileSelection -> "Attach folder"
                                    isAddingProjectSource -> "Add folder"
                                    else -> "Select this folder"
                                },
                            )
                        }
                    }
                }
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            projectSourceAddError?.let { message ->
                Text(
                    message,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            if (state.history.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val canGoUp = state.currentPath?.parentPath() != null
                    TextButton(
                        onClick = { vm.goUpOneLevel() },
                        enabled = canGoUp,
                    ) {
                        NexyIcon(NexyIconName.ChevronUp, contentDescription = "Go up one level")
                    }
                    TextButton(onClick = { vm.navigateTo(-1) }) {
                        NexyIcon(NexyIconName.Home, contentDescription = "Root")
                    }
                    state.history.forEachIndexed { index, path ->
                        NexyIcon(
                            NexyIconName.ChevronRight,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        val name = path.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\').ifBlank { path }
                        TextButton(onClick = { vm.navigateTo(index) }) {
                            Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                HorizontalDivider()
                NexySearchField(
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    placeholder = "Search files…",
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                )
                HorizontalDivider()
            }

            when {
                projectScoped && projectConfig == null -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    NexyIcon(
                        NexyIconName.Busy,
                        contentDescription = "Loading project folders",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                state.loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    NexyIcon(
                        NexyIconName.Busy,
                        contentDescription = "Loading files",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                state.error != null -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(state.error.orEmpty(), color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = { vm.retry() }) { Text("Retry") }
                    }
                }
                state.history.isEmpty() && projectScoped && projectLocations.isEmpty() -> ProjectFilesEmptyState(
                    onOpenSettings = onOpenProjectSettings,
                )
                state.history.isEmpty() && projectScoped -> ProjectSourceChooser(
                    locations = projectLocations,
                    onOpen = vm::open,
                )
                state.history.isEmpty() -> RootChooser(home = state.home, recents = state.recents, onOpen = vm::open)
                state.entries.isEmpty() -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("This folder is empty", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                else -> {
                    val filtered = if (searchQuery.isBlank()) {
                        state.entries
                    } else {
                        state.entries.filter { it.name.contains(searchQuery, ignoreCase = true) }
                    }
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        if (state.truncated && searchQuery.isBlank()) {
                            item {
                                Surface(color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.fillMaxWidth()) {
                                    Text(
                                        "Showing the first 2000 items in this folder — narrow your search by opening a subfolder or using the search bar.",
                                        style = MaterialTheme.typography.bodySmall,
                                        modifier = Modifier.padding(12.dp),
                                    )
                                }
                            }
                        }
                        if (filtered.isEmpty() && searchQuery.isNotBlank()) {
                            item {
                                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Text("No files match \"$searchQuery\"", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        } else {
                            items(filtered) { entry ->
                                EntryRow(
                                    entry = entry,
                                    allowFileSelection = allowFileSelection,
                                    allowMarkdownSelection = onMarkdownSelected != null,
                                    allowImageSelection = onImageSelected != null,
                                    onOpen = {
                                        if (entry.isDirectory) vm.open(entry.fullPath)
                                        else if (onMarkdownSelected != null && entry.name.endsWith(".md", ignoreCase = true)) onMarkdownSelected(entry.fullPath)
                                        else if (onImageSelected != null && entry.name.isRemoteImagePath()) onImageSelected(entry.fullPath)
                                        else onFolderSelected(entry.fullPath)
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

private data class ProjectFileLocation(
    val label: String,
    val path: String,
    val isPrimary: Boolean,
)

private fun ProjectSettingsConfig.toFileLocations(): List<ProjectFileLocation> {
    val enabledSources = sources
        .filter { it.enabled && it.localPath.isNotBlank() }
        .distinctBy { it.localPath.trimEnd('/', '\\').lowercase() }
        .sortedWith(compareByDescending<ProjectSource> { it.isPrimary }.thenBy { it.label.lowercase() })
        .map { source ->
            ProjectFileLocation(
                label = source.label.ifBlank { source.localPath.fileName() },
                path = source.localPath,
                isPrimary = source.isPrimary,
            )
        }

    // Older projects may predate project_sources but still have a valid primary root. Preserve
    // access to those projects while making registered sources authoritative whenever present.
    if (enabledSources.isNotEmpty()) return enabledSources
    val legacyRoot = rootDirectory.orEmpty()
    return if (legacyRoot.isBlank()) emptyList() else listOf(
        ProjectFileLocation(legacyRoot.fileName(), legacyRoot, isPrimary = true),
    )
}

private fun String.fileName(): String =
    trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\').ifBlank { this }

@Composable
private fun ProjectFilesEmptyState(onOpenSettings: (() -> Unit)?) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            NexyIcon(
                NexyIconName.Folder,
                contentDescription = null,
                modifier = Modifier.padding(bottom = 2.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text("No project folders yet", style = MaterialTheme.typography.titleMedium)
            Text(
                "Add a folder or repository in Settings › Sources & repositories to browse this project's files.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (onOpenSettings != null) {
                Button(onClick = onOpenSettings) { Text("Open settings") }
            }
        }
    }
}

@Composable
private fun ProjectSourceChooser(
    locations: List<ProjectFileLocation>,
    onOpen: (String) -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text("Project folders", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Choose a source to browse.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(locations, key = { it.path }) { location ->
            LocationRow(
                label = location.label,
                path = location.path,
                supportingLabel = if (location.isPrimary) "Primary source" else null,
                onClick = { onOpen(location.path) },
            )
        }
    }
}

@Composable
private fun RootChooser(home: String?, recents: List<String>, onOpen: (String) -> Unit) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            Text(
                "Locations",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        home?.let { path ->
            item { LocationRow(label = "Home", path = path, onClick = { onOpen(path) }) }
        }
        if (recents.isNotEmpty()) {
            item {
                Text(
                    "Recent",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            items(recents) { path -> LocationRow(label = path.displayTail(), path = path, onClick = { onOpen(path) }) }
        }
    }
}

@Composable
private fun LocationRow(
    label: String,
    path: String,
    supportingLabel: String? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        NexyIcon(NexyIconName.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column {
            Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (label != path) {
                Text(
                    path.displayTail(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (supportingLabel != null) {
                Text(
                    supportingLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

@Composable
private fun EntryRow(
    entry: FsEntry,
    allowFileSelection: Boolean,
    allowMarkdownSelection: Boolean,
    allowImageSelection: Boolean,
    onOpen: () -> Unit,
) {
    val isImage = !entry.isDirectory && entry.name.isRemoteImagePath()
    val canOpen = entry.isDirectory || allowFileSelection ||
        (allowMarkdownSelection && entry.name.endsWith(".md", ignoreCase = true)) ||
        (allowImageSelection && isImage)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .let { if (canOpen) it.clickable(onClick = onOpen) else it }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val contentColor = if (canOpen) {
            MaterialTheme.colorScheme.onSurface
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        }
        NexyIcon(
            when {
                entry.isDirectory -> NexyIconName.Folder
                isImage -> NexyIconName.Image
                else -> NexyIconName.File
            },
            contentDescription = null,
            tint = if (entry.isDirectory) MaterialTheme.colorScheme.primary else contentColor,
        )
        Text(entry.name, color = contentColor, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (entry.isDirectory) {
            NexyIcon(NexyIconName.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
