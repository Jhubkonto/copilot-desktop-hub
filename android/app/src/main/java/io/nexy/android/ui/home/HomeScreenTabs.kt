package io.nexy.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyEmptyState
import kotlinx.coroutines.launch

private sealed class ChatFilter {
    object All : ChatFilter()
    data class ByAgent(val agentName: String) : ChatFilter()
    data class ByProject(val projectId: String, val projectName: String) : ChatFilter()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatsTab(
    conversations: List<Conversation>,
    agents: List<Agent>,
    projects: List<Project>,
    isRefreshing: Boolean,
    searchQuery: String,
    searchResults: List<Conversation>?,
    onSearchQueryChange: (String) -> Unit,
    onOpenChat: (String) -> Unit,
    onRefresh: () -> Unit,
    onDisconnect: () -> Unit,
    onRenameConversation: (id: String, title: String) -> Unit,
    onDeleteConversation: (id: String) -> Unit,
    onTogglePinConversation: (id: String, pinned: Boolean) -> Unit = { _, _ -> },
) {
    var activeFilter by remember { mutableStateOf<ChatFilter>(ChatFilter.All) }
    var showFilterSheet by remember { mutableStateOf(false) }
    var renamingConversation by remember { mutableStateOf<Conversation?>(null) }
    var deletingConversation by remember { mutableStateOf<Conversation?>(null) }
    var renameText by remember { mutableStateOf("") }
    val filterSheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val uniqueAgentNames = remember(conversations) {
        conversations.mapNotNull { it.agent_name }.distinct()
    }
    val uniqueProjectsWithChats = remember(conversations, projects) {
        projects.filter { p -> conversations.any { c -> c.project_id == p.id } }
    }

    // When a search query is active show server results; otherwise apply local scope filter
    val displayList: List<Conversation> = if (searchQuery.isNotBlank()) {
        searchResults ?: emptyList()
    } else {
        remember(conversations, activeFilter) {
            val filtered = when (val f = activeFilter) {
                is ChatFilter.All -> conversations
                is ChatFilter.ByAgent -> conversations.filter { it.agent_name == f.agentName }
                is ChatFilter.ByProject -> conversations.filter { it.project_id == f.projectId }
            }
            filtered.sortedWith(compareByDescending { it.pinned })
        }
    }

    val showFilters = searchQuery.isBlank() && (uniqueAgentNames.isNotEmpty() || uniqueProjectsWithChats.isNotEmpty())
    val activeFilterLabel = when (val f = activeFilter) {
        is ChatFilter.All -> "All chats"
        is ChatFilter.ByAgent -> "Agent: ${f.agentName}"
        is ChatFilter.ByProject -> "Project: ${f.projectName}"
    }

    // Rename dialog
    renamingConversation?.let { conv ->
        AlertDialog(
            onDismissRequest = { renamingConversation = null },
            title = { Text("Rename chat") },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    singleLine = true,
                    label = { Text("Title") },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val trimmed = renameText.trim()
                    if (trimmed.isNotBlank()) onRenameConversation(conv.id, trimmed)
                    renamingConversation = null
                }) { Text("Rename") }
            },
            dismissButton = {
                TextButton(onClick = { renamingConversation = null }) { Text("Cancel") }
            },
        )
    }

    deletingConversation?.let { conv ->
        NexyConfirmDialog(
            title = "Delete chat?",
            message = "\"${conv.title.ifBlank { "Untitled" }}\" will be removed from the paired desktop.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                onDeleteConversation(conv.id)
                deletingConversation = null
            },
            onDismiss = { deletingConversation = null },
        )
    }

    if (showFilterSheet) {
        ModalBottomSheet(
            onDismissRequest = { showFilterSheet = false },
            sheetState = filterSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Text(
                "Filter chats",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            FilterSheetItem(label = "All chats", selected = activeFilter is ChatFilter.All) {
                activeFilter = ChatFilter.All
                scope.launch { filterSheetState.hide() }.invokeOnCompletion { showFilterSheet = false }
            }
            if (uniqueAgentNames.isNotEmpty()) {
                Text(
                    "Agents",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                uniqueAgentNames.forEach { name ->
                    FilterSheetItem(
                        label = name,
                        prefix = "Agent",
                        selected = activeFilter == ChatFilter.ByAgent(name),
                    ) {
                        activeFilter = ChatFilter.ByAgent(name)
                        scope.launch { filterSheetState.hide() }.invokeOnCompletion { showFilterSheet = false }
                    }
                }
            }
            if (uniqueProjectsWithChats.isNotEmpty()) {
                Text(
                    "Projects",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                uniqueProjectsWithChats.forEach { project ->
                    FilterSheetItem(
                        label = project.name,
                        prefix = "Project",
                        selected = activeFilter == ChatFilter.ByProject(project.id, project.name),
                    ) {
                        activeFilter = ChatFilter.ByProject(project.id, project.name)
                        scope.launch { filterSheetState.hide() }.invokeOnCompletion { showFilterSheet = false }
                    }
                }
            }
            Spacer(Modifier.padding(bottom = 16.dp))
        }
    }

    RefreshableContent(isRefreshing = isRefreshing, onRefresh = onRefresh) {
        if (conversations.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                NexyEmptyState(
                    title = "No conversations yet.",
                    action = {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            TextButton(onClick = onRefresh) { Text("Refresh") }
                            TextButton(onClick = onDisconnect) { Text("Disconnect") }
                        }
                    },
                )
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = { onSearchQueryChange(it) },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                        trailingIcon = {
                            if (searchQuery.isNotBlank()) {
                                IconButton(onClick = { onSearchQueryChange("") }, modifier = Modifier.size(36.dp)) {
                                    Icon(Icons.Default.Close, contentDescription = "Clear search", modifier = Modifier.size(16.dp))
                                }
                            }
                        },
                        placeholder = { Text("Search chats", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        shape = RoundedCornerShape(12.dp),
                        textStyle = MaterialTheme.typography.bodyMedium,
                    )
                    FilterChip(
                        selected = activeFilter !is ChatFilter.All,
                        onClick = { if (showFilters) showFilterSheet = true },
                        label = {
                            Text(
                                activeFilterLabel,
                                style = MaterialTheme.typography.labelMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                        leadingIcon = {
                            Icon(
                                Icons.Default.FilterList,
                                contentDescription = "Filter chats",
                                modifier = Modifier.size(16.dp),
                            )
                        },
                        enabled = showFilters,
                        modifier = Modifier.heightIn(min = 56.dp),
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                if (displayList.isEmpty()) {
                    Column(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            if (searchQuery.isNotBlank()) "No results for \"$searchQuery\"." else "No matching chats.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { onSearchQueryChange(""); activeFilter = ChatFilter.All }) {
                            Text("Clear filters")
                        }
                    }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                        items(displayList, key = { it.id }) { conv ->
                            ConversationRow(
                                conv = conv,
                                onOpenChat = onOpenChat,
                                onRename = { _, _ ->
                                    renameText = conv.title
                                    renamingConversation = conv
                                },
                                onDelete = { deletingConversation = conv },
                                onTogglePin = { id, pinned -> onTogglePinConversation(id, pinned) },
                            )
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
            }
        }
    }
}

private val projectColors = listOf("blue", "green", "purple", "orange", "pink", "yellow")

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ProjectsTab(
    projects: List<Project>,
    isRefreshing: Boolean,
    showCreateSheet: Boolean,
    connectionState: ConnectionState = ConnectionState.CONNECTED,
    onDismissCreateSheet: () -> Unit,
    onRefresh: () -> Unit,
    onOpenProjectHistory: (String) -> Unit,
    onOpenProjectConfig: (String) -> Unit = {},
    onOpenProjectGenerator: () -> Unit,
    onCreateProject: (name: String, color: String) -> Unit,
    onRenameProject: (id: String, name: String) -> Unit,
    onDeleteProject: (id: String) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    var renameTarget by remember { mutableStateOf<Project?>(null) }
    var deleteTarget by remember { mutableStateOf<Project?>(null) }
    var renameText by remember { mutableStateOf("") }
    var projectSearch by remember { mutableStateOf("") }

    val filteredProjects = remember(projects, projectSearch) {
        val q = projectSearch.trim()
        if (q.isBlank()) projects else projects.filter { it.name.contains(q, ignoreCase = true) }
    }

    if (showCreateSheet) {
        val disconnected = connectionState != ConnectionState.CONNECTED
        var newName by remember { mutableStateOf("") }
        var newColor by remember { mutableStateOf("blue") }
        var sending by remember { mutableStateOf(false) }
        ModalBottomSheet(
            onDismissRequest = { if (!sending) onDismissCreateSheet() },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Column(modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("New Project", style = MaterialTheme.typography.titleMedium)
                if (disconnected) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text(
                            "Not connected to desktop. Connect before creating a project.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
                OutlinedTextField(
                    value = newName,
                    onValueChange = { if (!sending && !disconnected) newName = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !disconnected && !sending,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    projectColors.forEach { color ->
                        FilterChip(
                            selected = newColor == color,
                            onClick = { if (!sending && !disconnected) newColor = color },
                            label = {},
                            leadingIcon = {
                                Box(modifier = Modifier.size(16.dp).background(projectColor(color), RoundedCornerShape(4.dp)))
                            },
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = {
                        if (!sending) scope.launch { sheetState.hide() }.invokeOnCompletion { onDismissCreateSheet() }
                    }, enabled = !sending) { Text("Cancel") }
                    TextButton(
                        onClick = {
                            if (newName.isNotBlank() && !sending && !disconnected) {
                                sending = true
                                onCreateProject(newName.trim(), newColor)
                            }
                        },
                        enabled = newName.isNotBlank() && !sending && !disconnected,
                    ) { Text(if (sending) "Creating…" else "Create") }
                }
            }
        }
    }

    renameTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("Rename Project") },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (renameText.isNotBlank()) onRenameProject(target.id, renameText.trim())
                    renameTarget = null
                }) { Text("Rename") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("Cancel") } },
        )
    }

    deleteTarget?.let { target ->
        NexyConfirmDialog(
            title = "Delete project?",
            message = "\"${target.name}\" and its project settings will be removed from the paired desktop.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                onDeleteProject(target.id)
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
        )
    }

    RefreshableContent(isRefreshing = isRefreshing, onRefresh = onRefresh) {
        if (projects.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                NexyEmptyState(title = "No projects yet.", detail = "Use the + button to create or generate a project.")
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = projectSearch,
                        onValueChange = { projectSearch = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                        trailingIcon = {
                            if (projectSearch.isNotBlank()) {
                                IconButton(onClick = { projectSearch = "" }, modifier = Modifier.size(36.dp)) {
                                    Icon(Icons.Default.Close, contentDescription = "Clear search", modifier = Modifier.size(16.dp))
                                }
                            }
                        },
                        placeholder = { Text("Search projects", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        shape = RoundedCornerShape(12.dp),
                        textStyle = MaterialTheme.typography.bodyMedium,
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                items(filteredProjects, key = { it.id }) { project ->
                    val accentColor = projectColor(project.color)
                    var menuExpanded by remember { mutableStateOf(false) }
                    Surface(
                        modifier = Modifier.fillMaxWidth().combinedClickable(
                            onClick = { onOpenProjectHistory(project.id) },
                            onLongClick = {
                                renameText = project.name
                                renameTarget = project
                            },
                        ),
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).height(IntrinsicSize.Min),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(modifier = Modifier.width(4.dp).fillMaxHeight().background(accentColor))
                            Column(
                                modifier = Modifier.weight(1f).padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(3.dp),
                            ) {
                                Text(
                                    text = project.name,
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                val agentCount = project.agentIcons.size
                                val chatCount = project.chatCount
                                val subtitle = buildString {
                                    append(if (agentCount == 0) "No agents" else "$agentCount agent${if (agentCount != 1) "s" else ""}")
                                    append(" · ")
                                    append(if (chatCount == 0) "No chats" else "$chatCount chat${if (chatCount != 1) "s" else ""}")
                                }
                                Text(
                                    text = subtitle,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                if (project.agentIcons.isNotEmpty()) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        project.agentIcons.forEach { emoji ->
                                            Text(text = emoji, style = MaterialTheme.typography.bodyMedium)
                                        }
                                    }
                                }
                            }
                            Text(
                                text = "View chats →",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(end = 4.dp),
                            )
                            Box(modifier = Modifier.padding(end = 8.dp)) {
                                IconButton(onClick = { menuExpanded = true }) {
                                    Icon(
                                        Icons.Default.MoreVert,
                                        contentDescription = "Project actions",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                                    DropdownMenuItem(
                                        text = { Text("Settings") },
                                        leadingIcon = { Icon(Icons.Default.Settings, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            onOpenProjectConfig(project.id)
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Rename") },
                                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            renameText = project.name
                                            renameTarget = project
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Delete") },
                                        leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            deleteTarget = project
                                        },
                                    )
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
            } // end Column (search + list)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun AgentsTab(
    agents: List<Agent>,
    isRefreshing: Boolean,
    showCreateSheet: Boolean,
    connectionState: ConnectionState = ConnectionState.CONNECTED,
    onDismissCreateSheet: () -> Unit,
    onRefresh: () -> Unit,
    onOpenAgentHistory: (String) -> Unit,
    onOpenAgentConfig: (String) -> Unit = {},
    onOpenAgentGenerator: () -> Unit = {},
    onCreateAgent: (name: String, icon: String) -> Unit,
    onRenameAgent: (id: String, name: String, icon: String) -> Unit,
    onDeleteAgent: (id: String) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    var renameTarget by remember { mutableStateOf<Agent?>(null) }
    var deleteTarget by remember { mutableStateOf<Agent?>(null) }
    var renameText by remember { mutableStateOf("") }
    var renameIcon by remember { mutableStateOf("") }
    var agentSearch by remember { mutableStateOf("") }

    val filteredAgents = remember(agents, agentSearch) {
        val q = agentSearch.trim()
        if (q.isBlank()) agents else agents.filter { it.name.contains(q, ignoreCase = true) }
    }

    if (showCreateSheet) {
        val disconnected = connectionState != ConnectionState.CONNECTED
        var newName by remember { mutableStateOf("") }
        var newIcon by remember { mutableStateOf("") }
        var sending by remember { mutableStateOf(false) }
        ModalBottomSheet(
            onDismissRequest = { if (!sending) onDismissCreateSheet() },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Column(modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("New Agent", style = MaterialTheme.typography.titleMedium)
                if (disconnected) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text(
                            "Not connected to desktop. Connect before creating an agent.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
                OutlinedTextField(
                    value = newName,
                    onValueChange = { if (!sending && !disconnected) newName = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !disconnected && !sending,
                )
                OutlinedTextField(
                    value = newIcon,
                    onValueChange = { if (!sending && !disconnected) newIcon = it },
                    label = { Text("Icon (emoji)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !disconnected && !sending,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = {
                        if (!sending) scope.launch { sheetState.hide() }.invokeOnCompletion { onDismissCreateSheet() }
                    }, enabled = !sending) { Text("Cancel") }
                    TextButton(
                        onClick = {
                            if (newName.isNotBlank() && !sending && !disconnected) {
                                sending = true
                                onCreateAgent(newName.trim(), newIcon.trim())
                            }
                        },
                        enabled = newName.isNotBlank() && !sending && !disconnected,
                    ) { Text(if (sending) "Creating…" else "Create") }
                }
            }
        }
    }

    renameTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("Edit Agent") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = renameText,
                        onValueChange = { renameText = it },
                        label = { Text("Name") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = renameIcon,
                        onValueChange = { renameIcon = it },
                        label = { Text("Icon (emoji)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (renameText.isNotBlank()) onRenameAgent(target.id, renameText.trim(), renameIcon.trim())
                    renameTarget = null
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("Cancel") } },
        )
    }

    deleteTarget?.let { target ->
        NexyConfirmDialog(
            title = "Delete agent?",
            message = "\"${target.name}\" will be removed from the paired desktop.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                onDeleteAgent(target.id)
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
        )
    }

    RefreshableContent(isRefreshing = isRefreshing, onRefresh = onRefresh) {
        if (agents.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                NexyEmptyState(title = "No agents yet.", detail = "Use the + button to create or generate an agent.")
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = agentSearch,
                        onValueChange = { agentSearch = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                        trailingIcon = {
                            if (agentSearch.isNotBlank()) {
                                IconButton(onClick = { agentSearch = "" }, modifier = Modifier.size(36.dp)) {
                                    Icon(Icons.Default.Close, contentDescription = "Clear search", modifier = Modifier.size(16.dp))
                                }
                            }
                        },
                        placeholder = { Text("Search agents", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        shape = RoundedCornerShape(12.dp),
                        textStyle = MaterialTheme.typography.bodyMedium,
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                items(filteredAgents, key = { it.id }) { agent ->
                    var menuExpanded by remember { mutableStateOf(false) }
                    Surface(
                        modifier = Modifier.fillMaxWidth().combinedClickable(
                            onClick = { onOpenAgentHistory(agent.id) },
                            onLongClick = {
                                renameText = agent.name
                                renameIcon = agent.icon
                                renameTarget = agent
                            },
                        ),
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            if (agent.icon.isNotBlank()) {
                                Text(text = agent.icon, style = MaterialTheme.typography.titleMedium)
                            }
                            Text(
                                text = agent.name,
                                style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                text = "View chats →",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Box {
                                IconButton(onClick = { menuExpanded = true }) {
                                    Icon(
                                        Icons.Default.MoreVert,
                                        contentDescription = "Agent actions",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                                    DropdownMenuItem(
                                        text = { Text("Configure") },
                                        leadingIcon = { Icon(Icons.Default.Settings, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            onOpenAgentConfig(agent.id)
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Edit name/icon") },
                                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            renameText = agent.name
                                            renameIcon = agent.icon
                                            renameTarget = agent
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Delete") },
                                        leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                                        onClick = {
                                            menuExpanded = false
                                            deleteTarget = agent
                                        },
                                    )
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
            } // end Column (search + list)
        }
    }
}
