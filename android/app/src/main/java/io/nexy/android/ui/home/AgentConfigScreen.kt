package io.nexy.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ToolConfig
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private val backendOptions = listOf(
    null to "Default (BYOK providers)",
    "claude-cli" to "Claude CLI",
    "codex-cli" to "Codex CLI",
    "gh-copilot" to "GitHub Copilot",
)

private val responseFormatOptions = listOf(
    "default" to "Default",
    "concise" to "Concise",
    "detailed" to "Detailed",
    "code-only" to "Code only",
)

private val approvalOptions = listOf(
    "auto" to "Auto",
    "always-ask" to "Always ask",
    "disabled" to "Disabled",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentConfigScreen(
    agentId: String,
    onBack: () -> Unit,
) {
    val agents by WsRepository.agents.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    val fullConfig by WsRepository.agentFullConfig.collectAsState()
    val agent = agents.find { it.id == agentId }

    // Identity
    var name by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf("") }
    // Behaviour
    var systemPrompt by remember { mutableStateOf("") }
    var memory by remember { mutableStateOf("") }
    var agenticMode by remember { mutableStateOf(false) }
    // Backend
    var backend by remember { mutableStateOf<String?>(null) }
    var cliModel by remember { mutableStateOf("") }
    var backendMenuExpanded by remember { mutableStateOf(false) }
    // Generation
    var responseFormat by remember { mutableStateOf("default") }
    var responseFormatMenuExpanded by remember { mutableStateOf(false) }
    var temperature by remember { mutableFloatStateOf(0.7f) }
    var maxTokensText by remember { mutableStateOf("8192") }
    // Tools
    var fileEditEnabled by remember { mutableStateOf(true) }
    var fileEditApproval by remember { mutableStateOf("always-ask") }
    var fileEditApprovalExpanded by remember { mutableStateOf(false) }
    var terminalEnabled by remember { mutableStateOf(false) }
    var terminalApproval by remember { mutableStateOf("always-ask") }
    var terminalApprovalExpanded by remember { mutableStateOf(false) }
    var webFetchEnabled by remember { mutableStateOf(true) }
    var webFetchApproval by remember { mutableStateOf("never-ask") }
    var webFetchApprovalExpanded by remember { mutableStateOf(false) }

    var saving by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    // Request full config on entry
    LaunchedEffect(agentId) {
        WsRepository.agentFullConfig.value = null
        WsRepository.requestAgentFull(agentId)
    }

    // Populate fields when full config arrives
    LaunchedEffect(fullConfig) {
        val c = fullConfig ?: return@LaunchedEffect
        name = c.name
        icon = c.icon
        systemPrompt = c.systemPrompt
        memory = c.memory
        agenticMode = c.agenticMode
        backend = c.backend
        cliModel = c.cliModel ?: ""
        responseFormat = c.responseFormat
        temperature = c.temperature
        maxTokensText = c.maxTokens.toString()
        fileEditEnabled = c.tools.fileEdit.enabled
        fileEditApproval = c.tools.fileEdit.approval
        terminalEnabled = c.tools.terminal.enabled
        terminalApproval = c.tools.terminal.approval
        webFetchEnabled = c.tools.webFetch.enabled
        webFetchApproval = c.tools.webFetch.approval
    }

    // Listen for save confirmation
    LaunchedEffect(agentId) {
        WsRepository.events.collect { event ->
            if (event is WsEvent.AgentUpdated && event.agent.id == agentId) {
                saving = false
                scope.launch { snackbarHostState.showSnackbar("Agent saved.") }
            }
        }
    }

    val disconnected = connectionState != ConnectionState.CONNECTED
    val loaded = fullConfig != null
    val backendLabel = backendOptions.find { it.first == backend }?.second ?: "Default (BYOK providers)"
    val responseFormatLabel = responseFormatOptions.find { it.first == responseFormat }?.second ?: "Default"

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

        if (!loaded) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
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

            // — Identity —
            SectionHeader("Identity")

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

            // — Backend —
            SectionHeader("Backend")

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

            // — Behaviour —
            SectionHeader("Behaviour")

            OutlinedTextField(
                value = systemPrompt,
                onValueChange = { systemPrompt = it },
                label = { Text("System prompt") },
                enabled = !saving && !disconnected,
                minLines = 4,
                maxLines = 12,
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = memory,
                onValueChange = { memory = it },
                label = { Text("Memory") },
                placeholder = { Text("Always appended to system prompt") },
                enabled = !saving && !disconnected,
                minLines = 3,
                maxLines = 8,
                modifier = Modifier.fillMaxWidth(),
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("Agentic mode", style = MaterialTheme.typography.bodyMedium)
                    Text("Allow autonomous multi-step actions", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = agenticMode, onCheckedChange = { if (!saving && !disconnected) agenticMode = it }, enabled = !saving && !disconnected)
            }

            // — Generation —
            SectionHeader("Generation")

            ExposedDropdownMenuBox(
                expanded = responseFormatMenuExpanded,
                onExpandedChange = { if (!saving && !disconnected) responseFormatMenuExpanded = it },
            ) {
                OutlinedTextField(
                    value = responseFormatLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Response format") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = responseFormatMenuExpanded) },
                    enabled = !saving && !disconnected,
                    modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                )
                ExposedDropdownMenu(
                    expanded = responseFormatMenuExpanded,
                    onDismissRequest = { responseFormatMenuExpanded = false },
                ) {
                    responseFormatOptions.forEach { (value, label) ->
                        DropdownMenuItem(
                            text = { Text(label) },
                            onClick = {
                                responseFormat = value
                                responseFormatMenuExpanded = false
                            },
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Temperature", style = MaterialTheme.typography.bodyMedium)
                    Text("%.2f".format(temperature), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                }
                Slider(
                    value = temperature,
                    onValueChange = { if (!saving && !disconnected) temperature = (it * 20).roundToInt() / 20f },
                    valueRange = 0f..1f,
                    steps = 19,
                    enabled = !saving && !disconnected,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Precise", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Creative", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            OutlinedTextField(
                value = maxTokensText,
                onValueChange = { maxTokensText = it },
                label = { Text("Max tokens") },
                placeholder = { Text("256 – 128000") },
                singleLine = true,
                enabled = !saving && !disconnected,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )

            // — Tools —
            SectionHeader("Tools")

            ToolCard(
                name = "File Edit",
                description = "Read and modify files",
                enabled = fileEditEnabled,
                approval = fileEditApproval,
                approvalExpanded = fileEditApprovalExpanded,
                disabled = saving || disconnected,
                onEnabledChange = { fileEditEnabled = it },
                onApprovalChange = { fileEditApproval = it },
                onApprovalExpandedChange = { fileEditApprovalExpanded = it },
            )

            ToolCard(
                name = "Terminal",
                description = "Run shell commands",
                enabled = terminalEnabled,
                approval = terminalApproval,
                approvalExpanded = terminalApprovalExpanded,
                disabled = saving || disconnected,
                onEnabledChange = { terminalEnabled = it },
                onApprovalChange = { terminalApproval = it },
                onApprovalExpandedChange = { terminalApprovalExpanded = it },
            )

            ToolCard(
                name = "Web Fetch",
                description = "Fetch URLs and browse the web",
                enabled = webFetchEnabled,
                approval = webFetchApproval,
                approvalExpanded = webFetchApprovalExpanded,
                disabled = saving || disconnected,
                onEnabledChange = { webFetchEnabled = it },
                onApprovalChange = { webFetchApproval = it },
                onApprovalExpandedChange = { webFetchApprovalExpanded = it },
            )

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            Button(
                onClick = {
                    if (name.isBlank() || saving || disconnected) return@Button
                    saving = true
                    val maxTokens = maxTokensText.trim().toIntOrNull()?.coerceIn(256, 128000) ?: 8192
                    val tools = mapOf(
                        "fileEdit" to mapOf("enabled" to fileEditEnabled, "approval" to fileEditApproval),
                        "terminal" to mapOf("enabled" to terminalEnabled, "approval" to terminalApproval),
                        "webFetch" to mapOf("enabled" to webFetchEnabled, "approval" to webFetchApproval),
                    )
                    val data = buildMap<String, Any> {
                        put("id", agentId)
                        put("name", name.trim())
                        put("icon", icon.trim())
                        put("systemPrompt", systemPrompt.trim())
                        put("memory", memory.trim())
                        put("agenticMode", agenticMode)
                        if (backend != null) put("backend", backend!!) else put("backend", "")
                        put("cliModel", cliModel.trim())
                        put("responseFormat", responseFormat)
                        put("temperature", temperature)
                        put("maxTokens", maxTokens)
                        put("tools", tools)
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

@Composable
private fun SectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ToolCard(
    name: String,
    description: String,
    enabled: Boolean,
    approval: String,
    approvalExpanded: Boolean,
    disabled: Boolean,
    onEnabledChange: (Boolean) -> Unit,
    onApprovalChange: (String) -> Unit,
    onApprovalExpandedChange: (Boolean) -> Unit,
) {
    val approvalLabel = approvalOptions.find { it.first == approval }?.second ?: "Always ask"
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
                Column {
                    Text(name, style = MaterialTheme.typography.bodyMedium)
                    Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = enabled, onCheckedChange = { if (!disabled) onEnabledChange(it) }, enabled = !disabled)
            }
            if (enabled) {
                ExposedDropdownMenuBox(
                    expanded = approvalExpanded,
                    onExpandedChange = { if (!disabled) onApprovalExpandedChange(it) },
                ) {
                    OutlinedTextField(
                        value = approvalLabel,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Approval") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = approvalExpanded) },
                        enabled = !disabled,
                        modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                    )
                    ExposedDropdownMenu(
                        expanded = approvalExpanded,
                        onDismissRequest = { onApprovalExpandedChange(false) },
                    ) {
                        approvalOptions.forEach { (value, label) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = {
                                    onApprovalChange(value)
                                    onApprovalExpandedChange(false)
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}
