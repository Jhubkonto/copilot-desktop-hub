package io.nexy.android.ui.skills

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyFormSheet
import io.nexy.android.ui.components.NexyInfoDialog
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.NexySortSheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SkillsScreen(
    onBack: () -> Unit,
    onOpenSkillGenerator: (() -> Unit)? = null,
    vm: SkillsViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    val isRefreshing by vm.isRefreshing.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    val context = LocalContext.current
    val clipboardManager = context.getSystemService(ClipboardManager::class.java)
    val haptic = LocalHapticFeedback.current
    var searchQuery by remember { mutableStateOf("") }
    var sortOrder by remember { mutableStateOf(SkillSortOrder.NAME_ASC) }
    var showSortSheet by remember { mutableStateOf(false) }
    val filteredSkills = remember(state.skills, searchQuery, sortOrder) {
        val query = searchQuery.trim()
        state.skills
            .let { list ->
                if (query.isBlank()) list else list.filter { skill ->
                    listOf(
                        skill.name,
                        skill.description,
                        skill.instructions,
                        skill.tags.joinToString(" "),
                    ).any { it.contains(query, ignoreCase = true) }
                }
            }
            .let { list ->
                when (sortOrder) {
                    SkillSortOrder.NAME_ASC -> list.sortedBy { it.name.lowercase() }
                    SkillSortOrder.NAME_DESC -> list.sortedByDescending { it.name.lowercase() }
                    SkillSortOrder.USAGE_DESC -> list.sortedByDescending { state.usageBySkillId[it.id] ?: 0 }
                }
            }
    }

    if (showSortSheet) {
        NexySortSheet(
            options = listOf("Name A→Z", "Name Z→A", "Usage Count"),
            selectedIndex = sortOrder.ordinal,
            onSelect = { sortOrder = SkillSortOrder.entries[it]; showSortSheet = false },
            onDismiss = { showSortSheet = false },
        )
    }

    LaunchedEffect(Unit) { vm.load() }
    LifecycleResumeEffect(Unit) {
        vm.load()
        onPauseOrDispose {}
    }

    state.error?.let { error ->
        NexyInfoDialog(
            title = "Skill error",
            message = error,
            onDismiss = { vm.dismissError() },
        )
    }

    state.exportJson?.let { exportJson ->
        SkillExportDialog(
            json = exportJson,
            onCopy = {
                clipboardManager?.setPrimaryClip(ClipData.newPlainText("Nexy skill JSON", exportJson))
            },
            onDismiss = { vm.clearExportJson() },
        )
    }

    if (state.showImportSheet) {
        SkillImportSheet(
            json = state.importJson,
            onJsonChange = { vm.setImportJson(it) },
            onConfirm = { vm.importSkill() },
            onDismiss = { vm.dismissImport() },
        )
    }

    val selected = state.selectedSkill
    if (selected != null) {
        SkillDetailScreen(
            skill = selected,
            isEditing = state.isEditing,
            state = state,
            usageCount = state.usageBySkillId[selected.id] ?: 0,
            onBack = { vm.clearSelection() },
            onStartEdit = { vm.startEdit() },
            onCancelEdit = { vm.cancelEdit() },
            onSaveEdit = { vm.saveEdit() },
            onDuplicate = { vm.duplicateSkill(selected.id) },
            onDelete = { vm.deleteSkill(selected.id) },
            onExport = { vm.exportSkill(selected.id) },
            vm = vm,
        )
        return
    }

    if (state.showCreateSheet) {
        SkillFormSheet(
            title = "New Skill",
            confirmLabel = "Create",
            state = state,
            vm = vm,
            onConfirm = { vm.createSkill() },
            onDismiss = { vm.dismissCreate() },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Skills", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                actions = {
                    TextButton(onClick = { vm.showImport() }) {
                        Text("Import")
                    }
                    if (state.skills.isNotEmpty()) {
                        IconButton(onClick = { showSortSheet = true }) {
                            Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = "Sort skills")
                        }
                    }
                    IconButton(onClick = { vm.load() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh skills")
                    }
                },
            )
        },
        floatingActionButton = {
            var showFabMenu by remember { mutableStateOf(false) }
            Box(modifier = Modifier.padding(end = 20.dp)) {
                FloatingActionButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        if (onOpenSkillGenerator != null) showFabMenu = true else vm.showCreate()
                    },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    Icon(Icons.Default.Add, contentDescription = "New skill")
                }
                if (onOpenSkillGenerator != null) {
                    DropdownMenu(
                        expanded = showFabMenu,
                        onDismissRequest = { showFabMenu = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("Add skill") },
                            onClick = { showFabMenu = false; vm.showCreate() },
                        )
                        DropdownMenuItem(
                            text = {
                                Text(
                                    if (connectionState == ConnectionState.CONNECTED) {
                                        "Generate skill"
                                    } else {
                                        "Generate skill · desktop required"
                                    },
                                )
                            },
                            onClick = { showFabMenu = false; onOpenSkillGenerator() },
                            enabled = connectionState == ConnectionState.CONNECTED,
                        )
                    }
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { vm.load() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                NexyConnectionBanner(connectionState)
                if (state.skills.isEmpty()) {
                    Column(
                        modifier = Modifier.weight(1f).fillMaxWidth().padding(24.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        NexyEmptyState(
                            title = "No skills yet.",
                            detail = "Tap + to create one.",
                            action = { TextButton(onClick = { vm.load() }) { Text("Refresh") } },
                        )
                    }
                } else {
                    NexySearchField(
                        query = searchQuery,
                        onQueryChange = { searchQuery = it },
                        placeholder = "Search skills",
                        debounceMs = 300L,
                    )
                    if (searchQuery.isNotBlank()) {
                        Text(
                            "Showing ${filteredSkills.size} of ${state.skills.size}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    if (filteredSkills.isEmpty()) {
                        NexyEmptyState(
                            title = "No matching skills.",
                            detail = "Try a different name, tag, or phrase.",
                            modifier = Modifier.weight(1f),
                            action = { TextButton(onClick = { searchQuery = "" }) { Text("Clear search") } },
                        )
                    } else {
                        LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
                            items(filteredSkills, key = { it.id }) { skill ->
                                Column(modifier = Modifier.animateItem()) {
                                    SkillRow(
                                        skill = skill,
                                        usageCount = state.usageBySkillId[skill.id] ?: 0,
                                        onClick = { vm.selectSkill(skill) },
                                        onTagClick = { tag -> searchQuery = tag },
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

private enum class SkillSortOrder { NAME_ASC, NAME_DESC, USAGE_DESC }

@Composable
private fun SkillRow(skill: SkillConfig, usageCount: Int, onClick: () -> Unit, onTagClick: (String) -> Unit = {}) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(skill.icon.ifBlank { "*" }, style = MaterialTheme.typography.titleMedium)
        Column(modifier = Modifier.weight(1f)) {
            Text(skill.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            if (skill.description.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    skill.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Badge(containerColor = MaterialTheme.colorScheme.primaryContainer) {
                Text(usageLabel(usageCount), style = MaterialTheme.typography.labelSmall)
            }
            if (skill.tags.isNotEmpty()) {
                Badge(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier.clickable { onTagClick(skill.tags.first()) },
                ) {
                    Text(skill.tags.first(), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SkillDetailScreen(
    skill: SkillConfig,
    isEditing: Boolean,
    state: SkillsUiState,
    usageCount: Int,
    onBack: () -> Unit,
    onStartEdit: () -> Unit,
    onCancelEdit: () -> Unit,
    onSaveEdit: () -> Unit,
    onDuplicate: () -> Unit,
    onDelete: () -> Unit,
    onExport: () -> Unit,
    vm: SkillsViewModel,
) {
    var showDeleteDialog by remember { mutableStateOf(false) }

    if (showDeleteDialog) {
        NexyConfirmDialog(
            title = "Delete skill?",
            message = "\"${skill.name}\" will be permanently deleted.",
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
                titleContent = { Text(if (isEditing) "Edit Skill" else skill.name, style = MaterialTheme.typography.titleMedium) },
                onBack = if (isEditing) onCancelEdit else onBack,
                actions = {
                    if (isEditing) {
                        TextButton(onClick = onSaveEdit) { Text("Save") }
                    } else {
                        TextButton(onClick = onExport) { Text("Export") }
                        TextButton(onClick = onDuplicate) { Text("Duplicate") }
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
                SkillFormFields(
                    state = state,
                    vm = vm,
                )
            } else {
                if (skill.description.isNotBlank()) {
                    Text(skill.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                }
                if (skill.tags.isNotEmpty()) {
                    Text(
                        skill.tags.joinToString(", "),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(12.dp))
                }
                Text(
                    usageLabel(usageCount),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(18.dp))
                Text("Instructions", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(6.dp))
                Text(
                    skill.instructions.ifBlank { "No instructions configured." },
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                )
                Spacer(Modifier.height(18.dp))
                Text("Enabled tools", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(6.dp))
                Text(
                    enabledToolsLabel(skill),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (skill.mcpServers.isNotEmpty()) {
                    Spacer(Modifier.height(18.dp))
                    Text("MCP servers", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(6.dp))
                    Text(skill.mcpServers.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (skill.knowledge.isNotEmpty()) {
                    Spacer(Modifier.height(18.dp))
                    Text("Knowledge", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(6.dp))
                    skill.knowledge.forEach { item ->
                        Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        if (item.content.isNotBlank()) {
                            Text(item.content, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Spacer(Modifier.height(8.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun SkillExportDialog(
    json: String,
    onCopy: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Export Skill") },
        text = {
            OutlinedTextField(
                value = json,
                onValueChange = {},
                readOnly = true,
                minLines = 8,
                maxLines = 14,
                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(onClick = onCopy) { Text("Copy") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Done") }
        },
    )
}

@Composable
private fun SkillImportSheet(
    json: String,
    onJsonChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    NexyFormSheet(
        title = "Import Skill",
        confirmLabel = "Import",
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        confirmEnabled = json.isNotBlank(),
    ) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
            OutlinedTextField(
                value = json,
                onValueChange = onJsonChange,
                label = { Text("Skill JSON") },
                minLines = 8,
                maxLines = 14,
                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun SkillFormSheet(
    title: String,
    confirmLabel: String,
    state: SkillsUiState,
    vm: SkillsViewModel,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    NexyFormSheet(
        title = title,
        confirmLabel = confirmLabel,
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        confirmEnabled = state.editName.isNotBlank(),
    ) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
            SkillFormFields(
                state = state,
                vm = vm,
            )
        }
    }
}

@Composable
private fun SkillFormFields(
    state: SkillsUiState,
    vm: SkillsViewModel,
) {
    OutlinedTextField(value = state.editName, onValueChange = { vm.setEditName(it) }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(value = state.editIcon, onValueChange = { vm.setEditIcon(it) }, label = { Text("Icon") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(value = state.editDescription, onValueChange = { vm.setEditDescription(it) }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(value = state.editInstructions, onValueChange = { vm.setEditInstructions(it) }, label = { Text("Instructions") }, modifier = Modifier.fillMaxWidth(), minLines = 6)
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(value = state.editTags, onValueChange = { vm.setEditTags(it) }, label = { Text("Tags (comma-separated)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
    Spacer(Modifier.height(18.dp))
    Text("Built-in tools", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    Spacer(Modifier.height(8.dp))
    SkillToolEditor(
        title = "File Edit",
        enabled = state.editFileEditEnabled,
        approval = state.editFileEditApproval,
        instructions = state.editFileEditInstructions,
        onEnabledChange = { vm.setEditFileEditEnabled(it) },
        onApprovalChange = { vm.setEditFileEditApproval(it) },
        onInstructionsChange = { vm.setEditFileEditInstructions(it) },
    )
    Spacer(Modifier.height(8.dp))
    SkillToolEditor(
        title = "Terminal",
        enabled = state.editTerminalEnabled,
        approval = state.editTerminalApproval,
        instructions = state.editTerminalInstructions,
        onEnabledChange = { vm.setEditTerminalEnabled(it) },
        onApprovalChange = { vm.setEditTerminalApproval(it) },
        onInstructionsChange = { vm.setEditTerminalInstructions(it) },
    )
    Spacer(Modifier.height(8.dp))
    SkillToolEditor(
        title = "Web Fetch",
        enabled = state.editWebFetchEnabled,
        approval = state.editWebFetchApproval,
        instructions = state.editWebFetchInstructions,
        onEnabledChange = { vm.setEditWebFetchEnabled(it) },
        onApprovalChange = { vm.setEditWebFetchApproval(it) },
        onInstructionsChange = { vm.setEditWebFetchInstructions(it) },
    )
    Spacer(Modifier.height(18.dp))
    Text("MCP servers", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    Spacer(Modifier.height(8.dp))
    McpServerPicker(
        servers = state.mcpServers,
        selectedIds = state.editMcpServerIds,
        trustByServerId = state.editMcpServerTrust,
        onToggle = { id, enabled -> vm.toggleMcpServer(id, enabled) },
        onCycleTrust = { id -> vm.cycleMcpServerTrust(id) },
    )
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = state.editMcpToolOverrides,
        onValueChange = { vm.setEditMcpToolOverrides(it) },
        label = { Text("MCP tool overrides") },
        placeholder = { Text("serverId/toolName | enabled | always-ask | Instructions") },
        modifier = Modifier.fillMaxWidth(),
        minLines = 3,
    )
    Spacer(Modifier.height(18.dp))
    OutlinedTextField(
        value = state.editKnowledge,
        onValueChange = { vm.setEditKnowledge(it) },
        label = { Text("Knowledge entries") },
        placeholder = { Text("One per line: Title: Content") },
        modifier = Modifier.fillMaxWidth(),
        minLines = 4,
    )
}

@Composable
private fun SkillToolEditor(
    title: String,
    enabled: Boolean,
    approval: String,
    instructions: String,
    onEnabledChange: (Boolean) -> Unit,
    onApprovalChange: (String) -> Unit,
    onInstructionsChange: (String) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.bodyMedium)
                    Text(approvalLabel(approval), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = enabled, onCheckedChange = onEnabledChange)
            }
            if (enabled) {
                TextButton(onClick = { onApprovalChange(nextApproval(approval)) }) {
                    Text("Approval: ${approvalLabel(approval)}")
                }
                OutlinedTextField(
                    value = instructions,
                    onValueChange = onInstructionsChange,
                    label = { Text("Tool instructions") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
            }
        }
    }
}

@Composable
private fun McpServerPicker(
    servers: List<McpServerInfo>,
    selectedIds: List<String>,
    trustByServerId: Map<String, String>,
    onToggle: (String, Boolean) -> Unit,
    onCycleTrust: (String) -> Unit,
) {
    if (servers.isEmpty()) {
        Text("No MCP servers configured.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        servers.forEach { server ->
            val selected = selectedIds.contains(server.id)
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(server.name, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            if (server.enabled) server.command else "Disabled",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Switch(checked = selected, onCheckedChange = { onToggle(server.id, it) }, enabled = server.enabled)
                }
                if (selected) {
                    TextButton(
                        onClick = { onCycleTrust(server.id) },
                        modifier = Modifier.padding(horizontal = 12.dp).padding(bottom = 8.dp),
                    ) {
                        Text("Trust: ${trustLabel(trustByServerId[server.id] ?: "always-ask")}")
                    }
                }
            }
        }
    }
}

private fun enabledToolsLabel(skill: SkillConfig): String {
    val tools = listOfNotNull(
        "File edit".takeIf { skill.tools.fileEdit.enabled },
        "Terminal".takeIf { skill.tools.terminal.enabled },
        "Web fetch".takeIf { skill.tools.webFetch.enabled },
    )
    return if (tools.isEmpty()) "No built-in tools enabled." else tools.joinToString(", ")
}

private fun approvalLabel(value: String): String =
    when (value) {
        "auto" -> "Auto"
        "disabled" -> "Disabled"
        else -> "Always ask"
    }

private fun trustLabel(value: String): String =
    when (value) {
        "auto" -> "Auto"
        "block" -> "Block"
        else -> "Always ask"
    }

private fun nextApproval(value: String): String =
    when (value) {
        "always-ask" -> "auto"
        "auto" -> "disabled"
        else -> "always-ask"
    }

private fun usageLabel(count: Int): String =
    when (count) {
        0 -> "Unused"
        1 -> "1 agent"
        else -> "$count agents"
    }
