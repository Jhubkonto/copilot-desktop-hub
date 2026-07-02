package io.nexy.android.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Difference
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
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
import io.nexy.android.data.PairedServerProfile
import io.nexy.android.ui.components.ApprovalDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.OutlinedButton
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
    onOpenAgentConfigNew: (String) -> Unit = onOpenAgentConfig,
    onOpenAgentGenerator: () -> Unit,
    onOpenProjectHistory: (String) -> Unit,
    onOpenProjectConfig: (String) -> Unit,
    onOpenProjectConfigNew: (String) -> Unit = onOpenProjectConfig,
    onOpenProjectGenerator: () -> Unit,
    onOpenArtifacts: () -> Unit,
    onOpenCodeChanges: () -> Unit,
    onOpenSkills: () -> Unit,
    onOpenScheduled: () -> Unit,
    onOpenSkillGenerator: () -> Unit,
    onDisconnected: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenPairingScan: () -> Unit,
    vm: HomeViewModel = viewModel(),
) {
    val connectionState by vm.connectionState.collectAsState()
    val reconnectExhausted by vm.reconnectExhausted.collectAsState()
    val intentionalRestartExpected by vm.intentionalRestartExpected.collectAsState()
    val conversations by vm.conversations.collectAsState()
    val agents by vm.agents.collectAsState()
    val projects by vm.projects.collectAsState()
    val isRefreshingConversations by vm.isRefreshingConversations.collectAsState()
    val isRefreshingAgents by vm.isRefreshingAgents.collectAsState()
    val isRefreshingProjects by vm.isRefreshingProjects.collectAsState()
    val pendingApproval by vm.pendingApproval.collectAsState()
    val searchQuery by vm.searchQuery.collectAsState()
    val searchResults by vm.searchResults.collectAsState()
    val highlightProjectId by vm.highlightProjectId.collectAsState()
    val highlightAgentId by vm.highlightAgentId.collectAsState()
    val profiles by vm.profiles.collectAsState()
    val activeProfileId by vm.activeProfileId.collectAsState()
    val activeConversationIds by vm.activeConversationIds.collectAsState()
    val pendingConversationIds by vm.pendingConversationIds.collectAsState()
    val completedWhileAwayIds by vm.completedWhileAwayIds.collectAsState()
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var showNewChatSheet by remember { mutableStateOf(false) }
    var newChatQuery by remember { mutableStateOf("") }
    var showCreateProjectSheet by remember { mutableStateOf(false) }
    var showCreateAgentSheet by remember { mutableStateOf(false) }
    var showOverflowMenu by remember { mutableStateOf(false) }
    var showConnectionSheet by remember { mutableStateOf(false) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val connectionSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val haptic = LocalHapticFeedback.current

    LaunchedEffect(Unit) {
        vm.projectCreated.collect { projectId ->
            showCreateProjectSheet = false
            onOpenProjectConfigNew(projectId)
        }
    }
    LaunchedEffect(Unit) {
        vm.agentCreated.collect { agentId ->
            showCreateAgentSheet = false
            onOpenAgentConfigNew(agentId)
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
        val filteredAgents = agents.filter { a ->
            newChatQuery.isBlank() || a.name.contains(newChatQuery, ignoreCase = true)
        }
        val filteredProjects = projects.filter { p ->
            newChatQuery.isBlank() || p.name.contains(newChatQuery, ignoreCase = true)
        }
        ModalBottomSheet(
            onDismissRequest = { showNewChatSheet = false; newChatQuery = "" },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Text(
                "New Chat",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            NexySearchField(
                query = newChatQuery,
                onQueryChange = { newChatQuery = it },
                placeholder = "Search agents or projects…",
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val consumeDownScroll = remember {
                object : NestedScrollConnection {
                    override fun onPostScroll(
                        consumed: Offset,
                        available: Offset,
                        source: NestedScrollSource,
                    ): Offset = available.copy(y = available.y.coerceAtMost(0f))
                }
            }
            LazyColumn(modifier = Modifier.fillMaxHeight(0.85f).nestedScroll(consumeDownScroll)) {
                if (newChatQuery.isBlank()) {
                    item {
                        NewChatItem(label = "No agent / No project") {
                            scope.launch { sheetState.hide() }.invokeOnCompletion {
                                showNewChatSheet = false; newChatQuery = ""
                            }
                            onOpenDraftChat(UUID.randomUUID().toString(), null, null)
                        }
                    }
                }
                if (filteredAgents.isNotEmpty()) {
                    item {
                        Text(
                            "Agents",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                        )
                    }
                    items(filteredAgents, key = { it.id }) { agent ->
                        NewChatItem(label = if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name) {
                            scope.launch { sheetState.hide() }.invokeOnCompletion {
                                showNewChatSheet = false; newChatQuery = ""
                            }
                            onOpenDraftChat(UUID.randomUUID().toString(), agent.id, null)
                        }
                    }
                }
                if (filteredProjects.isNotEmpty()) {
                    item {
                        Text(
                            "Projects",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                        )
                    }
                    items(filteredProjects, key = { it.id }) { project ->
                        NewChatItem(
                            label = project.name,
                            dotColor = projectColor(project.color),
                        ) {
                            scope.launch { sheetState.hide() }.invokeOnCompletion {
                                showNewChatSheet = false; newChatQuery = ""
                            }
                            onOpenDraftChat(UUID.randomUUID().toString(), null, project.id)
                        }
                    }
                }
                if (filteredAgents.isEmpty() && filteredProjects.isEmpty() && newChatQuery.isNotBlank()) {
                    item {
                        Text(
                            "No results for \"$newChatQuery\"",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp),
                        )
                    }
                }
                item { Spacer(Modifier.padding(bottom = 16.dp)) }
            }
        }
    }

    if (showConnectionSheet) {
        ModalBottomSheet(
            onDismissRequest = { showConnectionSheet = false },
            sheetState = connectionSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            val activeProfile = profiles.firstOrNull { it.id == activeProfileId } ?: profiles.firstOrNull()
            Text(
                "Connection",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            activeProfile?.let { profile ->
                Text(
                    profile.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
                Text(
                    profile.endpoint,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
                )
            }
            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant,
                modifier = Modifier.padding(top = 12.dp),
            )
            if (profiles.size > 1) {
                Text(
                    "Saved servers",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                profiles.forEach { profile ->
                    val isActive = profile.id == activeProfileId
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .then(
                                if (!isActive) Modifier.clickable {
                                    scope.launch { connectionSheetState.hide() }.invokeOnCompletion {
                                        showConnectionSheet = false
                                    }
                                    vm.switchProfile(profile.id)
                                } else Modifier
                            )
                            .padding(horizontal = 20.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                profile.name,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                profile.endpoint,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (isActive) {
                            Text(
                                "Active",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                FilledTonalButton(
                    onClick = {
                        scope.launch { connectionSheetState.hide() }.invokeOnCompletion {
                            showConnectionSheet = false
                            onOpenPairingScan()
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.small,
                ) {
                    Icon(
                        Icons.Default.QrCodeScanner,
                        contentDescription = null,
                        modifier = Modifier.padding(end = 8.dp),
                    )
                    Text("Scan new QR code")
                }
                OutlinedButton(
                    onClick = {
                        scope.launch { connectionSheetState.hide() }.invokeOnCompletion {
                            showConnectionSheet = false
                            vm.disconnect()
                        }
                    },
                    enabled = connectionState != ConnectionState.DISCONNECTED,
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text("Disconnect")
                }
            }
            Spacer(Modifier.padding(bottom = 8.dp))
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
                    ConnectionChip(
                        state = connectionState,
                        intentionalRestartExpected = intentionalRestartExpected,
                        onClick = { showConnectionSheet = true },
                    )
                    IconButton(onClick = onOpenArtifacts) {
                        Icon(Icons.Default.Inventory2, contentDescription = "Artifacts")
                    }
                    IconButton(onClick = onOpenCodeChanges) {
                        Icon(Icons.Default.Difference, contentDescription = "Code Changes")
                    }
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
                                text = { Text("Skills") },
                                leadingIcon = { Icon(Icons.Default.Build, contentDescription = null) },
                                onClick = { showOverflowMenu = false; onOpenSkills() },
                            )
                            DropdownMenuItem(
                                text = { Text("Scheduled") },
                                leadingIcon = { Icon(Icons.Default.DateRange, contentDescription = null) },
                                onClick = { showOverflowMenu = false; onOpenScheduled() },
                            )
                        }
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
                        when (selectedTab) {
                            0 -> showNewChatSheet = true
                            1 -> showFabMenu = true
                            2 -> showFabMenu = true
                        }
                    },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    Icon(
                        Icons.Default.Add,
                        contentDescription = when (selectedTab) {
                            0 -> "New Chat"; 1 -> "New Project"; else -> "New Agent"
                        },
                    )
                }
                DropdownMenu(
                    expanded = showFabMenu,
                    onDismissRequest = { showFabMenu = false },
                ) {
                    when (selectedTab) {
                        1 -> {
                            DropdownMenuItem(
                                text = { Text("Add project") },
                                onClick = { showFabMenu = false; showCreateProjectSheet = true },
                            )
                            DropdownMenuItem(
                                text = { Text("Generate project") },
                                onClick = { showFabMenu = false; onOpenProjectGenerator() },
                            )
                        }
                        2 -> {
                            DropdownMenuItem(
                                text = { Text("Add agent") },
                                onClick = { showFabMenu = false; showCreateAgentSheet = true },
                            )
                            DropdownMenuItem(
                                text = { Text("Generate agent") },
                                onClick = { showFabMenu = false; onOpenAgentGenerator() },
                            )
                        }
                    }
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
                    activeConversationIds = activeConversationIds,
                    pendingConversationIds = pendingConversationIds,
                    completedWhileAwayIds = completedWhileAwayIds,
                )
                1 -> ProjectsTab(
                    projects = projects,
                    isRefreshing = isRefreshingProjects,
                    showCreateSheet = showCreateProjectSheet,
                    connectionState = connectionState,
                    highlightProjectId = highlightProjectId,
                    onHighlightConsumed = { vm.clearHighlightProject() },
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
                    highlightAgentId = highlightAgentId,
                    onHighlightConsumed = { vm.clearHighlightAgent() },
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
