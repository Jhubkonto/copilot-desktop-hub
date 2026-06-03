package io.nexy.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Project
import io.nexy.android.ui.components.ApprovalDialog
import kotlinx.coroutines.launch

private sealed class ChatFilter {
    object All : ChatFilter()
    data class ByAgent(val agentName: String) : ChatFilter()
    data class ByProject(val projectId: String, val projectName: String) : ChatFilter()
}

private val tabTitles = listOf("Chats", "Projects", "Agents")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenChat: (String) -> Unit,
    onDisconnected: () -> Unit,
    onOpenSettings: () -> Unit,
    vm: HomeViewModel = viewModel(),
) {
    val connectionState by vm.connectionState.collectAsState()
    val conversations by vm.conversations.collectAsState()
    val agents by vm.agents.collectAsState()
    val projects by vm.projects.collectAsState()
    val pendingApproval by vm.pendingApproval.collectAsState()
    val newConversationId by vm.newConversationId.collectAsState()
    var selectedTab by remember { mutableIntStateOf(0) }
    var showNewChatSheet by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()

    LaunchedEffect(connectionState) {
        when (connectionState) {
            ConnectionState.CONNECTED -> {
                vm.refreshConversations()
                vm.requestAgents()
                vm.requestProjects()
            }
            ConnectionState.DISCONNECTED -> onDisconnected()
            else -> {}
        }
    }

    LaunchedEffect(newConversationId) {
        val id = newConversationId
        if (id != null) {
            vm.clearNewConversation()
            onOpenChat(id)
        }
    }

    // Refresh the active tab whenever the user switches to it
    LaunchedEffect(selectedTab) {
        when (selectedTab) {
            0 -> vm.refreshConversations()
            1 -> vm.requestProjects()
            2 -> vm.requestAgents()
        }
    }

    if (pendingApproval != null) {
        ApprovalDialog(
            request = pendingApproval!!,
            onApprove = { vm.approveRequest(pendingApproval!!.requestId) },
            onReject = { vm.rejectRequest(pendingApproval!!.requestId) },
        )
    }

    if (showNewChatSheet) {
        ModalBottomSheet(
            onDismissRequest = { showNewChatSheet = false },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Text(
                "New Chat",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            NewChatItem(label = "No agent / No project") {
                scope.launch { sheetState.hide() }.invokeOnCompletion { showNewChatSheet = false }
                vm.createConversation()
            }
            if (agents.isNotEmpty()) {
                Text(
                    "Agents",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                agents.forEach { agent ->
                    NewChatItem(label = if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name) {
                        scope.launch { sheetState.hide() }.invokeOnCompletion { showNewChatSheet = false }
                        vm.createConversation(agentId = agent.id)
                    }
                }
            }
            if (projects.isNotEmpty()) {
                Text(
                    "Projects",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                projects.forEach { project ->
                    NewChatItem(
                        label = project.name,
                        dotColor = projectColor(project.color),
                    ) {
                        scope.launch { sheetState.hide() }.invokeOnCompletion { showNewChatSheet = false }
                        vm.createConversation(projectId = project.id)
                    }
                }
            }
            Spacer(Modifier.padding(bottom = 16.dp))
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Box(
                        modifier = Modifier
                            .background(Color(0xFF1F2937), RoundedCornerShape(6.dp))
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = buildAnnotatedString {
                                withStyle(SpanStyle(color = Color(0xFFA78BFA))) { append("N") }
                                withStyle(SpanStyle(color = Color.White)) { append("exy") }
                            },
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            fontStyle = FontStyle.Italic,
                        )
                    }
                },
                actions = {
                    ConnectionChip(connectionState)
                    IconButton(onClick = {
                        when (selectedTab) {
                            0 -> vm.refreshConversations()
                            1 -> vm.requestProjects()
                            2 -> vm.requestAgents()
                        }
                    }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                    actionIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        },
        floatingActionButton = {
            if (selectedTab == 0) {
                FloatingActionButton(
                    onClick = { showNewChatSheet = true },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    Icon(Icons.Default.Add, contentDescription = "New Chat")
                }
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            PrimaryTabRow(selectedTabIndex = selectedTab) {
                tabTitles.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title, style = MaterialTheme.typography.labelLarge) },
                    )
                }
            }

            when (selectedTab) {
                0 -> ChatsTab(conversations = conversations, agents = agents, projects = projects, onOpenChat = onOpenChat, onRefresh = { vm.refreshConversations() }, onDisconnect = { vm.disconnect() })
                1 -> ProjectsTab(projects = projects, onNewChatInProject = { projectId ->
                    vm.createConversation(projectId = projectId)
                })
                2 -> AgentsTab(agents = agents, onNewChatWithAgent = { agentId ->
                    vm.createConversation(agentId = agentId)
                })
            }
        }
    }
}

@Composable
private fun ChatsTab(
    conversations: List<io.nexy.android.data.model.Conversation>,
    agents: List<Agent>,
    projects: List<Project>,
    onOpenChat: (String) -> Unit,
    onRefresh: () -> Unit,
    onDisconnect: () -> Unit,
) {
    var activeFilter by remember { mutableStateOf<ChatFilter>(ChatFilter.All) }
    val uniqueAgentNames = remember(conversations) {
        conversations.mapNotNull { it.agent_name }.distinct()
    }
    val uniqueProjectsWithChats = remember(conversations, projects) {
        projects.filter { p -> conversations.any { c -> c.project_id == p.id } }
    }
    val filteredConversations = remember(conversations, activeFilter) {
        when (val f = activeFilter) {
            is ChatFilter.All -> conversations
            is ChatFilter.ByAgent -> conversations.filter { it.agent_name == f.agentName }
            is ChatFilter.ByProject -> conversations.filter { it.project_id == f.projectId }
        }
    }
    val showFilters = uniqueAgentNames.isNotEmpty() || uniqueProjectsWithChats.isNotEmpty()

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
            if (showFilters) {
                LazyRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    item {
                        FilterChip(
                            selected = activeFilter is ChatFilter.All,
                            onClick = { activeFilter = ChatFilter.All },
                            label = { Text("All", style = MaterialTheme.typography.labelSmall) },
                        )
                    }
                    items(uniqueAgentNames) { name ->
                        FilterChip(
                            selected = activeFilter == ChatFilter.ByAgent(name),
                            onClick = {
                                activeFilter = if (activeFilter == ChatFilter.ByAgent(name))
                                    ChatFilter.All else ChatFilter.ByAgent(name)
                            },
                            label = { Text(name, style = MaterialTheme.typography.labelSmall) },
                        )
                    }
                    items(uniqueProjectsWithChats) { project ->
                        val f = ChatFilter.ByProject(project.id, project.name)
                        FilterChip(
                            selected = activeFilter == f,
                            onClick = { activeFilter = if (activeFilter == f) ChatFilter.All else f },
                            label = { Text(project.name, style = MaterialTheme.typography.labelSmall) },
                        )
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                items(filteredConversations, key = { it.id }) { conv ->
                    val badge = conv.agent_name ?: conv.project_name ?: ""
                    val preview = conv.last_message ?: ""
                    Surface(
                        modifier = Modifier.fillMaxWidth().clickable { onOpenChat(conv.id) },
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = conv.title.ifBlank { "Untitled" },
                                    style = MaterialTheme.typography.bodyLarge,
                                    modifier = Modifier.weight(1f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = timeAgo(conv.updated_at.toLongOrNull() ?: 0L),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(start = 8.dp),
                                )
                            }
                            Text(
                                text = badge,
                                style = MaterialTheme.typography.labelSmall,
                                color = if (badge.isNotEmpty()) MaterialTheme.colorScheme.primary else Color.Transparent,
                                modifier = Modifier.padding(top = 2.dp),
                                maxLines = 1,
                            )
                            Text(
                                text = preview,
                                style = MaterialTheme.typography.bodySmall,
                                color = if (preview.isNotEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else Color.Transparent,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 2.dp),
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
private fun ProjectsTab(
    projects: List<Project>,
    onNewChatInProject: (String) -> Unit,
) {
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
                    modifier = Modifier.fillMaxWidth().clickable { onNewChatInProject(project.id) },
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Left color accent bar (like desktop)
                        Box(
                            modifier = Modifier
                                .width(4.dp)
                                .fillMaxHeight()
                                .background(accentColor),
                        )
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .padding(horizontal = 14.dp, vertical = 12.dp),
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
                                        Text(
                                            text = emoji,
                                            style = MaterialTheme.typography.bodyMedium,
                                        )
                                    }
                                }
                            }
                        }
                        Text(
                            text = "New Chat →",
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

@Composable
private fun AgentsTab(
    agents: List<Agent>,
    onNewChatWithAgent: (String) -> Unit,
) {
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
                    modifier = Modifier.fillMaxWidth().clickable { onNewChatWithAgent(agent.id) },
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        if (agent.icon.isNotBlank()) {
                            Text(
                                text = agent.icon,
                                style = MaterialTheme.typography.titleMedium,
                            )
                        }
                        Text(
                            text = agent.name,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            text = "New Chat →",
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

@Composable
private fun NewChatItem(
    label: String,
    dotColor: Color? = null,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (dotColor != null) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .background(dotColor, CircleShape),
                )
            }
            Text(label, style = MaterialTheme.typography.bodyLarge)
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun ConnectionChip(state: ConnectionState) {
    val (label, color) = when (state) {
        ConnectionState.CONNECTED -> "Connected" to Color(0xFF22C55E)
        ConnectionState.CONNECTING -> "Connecting…" to Color(0xFFF59E0B)
        ConnectionState.DISCONNECTED -> "Disconnected" to Color(0xFFEF4444)
    }
    Text(
        text = "● $label",
        color = color,
        style = MaterialTheme.typography.labelMedium,
        modifier = Modifier.padding(end = 4.dp),
    )
}

private fun projectColor(color: String): Color = when (color.lowercase()) {
    "red" -> Color(0xFFEF4444)
    "orange" -> Color(0xFFF97316)
    "yellow" -> Color(0xFFEAB308)
    "green" -> Color(0xFF22C55E)
    "teal" -> Color(0xFF14B8A6)
    "blue" -> Color(0xFF3B82F6)
    "indigo" -> Color(0xFF6366F1)
    "purple" -> Color(0xFFA855F7)
    "pink" -> Color(0xFFEC4899)
    else -> Color(0xFF3B82F6)
}

private fun timeAgo(ms: Long): String {
    if (ms == 0L) return ""
    val diff = System.currentTimeMillis() - ms
    return when {
        diff < 60_000 -> "just now"
        diff < 3_600_000 -> "${diff / 60_000}m ago"
        diff < 86_400_000 -> "${diff / 3_600_000}h ago"
        else -> "${diff / 86_400_000}d ago"
    }
}
