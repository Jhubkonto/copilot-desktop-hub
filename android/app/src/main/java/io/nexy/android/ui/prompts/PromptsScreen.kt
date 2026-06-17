package io.nexy.android.ui.prompts

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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Badge
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyInfoDialog
import io.nexy.android.ui.components.NexySearchField

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PromptsScreen(
    projectId: String? = null,
    onInsert: ((String) -> Unit)? = null,
    onBack: () -> Unit,
    vm: PromptsViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    val filteredEntries = remember(state.entries, searchQuery) {
        val query = searchQuery.trim()
        if (query.isBlank()) state.entries else state.entries.filter { entry ->
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

    LaunchedEffect(projectId) { vm.load(projectId) }

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
            onBack = { vm.clearSelection() },
            onStartEdit = { vm.startEdit() },
            onCancelEdit = { vm.cancelEdit() },
            onSaveEdit = { vm.saveEdit() },
            onDelete = { vm.deleteEntry(selected.id); vm.clearSelection() },
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
            TopAppBar(
                title = { Text("Prompt Library", style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { vm.load(projectId) }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh prompts")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                    navigationIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { vm.showCreate() }) {
                Icon(Icons.Default.Add, contentDescription = "New prompt")
            }
        },
    ) { padding ->
        if (state.entries.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
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
            Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                NexySearchField(
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    placeholder = "Search prompts",
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                if (filteredEntries.isEmpty()) {
                    NexyEmptyState(
                        title = "No matching prompts.",
                        detail = "Try a different title, tag, category, or phrase.",
                        modifier = Modifier.weight(1f),
                        action = { TextButton(onClick = { searchQuery = "" }) { Text("Clear search") } },
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
                            items(items) { entry ->
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
    onBack: () -> Unit,
    onStartEdit: () -> Unit,
    onCancelEdit: () -> Unit,
    onSaveEdit: () -> Unit,
    onDelete: () -> Unit,
    onInsert: (() -> Unit)?,
    onTitleChange: (String) -> Unit,
    onBodyChange: (String) -> Unit,
    onDescriptionChange: (String) -> Unit,
    onCategoryChange: (String) -> Unit,
    onTagsChange: (String) -> Unit,
) {
    var showDeleteDialog by remember { mutableStateOf(false) }

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
            TopAppBar(
                title = { Text(if (isEditing) "Edit Prompt" else entry.title, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = if (isEditing) onCancelEdit else onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
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
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                    navigationIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
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
                OutlinedTextField(value = editTitle, onValueChange = onTitleChange, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editBody, onValueChange = onBodyChange, label = { Text("Body") }, modifier = Modifier.fillMaxWidth(), minLines = 4)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editDescription, onValueChange = onDescriptionChange, label = { Text("Description") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editCategory, onValueChange = onCategoryChange, label = { Text("Category") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editTags, onValueChange = onTagsChange, label = { Text("Tags (comma-separated)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            } else {
                if (entry.description.isNotBlank()) {
                    Text(entry.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                }
                Text(entry.body, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace)
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
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        ) {
            Text("New Prompt", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(value = title, onValueChange = onTitleChange, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = body, onValueChange = onBodyChange, label = { Text("Body") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = description, onValueChange = onDescriptionChange, label = { Text("Description (optional)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = category, onValueChange = onCategoryChange, label = { Text("Category") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = tags, onValueChange = onTagsChange, label = { Text("Tags (comma-separated)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
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
            Spacer(Modifier.height(16.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                TextButton(onClick = onConfirm, enabled = title.isNotBlank() && body.isNotBlank()) { Text("Create") }
            }
        }
    }
}
