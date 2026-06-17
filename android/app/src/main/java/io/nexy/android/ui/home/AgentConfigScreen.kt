package io.nexy.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.launch

private val backendOptions = listOf(
    null to "Default (BYOK providers)",
    "claude-cli" to "Claude CLI",
    "codex-cli" to "Codex CLI",
    "gh-copilot" to "GitHub Copilot",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentConfigScreen(
    agentId: String,
    onBack: () -> Unit,
) {
    val agents by WsRepository.agents.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    val agent = agents.find { it.id == agentId }

    var name by remember(agent?.name) { mutableStateOf(agent?.name ?: "") }
    var icon by remember(agent?.icon) { mutableStateOf(agent?.icon ?: "") }
    var systemPrompt by remember { mutableStateOf("") }
    var backend by remember(agent?.backend) { mutableStateOf(agent?.backend) }
    var cliModel by remember(agent?.cliModel) { mutableStateOf(agent?.cliModel ?: "") }
    var backendMenuExpanded by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(agentId) {
        WsRepository.events.collect { event ->
            if (event is WsEvent.AgentUpdated && event.agent.id == agentId) {
                saving = false
                scope.launch { snackbarHostState.showSnackbar("Agent saved.") }
            }
        }
    }

    val disconnected = connectionState != ConnectionState.CONNECTED
    val backendLabel = backendOptions.find { it.first == backend }?.second ?: "Default (BYOK providers)"

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        agent?.let {
                            if (it.icon.isNotBlank()) "${it.icon}  ${it.name}" else it.name
                        } ?: "Agent Config",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                    )
                },
                onBack = onBack,
            )
        },
    ) { padding ->
        if (agent == null) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Agent not found.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onBack) { Text("Go back") }
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (disconnected) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text(
                        "Not connected to desktop. Changes cannot be saved.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }

            Text("Identity", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = icon,
                    onValueChange = { icon = it },
                    label = { Text("Icon") },
                    singleLine = true,
                    enabled = !saving && !disconnected,
                    modifier = Modifier.weight(0.28f),
                )
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    enabled = !saving && !disconnected,
                    modifier = Modifier.weight(0.72f),
                )
            }

            Text("Behaviour", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            OutlinedTextField(
                value = systemPrompt,
                onValueChange = { systemPrompt = it },
                label = { Text("System prompt") },
                placeholder = { Text("Leave blank to keep the current prompt unchanged") },
                enabled = !saving && !disconnected,
                minLines = 5,
                maxLines = 12,
                modifier = Modifier.fillMaxWidth(),
            )

            Text("Backend", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            ExposedDropdownMenuBox(
                expanded = backendMenuExpanded,
                onExpandedChange = { if (!saving && !disconnected) backendMenuExpanded = it },
            ) {
                OutlinedTextField(
                    value = backendLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Backend") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = backendMenuExpanded) },
                    enabled = !saving && !disconnected,
                    modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                )
                ExposedDropdownMenu(
                    expanded = backendMenuExpanded,
                    onDismissRequest = { backendMenuExpanded = false },
                ) {
                    backendOptions.forEach { (value, label) ->
                        DropdownMenuItem(
                            text = { Text(label) },
                            onClick = {
                                backend = value
                                backendMenuExpanded = false
                            },
                        )
                    }
                }
            }

            if (backend != null) {
                OutlinedTextField(
                    value = cliModel,
                    onValueChange = { cliModel = it },
                    label = { Text("CLI model (optional)") },
                    placeholder = { Text("e.g. claude-sonnet-4-6") },
                    singleLine = true,
                    enabled = !saving && !disconnected,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            Button(
                onClick = {
                    if (name.isBlank() || saving || disconnected) return@Button
                    saving = true
                    val data = buildMap<String, Any> {
                        put("id", agentId)
                        put("name", name.trim())
                        put("icon", icon.trim())
                        if (systemPrompt.isNotBlank()) put("systemPrompt", systemPrompt.trim())
                        if (backend != null) put("backend", backend!!) else put("backend", "")
                        put("cliModel", cliModel.trim())
                    }
                    WsRepository.send("agent:update", data)
                },
                enabled = name.isNotBlank() && !saving && !disconnected,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (saving) "Saving…" else "Save changes")
            }
        }
    }
}
