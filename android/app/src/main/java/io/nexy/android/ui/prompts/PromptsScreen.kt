package io.nexy.android.ui.prompts

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material3.Badge
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.PromptVersion
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyFormSheet
import io.nexy.android.ui.components.NexyInfoDialog
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexySortSheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PromptsScreen(
    projectId: String? = null,
    onInsert: ((String) -> Unit)? = null,
    onBack: () -> Unit,
    vm: PromptsViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val isRefreshing by vm.isRefreshing.collectAsStateWithLifecycle()
    val haptic = LocalHapticFeedback.current
    var searchQuery by remember { mutableStateOf("") }
    var scopeFilter by remember { mutableStateOf<String?>(null) }
    var categoryFilter by remember { mutableStateOf<String?>(null) }
    var sortOrder by remember { mutableStateOf(PromptSortOrder.TITLE_ASC) }
    var showSortSheet by remember { mutableStateOf(false) }
    val scopeOptions = remember(state.entries) {
        state.entries.map { it.scope }.distinct().sorted()
    }
    val categoryOptions = remember(state.entries) {
        state.entries.map { it.category }.distinct().sorted()
    }
    val filteredEntries = remember(state.entries, searchQuery, scopeFilter, categoryFilter, sortOrder) {
        val query = searchQuery.trim()
        state.entries
            .let { list -> if (scopeFilter != null) list.filter { it.scope == scopeFilter } else list }
            .let { list -> if (categoryFilter != null) list.filter { it.category == categoryFilter } else list }
            .let { list ->
                if (query.isBlank()) list else list.filter { entry ->
                    listOf(
                        entry.title,
                        entry.description,
                        entry.category,
                        entry.scope,
                        entry.body,
                        entry.tags.joinToString(" "),
                    ).any { it.contains(query, ignoreCase = true) }
                }
            }
            .let { list ->
                when (sortOrder) {
                    PromptSortOrder.TITLE_ASC -> list.sortedBy { it.title.lowercase() }
                    PromptSortOrder.TITLE_DESC -> list.sortedByDescending { it.title.lowercase() }
                    PromptSortOrder.RECENTLY_UPDATED -> list.sortedByDescending { it.updatedAt }
                }
            }
    }

    if (showSortSheet) {
        NexySortSheet(
            options = listOf("Title A→Z", "Title Z→A", "Recently Updated"),
            selectedIndex = sortOrder.ordinal,
            onSelect = { sortOrder = PromptSortOrder.entries[it]; showSortSheet = false },
            onDismiss = { showSortSheet = false },
        )
    }

    LaunchedEffect(projectId) { vm.load(projectId) }
    LifecycleResumeEffect(projectId) {
        vm.load(projectId)
        onPauseOrDispose {}
    }

    LaunchedEffect(state.insertedText) {
        val text = state.insertedText
        if (text != null) {
            onInsert?.invoke(text)
            vm.clearInserted()
        }
    }

    state.error?.let { error ->
        NexyInfoDialog(
            title = "Prompt error",
            message = error,
            onDismiss = { vm.dismissError() },
        )
    }

    val selected = state.selectedEntry
    if (selected != null) {
        PromptDetailScreen(
            entry = selected,
            isEditing = state.isEditing,
            editTitle = state.editTitle,
            editBody = state.editBody,
            editDescription = state.editDescription,
            editCategory = state.editCategory,
            editTags = state.editTags,
            versions = state.versions,
            versionsLoading = state.versionsLoading,
            onBack = { vm.clearSelection() },
            onStartEdit = { vm.startEdit() },
            onCancelEdit = { vm.cancelEdit() },
            onSaveEdit = { vm.saveEdit() },
            onDelete = { vm.deleteEntry(selected.id); vm.clearSelection() },
            onRefreshVersions = { vm.loadVersions(selected.id) },
            onRollback = { vm.rollbackTo(it) },
            onInsert = if (onInsert != null) {{ vm.insertPrompt(selected.body) }} else null,
            onTitleChange = { vm.setEditTitle(it) },
            onBodyChange = { vm.setEditBody(it) },
            onDescriptionChange = { vm.setEditDescription(it) },
            onCategoryChange = { vm.setEditCategory(it) },
            onTagsChange = { vm.setEditTags(it) },
        )
        return
    }

    if (state.showCreateSheet) {
        CreatePromptSheet(
            title = state.editTitle,
            body = state.editBody,
            description = state.editDescription,
            category = state.editCategory,
            tags = state.editTags,
            scope = state.editScope,
            onTitleChange = { vm.setEditTitle(it) },
            onBodyChange = { vm.setEditBody(it) },
            onDescriptionChange = { vm.setEditDescription(it) },
            onCategoryChange = { vm.setEditCategory(it) },
            onTagsChange = { vm.setEditTags(it) },
            onScopeChange = { vm.setEditScope(it) },
            showProjectScope = projectId != null,
            onConfirm = { vm.createEntry() },
            onDismiss = { vm.dismissCreate() },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Prompt Library", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
                actions = {
                    if (state.entries.isNotEmpty()) {
                        IconButton(onClick = { showSortSheet = true }) {
                            Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = "Sort prompts")
                        }
                    }
                    IconButton(onClick = { vm.load(projectId) }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh prompts")
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                vm.showCreate()
            }) {
                Icon(Icons.Default.Add, contentDescription = "New prompt")
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { vm.load(projectId) },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (state.entries.isEmpty()) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    NexyEmptyState(
                        title = "No prompts yet.",
                        detail = "Tap + to create one.",
                        action = {
                            TextButton(onClick = { vm.load(projectId) }) { Text("Refresh") }
                        },
                    )
                }
            } else {
                Column(modifier = Modifier.fillMaxSize()) {
                    if (scopeOptions.size > 1) {
                        LazyRow(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            item {
                                FilterChip(
                                    selected = scopeFilter == null,
                                    onClick = { scopeFilter = null },
                                    label = { Text("All scopes") },
                                )
                            }
                            items(scopeOptions) { scope ->
                                FilterChip(
                                    selected = scopeFilter == scope,
                                    onClick = { scopeFilter = if (scopeFilter == scope) null else scope },
                                    label = { Text(scope.replaceFirstChar { it.uppercase() }) },
                                )
                            }
                        }
                    }
                    if (categoryOptions.size > 1) {
                        LazyRow(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            item {
                                FilterChip(
                                    selected = categoryFilter == null,
                                    onClick = { categoryFilter = null },
                                    label = { Text("All categories") },
                                )
                            }
                            items(categoryOptions) { category ->
                                FilterChip(
                                    selected = categoryFilter == category,
                                    onClick = { categoryFilter = if (categoryFilter == category) null else category },
                                    label = { Text(category) },
                                )
                            }
                        }
                    }
                    NexySearchField(
                        query = searchQuery,
                        onQueryChange = { searchQuery = it },
                        placeholder = "Search prompts",
                        debounceMs = 300L,
                    )
                    if (searchQuery.isNotBlank() || scopeFilter != null || categoryFilter != null) {
                        Text(
                            "Showing ${filteredEntries.size} of ${state.entries.size}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    if (filteredEntries.isEmpty()) {
                        NexyEmptyState(
                            title = "No matching prompts.",
                            detail = "Try a different title, tag, category, or phrase.",
                            modifier = Modifier.weight(1f),
                            action = { TextButton(onClick = { searchQuery = ""; scopeFilter = null; categoryFilter = null }) { Text("Clear filters") } },
                        )
                    } else {
                        val grouped = filteredEntries.groupBy { it.category }
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            grouped.forEach { (category, items) ->
                                item {
                                    Text(
                                        category,
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                    )
                                }
                                items(items, key = { it.id }) { entry ->
                                    Column {
                                        PromptRow(
                                            entry = entry,
                                            showInsert = onInsert != null,
                                            onClick = { vm.selectEntry(entry) },
                                            onInsert = { vm.insertPrompt(entry.body) },
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
}

private enum class PromptSortOrder { TITLE_ASC, TITLE_DESC, RECENTLY_UPDATED }

@Composable
private fun PromptRow(entry: PromptEntry, showInsert: Boolean, onClick: () -> Unit, onInsert: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(entry.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            if (entry.description.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(entry.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Badge(containerColor = MaterialTheme.colorScheme.secondaryContainer) {
                Text(entry.scope, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            if (showInsert) {
                TextButton(onClick = onInsert) { Text("Insert") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PromptDetailScreen(
    entry: PromptEntry,
    isEditing: Boolean,
    editTitle: String,
    editBody: String,
    editDescription: String,
    editCategory: String,
    editTags: String,
    versions: List<PromptVersion>,
    versionsLoading: Boolean,
    onBack: () -> Unit,
    onStartEdit: () -> Unit,
    onCancelEdit: () -> Unit,
    onSaveEdit: () -> Unit,
    onDelete: () -> Unit,
    onRefreshVersions: () -> Unit,
    onRollback: (Int) -> Unit,
    onInsert: (() -> Unit)?,
    onTitleChange: (String) -> Unit,
    onBodyChange: (String) -> Unit,
    onDescriptionChange: (String) -> Unit,
    onCategoryChange: (String) -> Unit,
    onTagsChange: (String) -> Unit,
) {
    var showDeleteDialog by remember { mutableStateOf(false) }

    // Mirrors the TopAppBar's `onBack = if (isEditing) onCancelEdit else onBack` below — without
    // this, system/gesture back skips straight out instead of stepping back one level at a time.
    BackHandler { if (isEditing) onCancelEdit() else onBack() }

    if (showDeleteDialog) {
        NexyConfirmDialog(
            title = "Delete prompt?",
            message = "\"${entry.title}\" will be permanently deleted.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                showDeleteDialog = false
                onDelete()
            },
            onDismiss = { showDeleteDialog = false },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(if (isEditing) "Edit Prompt" else entry.title, style = MaterialTheme.typography.titleMedium) },
                onBack = if (isEditing) onCancelEdit else onBack,
                actions = {
                    if (isEditing) {
                        TextButton(onClick = onSaveEdit) { Text("Save") }
                    } else {
                        if (onInsert != null) {
                            TextButton(onClick = onInsert) { Text("Insert") }
                        }
                        IconButton(onClick = onStartEdit) { Icon(Icons.Default.Edit, contentDescription = "Edit") }
                        IconButton(onClick = { showDeleteDialog = true }) { Icon(Icons.Default.Delete, contentDescription = "Delete") }
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
            if (isEditing) {
                OutlinedTextField(value = editTitle, onValueChange = onTitleChange, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Next))
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editBody, onValueChange = onBodyChange, label = { Text("Body") }, modifier = Modifier.fillMaxWidth(), minLines = 4, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true))
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editDescription, onValueChange = onDescriptionChange, label = { Text("Description") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Next))
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editCategory, onValueChange = onCategoryChange, label = { Text("Category") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editTags, onValueChange = onTagsChange, label = { Text("Tags (comma-separated)") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done))
            } else {
                if (entry.description.isNotBlank()) {
                    Text(entry.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                }
                Text(entry.body, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace)
                Spacer(Modifier.height(24.dp))
                PromptVersionHistory(
                    versions = versions,
                    isLoading = versionsLoading,
                    currentVersion = versions.maxOfOrNull { it.version },
                    onRefresh = onRefreshVersions,
                    onRollback = onRollback,
                )
            }
        }
    }
}

@Composable
private fun PromptVersionHistory(
    versions: List<PromptVersion>,
    isLoading: Boolean,
    currentVersion: Int?,
    onRefresh: () -> Unit,
    onRollback: (Int) -> Unit,
) {
    var rollbackVersion by remember { mutableStateOf<PromptVersion?>(null) }

    rollbackVersion?.let { version ->
        NexyConfirmDialog(
            title = "Restore version ${version.version}?",
            message = "The current prompt will be replaced and a new rollback version will be recorded.",
            confirmLabel = "Restore",
            onConfirm = {
                rollbackVersion = null
                onRollback(version.version)
            },
            onDismiss = { rollbackVersion = null },
        )
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Version history", style = MaterialTheme.typography.titleSmall)
        TextButton(onClick = onRefresh) { Text(if (isLoading) "Loading" else "Refresh") }
    }
    if (versions.isEmpty()) {
        Text(
            if (isLoading) "Loading versions..." else "No versions recorded yet.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 8.dp)) {
        versions.forEach { version ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "v${version.version} · ${version.source}",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            version.title,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                    TextButton(
                        onClick = { rollbackVersion = version },
                        enabled = version.version != currentVersion,
                    ) {
                        Text(if (version.version == currentVersion) "Current" else "Restore")
                    }
                }
                val changed = buildList {
                    if (version.diff.titleChanged) add("title")
                    if (version.diff.descriptionChanged) add("description")
                    if (version.diff.categoryChanged) add("category")
                    if (version.diff.tagsChanged) add("tags")
                    if (version.diff.scopeChanged) add("scope")
                    if (version.diff.addedLines.isNotEmpty()) add("+${version.diff.addedLines.size} lines")
                    if (version.diff.removedLines.isNotEmpty()) add("-${version.diff.removedLines.size} lines")
                }
                Text(
                    if (changed.isEmpty()) "No visible diff metadata" else changed.joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreatePromptSheet(
    title: String,
    body: String,
    description: String,
    category: String,
    tags: String,
    scope: String,
    showProjectScope: Boolean,
    onTitleChange: (String) -> Unit,
    onBodyChange: (String) -> Unit,
    onDescriptionChange: (String) -> Unit,
    onCategoryChange: (String) -> Unit,
    onTagsChange: (String) -> Unit,
    onScopeChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    NexyFormSheet(
        title = "New Prompt",
        confirmLabel = "Create",
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        confirmEnabled = title.isNotBlank() && body.isNotBlank(),
    ) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
            OutlinedTextField(value = title, onValueChange = onTitleChange, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Next))
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = body, onValueChange = onBodyChange, label = { Text("Body") }, modifier = Modifier.fillMaxWidth(), minLines = 3, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true))
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = description, onValueChange = onDescriptionChange, label = { Text("Description (optional)") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Next))
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = category, onValueChange = onCategoryChange, label = { Text("Category") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = tags, onValueChange = onTagsChange, label = { Text("Tags (comma-separated)") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done))
            if (showProjectScope) {
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("global", "project").forEach { s ->
                        TextButton(
                            onClick = { onScopeChange(s) },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(if (s == "global") "Global" else "Project only", style = if (scope == s) MaterialTheme.typography.labelMedium.copy(color = MaterialTheme.colorScheme.primary) else MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
    }
}
