package io.nexy.android.ui.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpToolInfo
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyFormSheet
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyListRow
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpServersScreen(onBack: () -> Unit) {
    val connectionState by WsRepository.connectionState.collectAsState()
    val mcpServers by WsRepository.mcpServers.collectAsState()
    val disconnected = connectionState != ConnectionState.CONNECTED

    var showAddSheet by remember { mutableStateOf(false) }
    var editingServer by remember { mutableStateOf<McpServerInfo?>(null) }
    var deleteTarget by remember { mutableStateOf<McpServerInfo?>(null) }
    var serverToStatus by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var tools by remember { mutableStateOf<List<McpToolInfo>>(emptyList()) }
    var showTools by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        WsRepository.getMcpServers()
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
            onConfirm = { name, command, args, enabled ->
                WsRepository.addMcpServer(name = name, command = command, args = args, enabled = enabled)
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
                    Icon(Icons.Default.Add, contentDescription = "Add MCP server")
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            if (disconnected) {
                NexyEmptyState(
                    title = "Not connected to desktop",
                    detail = "Connect to manage MCP servers.",
                    modifier = Modifier.padding(vertical = 32.dp),
                )
            } else if (mcpServers.isEmpty()) {
                NexyEmptyState(
                    title = "No MCP servers",
                    detail = "MCP servers extend your agents with additional tools. Tap + to add one.",
                    modifier = Modifier.padding(vertical = 40.dp),
                )
            } else {
                mcpServers.forEach { server ->
                    McpServerRow(
                        server = server,
                        status = serverToStatus[server.id],
                        onEdit = { editingServer = server },
                        onDelete = { deleteTarget = server },
                        onRestart = { WsRepository.restartMcpServer(server.id); WsRepository.getMcpServerStatus(server.id) },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }

            if (!disconnected) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    NexyGhostButton(
                        text = if (showTools) "Hide tools" else "Show tools (${tools.size})",
                        onClick = {
                            WsRepository.listMcpTools()
                            showTools = !showTools
                        },
                    )
                    NexySecondaryButton(
                        text = "Refresh",
                        onClick = { WsRepository.getMcpServers() },
                        leadingIcon = Icons.Default.Refresh,
                    )
                }

                if (showTools) {
                    if (tools.isEmpty()) {
                        Text(
                            "No tools available — servers may be disconnected.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    } else {
                        Text(
                            "Available tools (${tools.size})",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                        tools.forEach { tool ->
                            McpToolEntry(tool)
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
            }

            // bottom padding for FAB
            Spacer(Modifier.height(80.dp))
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
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onRestart: () -> Unit,
) {
    var showMenu by remember { mutableStateOf(false) }

    NexyListRow(
        title = server.name,
        subtitleContent = {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (status != null) McpStatusBadge(status)
                    if (!server.enabled) {
                        NexyStatusBadge(
                            label = "Off",
                            containerColor = MaterialTheme.colorScheme.surfaceVariant,
                            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (server.command.isNotBlank()) {
                    Text(
                        server.command,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
        },
        trailing = {
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = "Server options", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                    DropdownMenuItem(
                        text = { Text("Edit") },
                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                        onClick = { showMenu = false; onEdit() },
                    )
                    DropdownMenuItem(
                        text = { Text("Restart") },
                        leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = null) },
                        onClick = { showMenu = false; onRestart() },
                    )
                    DropdownMenuItem(
                        text = { Text("Remove", color = MaterialTheme.colorScheme.error) },
                        leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                        onClick = { showMenu = false; onDelete() },
                    )
                }
            }
        },
    )
}

@Composable
internal fun McpToolEntry(tool: McpToolInfo) {
    NexyListRow(
        title = tool.name,
        subtitle = tool.description?.takeIf { it.isNotBlank() },
        trailing = { Text(tool.serverName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) },
    )
}

private enum class McpAddType(val label: String, val description: String) {
    Npm("npm package", "Run an MCP server published as an npm package via npx"),
    LocalScript("Local script", "Run a script or binary already installed on the desktop"),
    Docker("Docker container", "Run an MCP server inside a Docker container"),
    Manual("Manual / advanced", "Enter the command and arguments yourself"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun McpAddWizard(
    onConfirm: (name: String, command: String, args: List<String>, enabled: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var step by remember { mutableIntStateOf(0) }
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
    var enabled by remember { mutableStateOf(true) }

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

    val step2Valid = when (selectedType) {
        McpAddType.Npm -> name.isNotBlank() && npmPackage.isNotBlank()
        McpAddType.LocalScript -> name.isNotBlank() && scriptPath.isNotBlank()
        McpAddType.Docker -> name.isNotBlank() && dockerImage.isNotBlank()
        McpAddType.Manual -> name.isNotBlank() && manualCommand.isNotBlank()
        null -> false
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
                        0 -> "Add server — Choose type"
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
                            shape = RoundedCornerShape(8.dp),
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
                                if (selected) Icon(Icons.Default.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        NexyPrimaryButton(text = "Next", onClick = { step = 1 }, enabled = selectedType != null)
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
                        shape = RoundedCornerShape(8.dp),
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
                            onClick = { onConfirm(name.trim(), previewCommand, previewArgs, enabled) },
                            enabled = previewCommand.isNotBlank(),
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
