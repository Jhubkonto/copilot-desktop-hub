package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Surface
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpServerWithStatus
import io.nexy.android.data.model.McpToolInfo
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyFormSheet
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpAndCliScreen(onBack: () -> Unit) {
    val connectionState by WsRepository.connectionState.collectAsState()
    val mcpServers by WsRepository.mcpServers.collectAsState()
    val cliStatus by WsRepository.cliStatus.collectAsState()
    val disconnected = connectionState != ConnectionState.CONNECTED

    var showAddSheet by remember { mutableStateOf(false) }
    var editingServer by remember { mutableStateOf<McpServerInfo?>(null) }
    var deleteTarget by remember { mutableStateOf<McpServerInfo?>(null) }
    var serverToStatus by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var tools by remember { mutableStateOf<List<McpToolInfo>>(emptyList()) }
    var showTools by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        WsRepository.getMcpServers()
        WsRepository.getCliStatus()
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

    if (showAddSheet || editingServer != null) {
        McpServerFormSheet(
            server = editingServer,
            onConfirm = { name, command, args, enabled ->
                val existing = editingServer
                if (existing != null) {
                    WsRepository.updateMcpServer(existing.id, name = name, command = command, args = args.split(" ").filter { it.isNotBlank() }, enabled = enabled)
                } else {
                    WsRepository.addMcpServer(name = name, command = command, args = args.split(" ").filter { it.isNotBlank() }, enabled = enabled)
                }
                showAddSheet = false
                editingServer = null
            },
            onDismiss = { showAddSheet = false; editingServer = null },
        )
    }

    val dt = deleteTarget
    if (dt != null) {
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
                titleContent = { Text("MCP Servers & CLI Models", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
        floatingActionButton = {
            if (!disconnected) {
                FloatingActionButton(onClick = { showAddSheet = true }) {
                    Icon(Icons.Default.Add, contentDescription = "Add MCP server")
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            McpCliSectionHeader("CLI Models")

            if (disconnected) {
                Text("Not connected to desktop.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (cliStatus.isEmpty()) {
                Text("Loading…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                cliStatus.entries.toList().sortedBy { it.key }.forEach { (name, info) ->
                    CliStatusCard(name = name, info = info)
                }
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button(onClick = { WsRepository.getCliStatus() }, enabled = !disconnected) { Text("Refresh") }
            }

            McpCliSectionHeader("MCP Servers")

            if (disconnected) {
                Text("Not connected to desktop.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (mcpServers.isEmpty()) {
                Text("No MCP servers configured on the desktop.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                mcpServers.forEach { server ->
                    McpServerCard(
                        server = server,
                        status = serverToStatus[server.id],
                        onEdit = { editingServer = server },
                        onDelete = { deleteTarget = server },
                        onRestart = { WsRepository.restartMcpServer(server.id); WsRepository.getMcpServerStatus(server.id) },
                    )
                }
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { WsRepository.listMcpTools(); showTools = !showTools }, enabled = !disconnected) {
                    Text(if (showTools) "Hide tools" else "Show all tools")
                }
                Button(onClick = { WsRepository.getMcpServers() }, enabled = !disconnected) { Text("Refresh") }
            }

            if (showTools) {
                if (tools.isEmpty()) {
                    Text("No tools available (servers may be disconnected).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    McpCliSectionHeader("Available Tools (${tools.size})")
                    tools.forEach { tool ->
                        McpToolRow(tool)
                    }
                }
            }
        }
    }
}

@Composable
private fun CliStatusCard(name: String, info: CliInstallInfo) {
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                Text(name, style = MaterialTheme.typography.bodyMedium)
                if (info.version != null) Text("v${info.version}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (info.path != null) Text(info.path, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
            Text(
                if (info.installed) "Installed" else "Not installed",
                style = MaterialTheme.typography.labelSmall,
                color = if (info.installed) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun McpServerCard(
    server: McpServerInfo,
    status: String?,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onRestart: () -> Unit,
) {
    val statusColor = when (status) {
        "connected" -> MaterialTheme.colorScheme.primary
        "error" -> MaterialTheme.colorScheme.error
        "connecting" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f).padding(end = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(server.name, style = MaterialTheme.typography.bodyMedium)
                    if (!server.enabled) {
                        Text("disabled", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (server.command.isNotBlank()) Text(server.command, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                if (status != null) Text(status, style = MaterialTheme.typography.labelSmall, color = statusColor)
            }
            Row {
                IconButton(onClick = onRestart) { Icon(Icons.Default.Refresh, contentDescription = "Restart", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                IconButton(onClick = onEdit) { Icon(Icons.Default.Edit, contentDescription = "Edit") }
                IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.error) }
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun McpToolRow(tool: McpToolInfo) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(tool.name, style = MaterialTheme.typography.bodySmall)
            Text(tool.serverName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!tool.description.isNullOrBlank()) {
            Text(tool.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpServerFormSheet(
    server: McpServerInfo?,
    onConfirm: (name: String, command: String, args: String, enabled: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(server?.name ?: "") }
    var command by remember { mutableStateOf(server?.command ?: "") }
    var args by remember { mutableStateOf("") }
    var enabled by remember { mutableStateOf(server?.enabled ?: true) }

    NexyFormSheet(
        title = if (server != null) "Edit MCP Server" else "Add MCP Server",
        confirmLabel = if (server != null) "Save" else "Add",
        onConfirm = { onConfirm(name.trim(), command.trim(), args.trim(), enabled) },
        onDismiss = onDismiss,
        confirmEnabled = name.isNotBlank() && command.isNotBlank(),
    ) {
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Server name") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
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

@Composable
private fun McpCliSectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
