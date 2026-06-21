package io.nexy.android.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import io.nexy.android.ui.components.NexyTopAppBar
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
import io.nexy.android.ui.theme.NexyViolet
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.ui.components.ApprovalDialog
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import kotlinx.coroutines.launch
import java.util.UUID

private val tabTitles = listOf("Chats", "Projects", "Agents")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenChat: (String) -> Unit,
    onOpenDraftChat: (String, String?, String?) -> Unit,
    onOpenAgentHistory: (String) -> Unit,
    onOpenAgentConfig: (String) -> Unit,
    onOpenAgentGenerator: () -> Unit,
    onOpenProjectHistory: (String) -> Unit,
    onOpenProjectConfig: (String) -> Unit,
    onOpenProjectGenerator: () -> Unit,
    onOpenArtifacts: () -> Unit,
    onOpenSkills: () -> Unit,
    onOpenSkillGenerator: () -> Unit,
    onDisconnected: () -> Unit,
    onOpenSettings: () -> Unit,
    vm: HomeViewModel = viewModel(),
) {
    val connectionState by vm.connectionState.collectAsState()
    val reconnectExhausted by vm.reconnectExhausted.collectAsState()
    val conversations by vm.conversations.collectAsState()
    val agents by vm.agents.collectAsState()
    val projects by vm.projects.collectAsState()
    val isRefreshingConversations by vm.isRefreshingConversations.collectAsState()
    val isRefreshingAgents by vm.isRefreshingAgents.collectAsState()
    val isRefreshingProjects by vm.isRefreshingProjects.collectAsState()
    val pendingApproval by vm.pendingApproval.collectAsState()
    val searchQuery by vm.searchQuery.collectAsState()
    val searchResults by vm.searchResults.collectAsState()
    var selectedTab by remember { mutableIntStateOf(0) }
    var showNewChatSheet by remember { mutableStateOf(false) }
    var showCreateProjectSheet by remember { mutableStateOf(false) }
    var showCreateAgentSheet by remember { mutableStateOf(false) }
    var showOverflowMenu by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val haptic = LocalHapticFeedback.current

    LaunchedEffect(Unit) {
        vm.projectCreated.collect { name ->
            showCreateProjectSheet = false
            snackbarHostState.showSnackbar("Project \"$name\" created.")
        }
    }
    LaunchedEffect(Unit) {
        vm.agentCreated.collect { name ->
            showCreateAgentSheet = false
            snackbarHostState.showSnackbar("Agent \"$name\" created.")
        }
    }

    LaunchedEffect(connectionState) {
        when (connectionState) {
            ConnectionState.CONNECTED -> {
                vm.refreshConversations()
                vm.requestAgents()
                vm.requestProjects()
            }
            else -> {}
        }
    }

    LaunchedEffect(reconnectExhausted) {
        if (reconnectExhausted) onDisconnected()
    }

    LaunchedEffect(selectedTab) {
        when (selectedTab) {
            0 -> vm.refreshConversations()
            1 -> vm.requestProjects()
            2 -> vm.requestAgents()
        }
    }

    BackHandler(enabled = selectedTab != 0) {
        selectedTab = 0
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
                onOpenDraftChat(UUID.randomUUID().toString(), null, null)
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
                        onOpenDraftChat(UUID.randomUUID().toString(), agent.id, null)
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
                        onOpenDraftChat(UUID.randomUUID().toString(), null, project.id)
                    }
                }
            }
            Spacer(Modifier.padding(bottom = 16.dp))
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Box(
                        modifier = Modifier
                            .background(Color(0xFF1F2937), RoundedCornerShape(6.dp))
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = buildAnnotatedString {
                                withStyle(SpanStyle(color = NexyViolet)) { append("N") }
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
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                    Box {
                        IconButton(onClick = { showOverflowMenu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "More options")
                        }
                        DropdownMenu(
                            expanded = showOverflowMenu,
                            onDismissRequest = { showOverflowMenu = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("Artifacts") },
                                leadingIcon = { Icon(Icons.Default.Folder, contentDescription = null) },
                                onClick = { showOverflowMenu = false; onOpenArtifacts() },
                            )
                            DropdownMenuItem(
                                text = { Text("Skills") },
                                leadingIcon = { Icon(Icons.Default.Build, contentDescription = null) },
                                onClick = { showOverflowMenu = false; onOpenSkills() },
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            val fabLabel = when (selectedTab) {
                0 -> "New Chat"
                1 -> "New Project"
                else -> "New Agent"
            }
            FloatingActionButton(
                onClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    when (selectedTab) {
                        0 -> showNewChatSheet = true
                        1 -> showCreateProjectSheet = true
                        2 -> showCreateAgentSheet = true
                    }
                },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(Icons.Default.Add, contentDescription = fabLabel)
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

            if (connectionState == ConnectionState.POLLING) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFFFF3CD))
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    Text(
                        "Looking for your desktop…",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF856404),
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "Wake it up",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFF664D03),
                        modifier = Modifier
                            .clickable { vm.wakeDesktop() }
                            .padding(start = 8.dp),
                    )
                }
            }

            when (selectedTab) {
                0 -> ChatsTab(
                    conversations = conversations,
                    agents = agents,
                    projects = projects,
                    isRefreshing = isRefreshingConversations,
                    searchQuery = searchQuery,
                    searchResults = searchResults,
                    onSearchQueryChange = { vm.setSearchQuery(it) },
                    onOpenChat = onOpenChat,
                    onRefresh = { vm.refreshConversations() },
                    onDisconnect = { vm.disconnect() },
                    onRenameConversation = { id, title -> vm.renameConversation(id, title) },
                    onDeleteConversation = { id -> vm.deleteConversation(id) },
                    onTogglePinConversation = { id, pinned -> vm.setPinnedConversation(id, pinned) },
                )
                1 -> ProjectsTab(
                    projects = projects,
                    isRefreshing = isRefreshingProjects,
                    showCreateSheet = showCreateProjectSheet,
                    connectionState = connectionState,
                    onDismissCreateSheet = { showCreateProjectSheet = false },
                    onRefresh = { vm.requestProjects() },
                    onOpenProjectHistory = onOpenProjectHistory,
                    onOpenProjectConfig = onOpenProjectConfig,
                    onOpenProjectGenerator = onOpenProjectGenerator,
                    onCreateProject = { name, color -> vm.createProject(name, color) },
                    onRenameProject = { id, name -> vm.renameProject(id, name) },
                    onDeleteProject = { id -> vm.deleteProject(id) },
                )
                2 -> AgentsTab(
                    agents = agents,
                    isRefreshing = isRefreshingAgents,
                    showCreateSheet = showCreateAgentSheet,
                    connectionState = connectionState,
                    onDismissCreateSheet = { showCreateAgentSheet = false },
                    onRefresh = { vm.requestAgents() },
                    onOpenAgentHistory = onOpenAgentHistory,
                    onOpenAgentConfig = onOpenAgentConfig,
                    onOpenAgentGenerator = onOpenAgentGenerator,
                    onCreateAgent = { name, icon -> vm.createAgent(name, icon) },
                    onRenameAgent = { id, name, icon -> vm.updateAgent(id, name, icon) },
                    onDeleteAgent = { id -> vm.deleteAgent(id) },
                )
            }
        }
    }
}
