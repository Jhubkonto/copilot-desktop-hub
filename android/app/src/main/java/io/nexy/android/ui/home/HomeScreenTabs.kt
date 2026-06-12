package io.nexy.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
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
    onOpenChat: (String) -> Unit,
    onRefresh: () -> Unit,
    onDisconnect: () -> Unit,
) {
    var activeFilter by remember { mutableStateOf<ChatFilter>(ChatFilter.All) }
    var searchQuery by remember { mutableStateOf("") }
    var showFilterSheet by remember { mutableStateOf(false) }
    val filterSheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val uniqueAgentNames = remember(conversations) {
        conversations.mapNotNull { it.agent_name }.distinct()
    }
    val uniqueProjectsWithChats = remember(conversations, projects) {
        projects.filter { p -> conversations.any { c -> c.project_id == p.id } }
    }
    val filteredByScope = remember(conversations, activeFilter) {
        when (val f = activeFilter) {
            is ChatFilter.All -> conversations
            is ChatFilter.ByAgent -> conversations.filter { it.agent_name == f.agentName }
            is ChatFilter.ByProject -> conversations.filter { it.project_id == f.projectId }
        }
    }
    val filteredConversations = remember(filteredByScope, searchQuery) {
        val query = searchQuery.trim()
        if (query.isBlank()) {
            filteredByScope
        } else {
            filteredByScope.filter { conversation ->
                listOfNotNull(
                    conversation.title, conversation.agent_name,
                    conversation.project_name, conversation.last_message,
                ).any { it.contains(query, ignoreCase = true) }
            }
        }
    }
    val showFilters = uniqueAgentNames.isNotEmpty() || uniqueProjectsWithChats.isNotEmpty()
    val activeFilterLabel = when (val f = activeFilter) {
        is ChatFilter.All -> "All chats"
        is ChatFilter.ByAgent -> "Agent: ${f.agentName}"
        is ChatFilter.ByProject -> "Project: ${f.projectName}"
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
                Text(
                    "No conversations yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = onRefresh) { Text("Refresh") }
                TextButton(onClick = onDisconnect) { Text("Disconnect") }
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = { searchQuery = it },
                        modifier = Modifier.weight(1f).height(56.dp),
                        singleLine = true,
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                        trailingIcon = {
                            if (searchQuery.isNotBlank()) {
                                IconButton(onClick = { searchQuery = "" }) {
                                    Icon(Icons.Default.Close, contentDescription = "Clear search")
                                }
                            }
                        },
                        placeholder = { Text("Search chats", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        shape = RoundedCornerShape(14.dp),
                    )
                    Surface(
                        modifier = Modifier
                            .height(56.dp)
                            .widthIn(min = 112.dp, max = 148.dp)
                            .clickable(enabled = showFilters) { showFilterSheet = true },
                        shape = RoundedCornerShape(14.dp),
                        color = if (activeFilter is ChatFilter.All)
                            MaterialTheme.colorScheme.surfaceVariant
                        else
                            MaterialTheme.colorScheme.primaryContainer,
                    ) {
                        Row(
                            modifier = Modifier.fillMaxHeight().padding(horizontal = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(
                                Icons.Default.FilterList,
                                contentDescription = "Filter chats",
                                modifier = Modifier.size(18.dp),
                                tint = if (activeFilter is ChatFilter.All)
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                else
                                    MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                            Text(
                                activeFilterLabel,
                                style = MaterialTheme.typography.labelMedium,
                                color = if (activeFilter is ChatFilter.All)
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                else
                                    MaterialTheme.colorScheme.onPrimaryContainer,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                if (filteredConversations.isEmpty()) {
                    Column(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            "No matching chats.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { searchQuery = ""; activeFilter = ChatFilter.All }) {
                            Text("Clear filters")
                        }
                    }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                        items(filteredConversations, key = { it.id }) { conv ->
                            ConversationRow(conv = conv, onOpenChat = onOpenChat)
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ProjectsTab(
    projects: List<Project>,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onOpenProjectHistory: (String) -> Unit,
) {
    RefreshableContent(isRefreshing = isRefreshing, onRefresh = onRefresh) {
        if (projects.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    "No projects found.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(projects, key = { it.id }) { project ->
                    val accentColor = projectColor(project.color)
                    Surface(
                        modifier = Modifier.fillMaxWidth().clickable { onOpenProjectHistory(project.id) },
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(modifier = Modifier.width(4.dp).fillMaxHeight().background(accentColor))
                            Column(
                                modifier = Modifier.weight(1f).padding(horizontal = 14.dp, vertical = 12.dp),
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
                                modifier = Modifier.padding(end = 16.dp),
                            )
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

@Composable
fun AgentsTab(
    agents: List<Agent>,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onOpenAgentHistory: (String) -> Unit,
) {
    RefreshableContent(isRefreshing = isRefreshing, onRefresh = onRefresh) {
        if (agents.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    "No agents found.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(agents, key = { it.id }) { agent ->
                    Surface(
                        modifier = Modifier.fillMaxWidth().clickable { onOpenAgentHistory(agent.id) },
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
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
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}
