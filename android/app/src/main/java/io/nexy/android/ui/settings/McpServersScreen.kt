package io.nexy.android.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import io.nexy.android.ui.theme.NexySurfaceShape as RectangleShape
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpToolInfo
import io.nexy.android.data.model.McpCatalogEntry
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyFormSheet
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpServersScreen(onBack: () -> Unit) {
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val mcpServers by WsRepository.mcpServers.collectAsStateWithLifecycle()
    val mcpCatalog by WsRepository.mcpCatalog.collectAsStateWithLifecycle()
    val disconnected = connectionState != ConnectionState.CONNECTED

    var showAddSheet by remember { mutableStateOf(false) }
    var editingServer by remember { mutableStateOf<McpServerInfo?>(null) }
    var deleteTarget by remember { mutableStateOf<McpServerInfo?>(null) }
    var serverToStatus by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var tools by remember { mutableStateOf<List<McpToolInfo>>(emptyList()) }
    var showTools by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        WsRepository.getMcpServers()
        WsRepository.getMcpCatalog()
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.McpServerAdded -> WsRepository.getMcpServers()
                is WsEvent.McpServerUpdated -> {
                    serverToStatus = serverToStatus + (event.server.id to event.server.status)
                    WsRepository.getMcpServers()
                }
                is WsEvent.McpServerRemoved -> Unit
                is WsEvent.McpServerStatus -> serverToStatus = serverToStatus + (event.id to event.status)
                is WsEvent.McpToolList -> tools = event.tools
                else -> {}
            }
        }
    }

    if (showAddSheet) {
        McpAddWizard(
            catalog = mcpCatalog,
            onConfirm = { name, command, args, env, imageResponses, enabled ->
                WsRepository.addMcpServer(name = name, command = command, args = args, env = env, imageResponses = imageResponses, enabled = enabled)
                showAddSheet = false
            },
            onDismiss = { showAddSheet = false },
        )
    }
    if (editingServer != null) {
        McpEditSheet(
            server = editingServer!!,
            onConfirm = { name, command, args, enabled ->
                val existing = editingServer!!
                WsRepository.updateMcpServer(existing.id, name = name, command = command, args = args.split(" ").filter { it.isNotBlank() }, enabled = enabled)
                editingServer = null
            },
            onDismiss = { editingServer = null },
        )
    }
    if (showTools) {
        McpToolsSheet(
            tools = tools,
            onDismiss = { showTools = false },
        )
    }
    deleteTarget?.let { dt ->
        NexyConfirmDialog(
            title = "Remove MCP server?",
            message = "\"${dt.name}\" will be removed from the desktop.",
            confirmLabel = "Remove",
            destructive = true,
            onConfirm = { WsRepository.removeMcpServer(dt.id); deleteTarget = null },
            onDismiss = { deleteTarget = null },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("MCP Servers", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
        floatingActionButton = {
            if (!disconnected) {
                FloatingActionButton(
                    onClick = { showAddSheet = true },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    NexyIcon(NexyIconName.Add, contentDescription = "Add MCP server")
                }
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
            contentPadding = PaddingValues(top = 16.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (disconnected) {
                item {
                    NexyEmptyState(
                        title = "Not connected to desktop",
                        detail = "Connect to manage MCP servers.",
                        modifier = Modifier.padding(vertical = 32.dp),
                    )
                }
            } else {
                item {
                    McpOverviewCard(
                        serverCount = mcpServers.size,
                        connectedCount = mcpServers.count { serverToStatus[it.id] == "connected" },
                        toolCount = tools.size,
                        onBrowseTools = {
                            WsRepository.listMcpTools()
                            showTools = true
                        },
                        onRefresh = { WsRepository.getMcpServers() },
                    )
                }

                item {
                    McpSectionHeader(
                        title = "Configured servers",
                        detail = if (mcpServers.isEmpty()) "Add a server to give agents more capabilities." else "Manage connections and launch settings.",
                    )
                }

                if (mcpServers.isEmpty()) {
                    item {
                        NexyEmptyState(
                            title = "No MCP servers yet",
                            detail = "Tap + to start with a curated server or add your own.",
                            modifier = Modifier.padding(vertical = 16.dp),
                        )
                    }
                } else {
                    items(mcpServers, key = { it.id }) { server ->
                        McpServerRow(
                            server = server,
                            status = serverToStatus[server.id],
                            toolCount = tools.count { it.serverId == server.id },
                            onEdit = { editingServer = server },
                            onDelete = { deleteTarget = server },
                            onRestart = { WsRepository.restartMcpServer(server.id); WsRepository.getMcpServerStatus(server.id) },
                        )
                    }
                }

                item {
                    McpToolsLauncher(
                        toolCount = tools.size,
                        onClick = {
                            WsRepository.listMcpTools()
                            showTools = true
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun McpOverviewCard(
    serverCount: Int,
    connectedCount: Int,
    toolCount: Int,
    onBrowseTools: () -> Unit,
    onRefresh: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RectangleShape,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("MCP workspace", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Servers add capabilities that agents can use.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                NexyStatusBadge(
                    label = if (connectedCount > 0) "Online" else "Ready",
                    containerColor = if (connectedCount > 0) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = if (connectedCount > 0) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                McpMetric(value = serverCount.toString(), label = "servers", modifier = Modifier.weight(1f))
                McpMetric(value = connectedCount.toString(), label = "connected", modifier = Modifier.weight(1f))
                McpMetric(value = toolCount.toString(), label = "tools", modifier = Modifier.weight(1f))
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NexyPrimaryButton(
                    text = if (toolCount > 0) "Browse tools" else "Discover tools",
                    onClick = onBrowseTools,
                    modifier = Modifier.weight(1f),
                )
                NexySecondaryButton(
                    text = "Refresh",
                    onClick = onRefresh,
                    leadingNexyIcon = NexyIconName.Refresh,
                )
            }
        }
    }
}

@Composable
private fun McpMetric(value: String, label: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RectangleShape,
    ) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun McpSectionHeader(title: String, detail: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun McpToolsLauncher(toolCount: Int, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        shape = RectangleShape,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RectangleShape,
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    NexyIcon(NexyIconName.Tool, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Tool library", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(
                    if (toolCount > 0) "$toolCount available tools, grouped by server" else "Discover tools exposed by your servers",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            NexyIcon(NexyIconName.ChevronRight, contentDescription = "Browse tools", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun McpStatusBadge(status: String) {
    val (label, color) = when (status) {
        "connected" -> "Connected" to MaterialTheme.colorScheme.primary
        "error" -> "Error" to MaterialTheme.colorScheme.error
        "connecting" -> "Connecting…" to MaterialTheme.colorScheme.tertiary
        else -> status.replaceFirstChar { it.uppercase() } to MaterialTheme.colorScheme.onSurfaceVariant
    }
    NexyStatusBadge(label = label, containerColor = color.copy(alpha = 0.15f), contentColor = color)
}

@Composable
internal fun McpServerRow(
    server: McpServerInfo,
    status: String?,
    toolCount: Int = 0,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onRestart: () -> Unit,
) {
    var showMenu by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RectangleShape,
    ) {
        Column(
            modifier = Modifier.padding(start = 16.dp, top = 14.dp, end = 8.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(
                        server.name,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (status != null) McpStatusBadge(status)
                        if (!server.enabled) {
                            NexyStatusBadge(
                                label = "Off",
                                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (toolCount > 0) {
                            Text(
                                "$toolCount tools",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                Box {
                    IconButton(onClick = { showMenu = true }) {
                        NexyIcon(NexyIconName.More, contentDescription = "Server options", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                        DropdownMenuItem(
                            text = { Text("Edit") },
                            leadingIcon = { NexyIcon(NexyIconName.Edit, contentDescription = null) },
                            onClick = { showMenu = false; onEdit() },
                        )
                        DropdownMenuItem(
                            text = { Text("Restart") },
                            leadingIcon = { NexyIcon(NexyIconName.Refresh, contentDescription = null) },
                            onClick = { showMenu = false; onRestart() },
                        )
                        DropdownMenuItem(
                            text = { Text("Remove", color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { NexyIcon(NexyIconName.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                            onClick = { showMenu = false; onDelete() },
                        )
                    }
                }
            }
            if (server.command.isNotBlank()) {
                Text(
                    server.command,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

@Composable
internal fun McpToolEntry(tool: McpToolInfo) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RectangleShape,
            modifier = Modifier.size(32.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                NexyIcon(NexyIconName.Tool, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                tool.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            tool.description?.takeIf { it.isNotBlank() }?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(
            tool.serverName,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpToolsSheet(
    tools: List<McpToolInfo>,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    val filteredTools = remember(tools, query) {
        val normalizedQuery = query.trim()
        if (normalizedQuery.isBlank()) tools else tools.filter { tool ->
            listOf(tool.name, tool.description.orEmpty(), tool.serverName)
                .any { value -> value.contains(normalizedQuery, ignoreCase = true) }
        }
    }
    val groupedTools = remember(filteredTools) {
        filteredTools.groupBy { it.serverId to it.serverName }.toList()
    }
    var expandedServerId by remember(groupedTools) {
        mutableStateOf(groupedTools.singleOrNull()?.first?.first)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 300.dp, max = 680.dp)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Tool library", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Browse tools by server, or search across all connections.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text("${filteredTools.size}", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            }

            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Search tools") },
                placeholder = { Text("e.g. screenshot, read, browser") },
                singleLine = true,
                leadingIcon = { NexyIcon(NexyIconName.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
            )

            if (filteredTools.isEmpty()) {
                NexyEmptyState(
                    title = if (tools.isEmpty()) "No tools available" else "No matching tools",
                    detail = if (tools.isEmpty()) "Connect a server to discover its tools." else "Try a different name or server.",
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    groupedTools.forEach { (serverKey, serverTools) ->
                        val (serverId, serverName) = serverKey
                        val expanded = expandedServerId == serverId || query.isNotBlank()
                        item(key = "header:$serverId") {
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        expandedServerId = if (expandedServerId == serverId) null else serverId
                                    },
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                                shape = RectangleShape,
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 14.dp, vertical = 11.dp),
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Surface(
                                        color = MaterialTheme.colorScheme.primaryContainer,
                                        shape = RectangleShape,
                                        modifier = Modifier.size(30.dp),
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            NexyIcon(NexyIconName.Tool, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                                        }
                                    }
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(serverName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                        Text(
                                            "${serverTools.size} tool${if (serverTools.size == 1) "" else "s"}",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    NexyIcon(
                                        if (expanded) NexyIconName.ChevronDown else NexyIconName.ChevronRight,
                                        contentDescription = if (expanded) "Collapse $serverName" else "Expand $serverName",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                        if (expanded) {
                            items(serverTools, key = { "tool:$serverId:${it.name}" }) { tool ->
                                Card(
                                    modifier = Modifier.fillMaxWidth(),
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                    shape = RectangleShape,
                                ) {
                                    McpToolEntry(tool)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private enum class McpAddType(val label: String, val description: String) {
    Npm("npm package", "Run an MCP server published as an npm package via npx"),
    LocalScript("Local script", "Run a script or binary already installed on the desktop"),
    Docker("Docker container", "Run an MCP server inside a Docker container"),
    Manual("Manual / advanced", "Enter the command and arguments yourself"),
}

@Composable
private fun McpCatalogCard(entry: McpCatalogEntry, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RectangleShape,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(entry.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                if (entry.requiredEnv.isNotEmpty()) {
                    NexyStatusBadge(
                        label = "Needs key",
                        containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                    )
                }
            }
            Text(entry.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                entry.category.replaceFirstChar { it.uppercase() },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpAddWizard(
    catalog: List<McpCatalogEntry>,
    onConfirm: (name: String, command: String, args: List<String>, env: Map<String, String>, imageResponses: String?, enabled: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current
    var step by remember { mutableIntStateOf(0) }
    var catalogBrowse by remember { mutableStateOf(true) }
    var catalogQuery by remember { mutableStateOf("") }
    var selectedCatalog by remember { mutableStateOf<McpCatalogEntry?>(null) }
    var selectedType by remember { mutableStateOf<McpAddType?>(null) }
    var name by remember { mutableStateOf("") }
    var npmPackage by remember { mutableStateOf("") }
    var npmExtraArgs by remember { mutableStateOf("") }
    var scriptPath by remember { mutableStateOf("") }
    var scriptArgs by remember { mutableStateOf("") }
    var dockerImage by remember { mutableStateOf("") }
    var dockerArgs by remember { mutableStateOf("") }
    var manualCommand by remember { mutableStateOf("") }
    var manualArgs by remember { mutableStateOf("") }
    var requiredEnvValues by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var enabled by remember { mutableStateOf(true) }

    fun chooseCatalog(entry: McpCatalogEntry) {
        selectedCatalog = entry
        name = entry.name
        requiredEnvValues = entry.requiredEnv.associate { it.key to entry.env[it.key].orEmpty() }
        enabled = true
        val packageIndex = if (entry.args.firstOrNull() == "-y") 1 else 0
        val packageName = entry.args.getOrNull(packageIndex).orEmpty()
        if (entry.command == "npx" && packageName.isNotBlank()) {
            selectedType = McpAddType.Npm
            npmPackage = packageName
            npmExtraArgs = entry.args.drop(packageIndex + 1).joinToString(" ")
        } else {
            selectedType = McpAddType.Manual
            manualCommand = entry.command
            manualArgs = entry.args.joinToString(" ")
        }
        step = 1
    }

    fun buildCommandAndArgs(): Pair<String, List<String>> = when (selectedType) {
        McpAddType.Npm -> {
            val extra = npmExtraArgs.trim().split(" ").filter { it.isNotBlank() }
            "npx" to (listOf("-y", npmPackage.trim()) + extra)
        }
        McpAddType.LocalScript -> {
            val parts = scriptPath.trim().split(" ").filter { it.isNotBlank() }
            val cmd = parts.firstOrNull() ?: ""
            cmd to (parts.drop(1) + scriptArgs.trim().split(" ").filter { it.isNotBlank() })
        }
        McpAddType.Docker -> {
            val extra = dockerArgs.trim().split(" ").filter { it.isNotBlank() }
            "docker" to (listOf("run", "--rm", "-i", dockerImage.trim()) + extra)
        }
        McpAddType.Manual -> {
            manualCommand.trim() to manualArgs.trim().split(" ").filter { it.isNotBlank() }
        }
        null -> "" to emptyList()
    }

    val (previewCommand, previewArgs) = buildCommandAndArgs()
    val previewFull = if (previewCommand.isBlank()) "" else (listOf(previewCommand) + previewArgs).joinToString(" ")

    // Without this, system/gesture back dismisses the whole sheet (losing the in-progress form)
    // from any step instead of stepping back one wizard page like the sheet's own "Back" button.
    BackHandler(enabled = step > 0) { step -= 1 }

    val step2Valid = when (selectedType) {
        McpAddType.Npm -> name.isNotBlank() && npmPackage.isNotBlank()
        McpAddType.LocalScript -> name.isNotBlank() && scriptPath.isNotBlank()
        McpAddType.Docker -> name.isNotBlank() && dockerImage.isNotBlank()
        McpAddType.Manual -> name.isNotBlank() && manualCommand.isNotBlank()
        null -> false
    } && (selectedCatalog?.requiredEnv?.all { requiredEnvValues[it.key].orEmpty().isNotBlank() } ?: true)

    val filteredCatalog = catalog.filter { entry ->
        val query = catalogQuery.trim().lowercase()
        if (query.isBlank()) true else {
            val haystack = listOf(entry.name, entry.description, entry.category) + entry.keywords
            query.split(Regex("\\s+")).all { term -> haystack.any { it.contains(term, ignoreCase = true) } }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = when (step) {
                        0 -> if (catalogBrowse) "Add server — Choose a capability" else "Add server — Custom server"
                        1 -> "Add server — Configure"
                        else -> "Add server — Review"
                    },
                    style = MaterialTheme.typography.titleSmall,
                )
                NexyGhostButton(text = "Cancel", onClick = onDismiss)
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            when (step) {
                0 -> {
                    if (catalogBrowse) {
                        Text(
                            "Start with what you want the agent to do. The command and arguments are filled in for you.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedTextField(
                            value = catalogQuery,
                            onValueChange = { catalogQuery = it },
                            label = { Text("Search capabilities") },
                            placeholder = { Text("e.g. GitHub, browser, files") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (filteredCatalog.isEmpty()) {
                            Text("No curated servers match that search.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            filteredCatalog.forEach { entry ->
                                McpCatalogCard(entry = entry, onClick = { chooseCatalog(entry) })
                            }
                        }
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selectedCatalog = null
                                    selectedType = null
                                    catalogBrowse = false
                                },
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                            shape = RectangleShape,
                        ) {
                            Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("Custom server", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                Text("Use your own command, local script, or Docker image.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    } else {
                        Text("Choose how your custom server runs.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        McpAddType.entries.forEach { type ->
                            val selected = selectedType == type
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { selectedType = type },
                                border = BorderStroke(
                                    width = if (selected) 2.dp else 1.dp,
                                    color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                                ),
                                colors = CardDefaults.cardColors(
                                    containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                                ),
                                shape = RectangleShape,
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 16.dp, vertical = 12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(type.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                        Text(type.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    if (selected) NexyIcon(NexyIconName.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            NexyGhostButton(text = "Back to catalog", onClick = { catalogBrowse = true })
                            NexyPrimaryButton(text = "Next", onClick = { step = 1 }, enabled = selectedType != null)
                        }
                    }
                }

                1 -> {
                    OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Server name") }, placeholder = { Text("e.g. Filesystem") }, singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true), modifier = Modifier.fillMaxWidth())
                    when (selectedType) {
                        McpAddType.Npm -> {
                            OutlinedTextField(value = npmPackage, onValueChange = { npmPackage = it }, label = { Text("npm package") }, placeholder = { Text("e.g. @modelcontextprotocol/server-filesystem") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(value = npmExtraArgs, onValueChange = { npmExtraArgs = it }, label = { Text("Extra arguments (optional)") }, placeholder = { Text("e.g. /Users/me/projects") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            Text("Runs: npx -y <package> [args]", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        McpAddType.LocalScript -> {
                            OutlinedTextField(value = scriptPath, onValueChange = { scriptPath = it }, label = { Text("Script or binary path") }, placeholder = { Text("e.g. /usr/local/bin/mcp-server") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(value = scriptArgs, onValueChange = { scriptArgs = it }, label = { Text("Arguments (optional)") }, placeholder = { Text("e.g. /path/to/script.py") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        }
                        McpAddType.Docker -> {
                            OutlinedTextField(value = dockerImage, onValueChange = { dockerImage = it }, label = { Text("Docker image") }, placeholder = { Text("e.g. mcp/filesystem:latest") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(value = dockerArgs, onValueChange = { dockerArgs = it }, label = { Text("Extra docker run arguments (optional)") }, placeholder = { Text("e.g. -v /host:/container") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            Text("Runs: docker run --rm -i <image> [args]", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        McpAddType.Manual -> {
                            OutlinedTextField(value = manualCommand, onValueChange = { manualCommand = it }, label = { Text("Command") }, placeholder = { Text("e.g. npx") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(value = manualArgs, onValueChange = { manualArgs = it }, label = { Text("Arguments (space-separated)") }, placeholder = { Text("e.g. -y @modelcontextprotocol/server-github") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        }
                        null -> {}
                    }
                    selectedCatalog?.requiredEnv?.takeIf { it.isNotEmpty() }?.let { requirements ->
                        Text("Credentials", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text("These values are sent to the desktop only as server environment variables.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        requirements.forEach { requirement ->
                            OutlinedTextField(
                                value = requiredEnvValues[requirement.key].orEmpty(),
                                onValueChange = { value -> requiredEnvValues = requiredEnvValues + (requirement.key to value) },
                                label = { Text(requirement.label) },
                                placeholder = { Text(requirement.key) },
                                singleLine = true,
                                visualTransformation = if (requirement.secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            requirement.helpUrl?.let { helpUrl ->
                                Text(
                                    "How to get one",
                                    modifier = Modifier.clickable {
                                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(helpUrl)))
                                    },
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Enable on save", style = MaterialTheme.typography.bodyMedium)
                        Switch(checked = enabled, onCheckedChange = { enabled = it })
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        NexyGhostButton(text = "Back", onClick = { step = 0 })
                        NexyPrimaryButton(text = "Review", onClick = { step = 2 }, enabled = step2Valid)
                    }
                }

                else -> {
                    Text("Review your configuration:", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RectangleShape,
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            ReviewRow("Name", name)
                            ReviewRow("Type", selectedType?.label ?: "")
                            ReviewRow("Enabled", if (enabled) "Yes" else "No")
                            selectedCatalog?.requiredEnv?.takeIf { it.isNotEmpty() }?.let {
                                ReviewRow("Credentials", "${it.size} value(s) provided")
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 4.dp))
                            Text("Command:", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                previewFull.ifBlank { "(none)" },
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        NexyGhostButton(text = "Back", onClick = { step = 1 })
                        NexyPrimaryButton(
                            text = "Add server",
                            onClick = {
                                val env = (selectedCatalog?.env.orEmpty() + requiredEnvValues).filterValues { it.isNotBlank() }
                                onConfirm(name.trim(), previewCommand, previewArgs, env, selectedCatalog?.imageResponses, enabled)
                            },
                            enabled = previewCommand.isNotBlank() && step2Valid,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("$label:", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpEditSheet(
    server: McpServerInfo,
    onConfirm: (name: String, command: String, args: String, enabled: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(server.name) }
    var command by remember { mutableStateOf(server.command) }
    var args by remember { mutableStateOf("") }
    var enabled by remember { mutableStateOf(server.enabled) }

    NexyFormSheet(
        title = "Edit MCP Server",
        confirmLabel = "Save",
        onConfirm = { onConfirm(name.trim(), command.trim(), args.trim(), enabled) },
        onDismiss = onDismiss,
        confirmEnabled = name.isNotBlank() && command.isNotBlank(),
    ) {
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Server name") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true))
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = command, onValueChange = { command = it }, label = { Text("Command") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = args, onValueChange = { args = it }, label = { Text("Arguments (space-separated)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Enabled", style = MaterialTheme.typography.bodyMedium)
            Switch(checked = enabled, onCheckedChange = { enabled = it })
        }
    }
}
