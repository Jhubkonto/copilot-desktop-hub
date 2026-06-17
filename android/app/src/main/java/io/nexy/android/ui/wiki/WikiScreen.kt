package io.nexy.android.ui.wiki

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyFormSheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WikiScreen(
    projectId: String,
    onBack: () -> Unit,
    vm: WikiViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()

    LaunchedEffect(projectId) { vm.load(projectId) }

    val selected = state.selectedEntry
    if (selected != null) {
        WikiEntryScreen(
            entry = selected,
            isEditing = state.isEditing,
            editTitle = state.editTitle,
            editBody = state.editBody,
            editTags = state.editTags,
            onBack = { vm.clearSelection() },
            onStartEdit = { vm.startEdit() },
            onCancelEdit = { vm.cancelEdit() },
            onSaveEdit = { vm.saveEdit() },
            onDelete = { vm.deleteEntry(selected.id); vm.clearSelection() },
            onTitleChange = { vm.setEditTitle(it) },
            onBodyChange = { vm.setEditBody(it) },
            onTagsChange = { vm.setEditTags(it) },
        )
        return
    }

    if (state.showCreateSheet) {
        CreateWikiEntrySheet(
            title = state.editTitle,
            body = state.editBody,
            tags = state.editTags,
            onTitleChange = { vm.setEditTitle(it) },
            onBodyChange = { vm.setEditBody(it) },
            onTagsChange = { vm.setEditTags(it) },
            onConfirm = { vm.createEntry() },
            onDismiss = { vm.dismissCreate() },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Project Wiki", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { vm.showCreate() }) {
                Icon(Icons.Default.Add, contentDescription = "New entry")
            }
        },
    ) { padding ->
        if (state.entries.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("No wiki entries yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                Text("Tap + to create the first one.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                items(state.entries) { entry ->
                    WikiEntryRow(entry = entry, onClick = { vm.selectEntry(entry) })
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WikiEntryRow(entry: WikiEntry, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(entry.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        if (entry.body.isNotBlank()) {
            Spacer(Modifier.height(2.dp))
            Text(entry.body, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
        if (entry.tags.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                entry.tags.forEach { tag ->
                    AssistChip(onClick = {}, label = { Text(tag, style = MaterialTheme.typography.labelSmall) })
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun WikiEntryScreen(
    entry: WikiEntry,
    isEditing: Boolean,
    editTitle: String,
    editBody: String,
    editTags: String,
    onBack: () -> Unit,
    onStartEdit: () -> Unit,
    onCancelEdit: () -> Unit,
    onSaveEdit: () -> Unit,
    onDelete: () -> Unit,
    onTitleChange: (String) -> Unit,
    onBodyChange: (String) -> Unit,
    onTagsChange: (String) -> Unit,
) {
    var showDeleteDialog by remember { mutableStateOf(false) }

    if (showDeleteDialog) {
        NexyConfirmDialog(
            title = "Delete entry?",
            message = "\"${entry.title}\" will be permanently deleted.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = { showDeleteDialog = false; onDelete() },
            onDismiss = { showDeleteDialog = false },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(if (isEditing) "Edit Entry" else entry.title, style = MaterialTheme.typography.titleMedium) },
                onBack = if (isEditing) onCancelEdit else onBack,
                actions = {
                    if (isEditing) {
                        TextButton(onClick = onSaveEdit) { Text("Save") }
                    } else {
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
                OutlinedTextField(
                    value = editTitle,
                    onValueChange = onTitleChange,
                    label = { Text("Title") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = editBody,
                    onValueChange = onBodyChange,
                    label = { Text("Body") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 4,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = editTags,
                    onValueChange = onTagsChange,
                    label = { Text("Tags (comma-separated)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            } else {
                Text(entry.body, style = MaterialTheme.typography.bodyMedium)
                if (entry.tags.isNotEmpty()) {
                    Spacer(Modifier.height(16.dp))
                    Text("Tags", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(4.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        entry.tags.forEach { tag ->
                            AssistChip(onClick = {}, label = { Text(tag) })
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateWikiEntrySheet(
    title: String,
    body: String,
    tags: String,
    onTitleChange: (String) -> Unit,
    onBodyChange: (String) -> Unit,
    onTagsChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    NexyFormSheet(
        title = "New Wiki Entry",
        confirmLabel = "Create",
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        confirmEnabled = title.isNotBlank(),
    ) {
        OutlinedTextField(
            value = title,
            onValueChange = onTitleChange,
            label = { Text("Title") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = body,
            onValueChange = onBodyChange,
            label = { Text("Body") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 3,
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = tags,
            onValueChange = onTagsChange,
            label = { Text("Tags (comma-separated)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
    }
}
