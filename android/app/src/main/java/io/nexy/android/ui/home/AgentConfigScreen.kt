package io.nexy.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import io.nexy.android.data.model.AgentCustomCommand
import io.nexy.android.data.model.SkillConfig
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

private val thinkingEffortOptions = listOf(
    null to "Provider default",
    "disabled" to "Disabled",
    "low" to "Low",
    "medium" to "Medium",
    "high" to "High",
    "max" to "Max",
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
    val skills by WsRepository.skills.collectAsState()
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
    var thinkingEffort by remember { mutableStateOf<String?>(null) }
    var thinkingEffortMenuExpanded by remember { mutableStateOf(false) }
    // Tools
    var fileEditEnabled by remember { mutableStateOf(true) }
    var fileEditApproval by remember { mutableStateOf("always-ask") }
    var fileEditApprovalExpanded by remember { mutableStateOf(false) }
    var fileEditInstructions by remember { mutableStateOf("") }
    var terminalEnabled by remember { mutableStateOf(false) }
    var terminalApproval by remember { mutableStateOf("always-ask") }
    var terminalApprovalExpanded by remember { mutableStateOf(false) }
    var terminalInstructions by remember { mutableStateOf("") }
    var webFetchEnabled by remember { mutableStateOf(true) }
    var webFetchApproval by remember { mutableStateOf("never-ask") }
    var webFetchApprovalExpanded by remember { mutableStateOf(false) }
    var webFetchInstructions by remember { mutableStateOf("") }
    // Skills
    var attachedSkillIds by remember { mutableStateOf<List<String>>(emptyList()) }
    // Context
    var rootDirectory by remember { mutableStateOf("") }
    var contextDirectories by remember { mutableStateOf<List<String>>(emptyList()) }
    var contextFiles by remember { mutableStateOf<List<String>>(emptyList()) }
    // Context rules
    var ignoredGlobs by remember { mutableStateOf<List<String>>(emptyList()) }
    var autoInjectWorkspace by remember { mutableStateOf(true) }
    var autoInjectGit by remember { mutableStateOf(true) }
    // Custom commands
    var customCommands by remember { mutableStateOf<List<AgentCustomCommand>>(emptyList()) }

    var saving by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    // Request full config on entry
    LaunchedEffect(agentId) {
        WsRepository.agentFullConfig.value = null
        WsRepository.requestAgentFull(agentId)
        WsRepository.listSkills()
        WsRepository.getSkillAgentLinks(agentId)
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
        thinkingEffort = c.thinkingEffort
        fileEditEnabled = c.tools.fileEdit.enabled
        fileEditApproval = c.tools.fileEdit.approval
        fileEditInstructions = c.tools.fileEdit.instructions
        terminalEnabled = c.tools.terminal.enabled
        terminalApproval = c.tools.terminal.approval
        terminalInstructions = c.tools.terminal.instructions
        webFetchEnabled = c.tools.webFetch.enabled
        webFetchApproval = c.tools.webFetch.approval
        webFetchInstructions = c.tools.webFetch.instructions
        rootDirectory = c.rootDirectory ?: ""
        contextDirectories = c.contextDirectories
        contextFiles = c.contextFiles
        ignoredGlobs = c.contextRules?.ignoredGlobs ?: emptyList()
        autoInjectWorkspace = c.contextRules?.autoInjectWorkspace ?: true
        autoInjectGit = c.contextRules?.autoInjectGit ?: true
        customCommands = c.customCommands
    }

    // Listen for save confirmation and skill links
    LaunchedEffect(agentId) {
        WsRepository.events.collect { event ->
            when {
                event is WsEvent.AgentUpdated && event.agent.id == agentId -> {
                    saving = false
                    scope.launch { snackbarHostState.showSnackbar("Agent saved.") }
                }
                event is WsEvent.SkillAgentLinks && event.agentId == agentId -> {
                    attachedSkillIds = event.links.sortedBy { it.sortOrder }.map { it.skillId }
                }
            }
        }
    }

    val disconnected = connectionState != ConnectionState.CONNECTED
    val loaded = fullConfig != null
    val backendLabel = backendOptions.find { it.first == backend }?.second ?: "Default (BYOK providers)"
    val responseFormatLabel = responseFormatOptions.find { it.first == responseFormat }?.second ?: "Default"
    val thinkingEffortLabel = thinkingEffortOptions.find { it.first == thinkingEffort }?.second ?: "Provider default"

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

            ExposedDropdownMenuBox(
                expanded = thinkingEffortMenuExpanded,
                onExpandedChange = { if (!saving && !disconnected) thinkingEffortMenuExpanded = it },
            ) {
                OutlinedTextField(
                    value = thinkingEffortLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Thinking effort") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = thinkingEffortMenuExpanded) },
                    enabled = !saving && !disconnected,
                    modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                )
                ExposedDropdownMenu(
                    expanded = thinkingEffortMenuExpanded,
                    onDismissRequest = { thinkingEffortMenuExpanded = false },
                ) {
                    thinkingEffortOptions.forEach { (value, label) ->
                        DropdownMenuItem(
                            text = { Text(label) },
                            onClick = {
                                thinkingEffort = value
                                thinkingEffortMenuExpanded = false
                            },
                        )
                    }
                }
            }

            // — Tools —
            SectionHeader("Tools")

            ToolCard(
                name = "File Edit",
                description = "Read and modify files",
                enabled = fileEditEnabled,
                approval = fileEditApproval,
                approvalExpanded = fileEditApprovalExpanded,
                instructions = fileEditInstructions,
                disabled = saving || disconnected,
                onEnabledChange = { fileEditEnabled = it },
                onApprovalChange = { fileEditApproval = it },
                onApprovalExpandedChange = { fileEditApprovalExpanded = it },
                onInstructionsChange = { fileEditInstructions = it },
            )

            ToolCard(
                name = "Terminal",
                description = "Run shell commands",
                enabled = terminalEnabled,
                approval = terminalApproval,
                approvalExpanded = terminalApprovalExpanded,
                instructions = terminalInstructions,
                disabled = saving || disconnected,
                onEnabledChange = { terminalEnabled = it },
                onApprovalChange = { terminalApproval = it },
                onApprovalExpandedChange = { terminalApprovalExpanded = it },
                onInstructionsChange = { terminalInstructions = it },
            )

            ToolCard(
                name = "Web Fetch",
                description = "Fetch URLs and browse the web",
                enabled = webFetchEnabled,
                approval = webFetchApproval,
                approvalExpanded = webFetchApprovalExpanded,
                instructions = webFetchInstructions,
                disabled = saving || disconnected,
                onEnabledChange = { webFetchEnabled = it },
                onApprovalChange = { webFetchApproval = it },
                onApprovalExpandedChange = { webFetchApprovalExpanded = it },
                onInstructionsChange = { webFetchInstructions = it },
            )

            // — Skills —
            SectionHeader("Skills")

            SkillAttachmentsSection(
                skills = skills,
                attachedSkillIds = attachedSkillIds,
                disabled = saving || disconnected,
                onRefresh = {
                    WsRepository.listSkills()
                    WsRepository.getSkillAgentLinks(agentId)
                },
                onToggleSkill = { skillId, attach ->
                    WsRepository.attachSkillToAgent(agentId, skillId, attach)
                },
                onMoveSkill = { skillId, direction ->
                    val current = attachedSkillIds.toMutableList()
                    val index = current.indexOf(skillId)
                    val target = index + direction
                    if (index >= 0 && target in current.indices) {
                        current.removeAt(index)
                        current.add(target, skillId)
                        attachedSkillIds = current
                        WsRepository.reorderSkillsForAgent(agentId, current)
                    }
                },
            )

            // — Context —
            SectionHeader("Context")

            OutlinedTextField(
                value = rootDirectory,
                onValueChange = { rootDirectory = it },
                label = { Text("Root directory") },
                placeholder = { Text("Absolute path (optional)") },
                singleLine = true,
                enabled = !saving && !disconnected,
                modifier = Modifier.fillMaxWidth(),
            )

            StringListEditor(
                label = "Context directories",
                items = contextDirectories,
                placeholder = "e.g. /path/to/dir",
                disabled = saving || disconnected,
                onItemsChange = { contextDirectories = it },
            )

            StringListEditor(
                label = "Context files",
                items = contextFiles,
                placeholder = "e.g. /path/to/file.txt",
                disabled = saving || disconnected,
                onItemsChange = { contextFiles = it },
            )

            // — Context rules —
            SectionHeader("Context rules")

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("Auto-inject workspace", style = MaterialTheme.typography.bodyMedium)
                    Text("Include workspace file tree in context", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = autoInjectWorkspace, onCheckedChange = { if (!saving && !disconnected) autoInjectWorkspace = it }, enabled = !saving && !disconnected)
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("Auto-inject git status", style = MaterialTheme.typography.bodyMedium)
                    Text("Include git status summary in context", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = autoInjectGit, onCheckedChange = { if (!saving && !disconnected) autoInjectGit = it }, enabled = !saving && !disconnected)
            }

            StringListEditor(
                label = "Ignored globs",
                items = ignoredGlobs,
                placeholder = "e.g. **/*.log",
                disabled = saving || disconnected,
                onItemsChange = { ignoredGlobs = it },
            )

            // — Custom commands —
            SectionHeader("Custom commands")

            CustomCommandsEditor(
                commands = customCommands,
                disabled = saving || disconnected,
                onCommandsChange = { customCommands = it },
            )

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            Button(
                onClick = {
                    if (name.isBlank() || saving || disconnected) return@Button
                    saving = true
                    val maxTokens = maxTokensText.trim().toIntOrNull()?.coerceIn(256, 128000) ?: 8192
                    val tools = mapOf(
                        "fileEdit" to mapOf("enabled" to fileEditEnabled, "approval" to fileEditApproval, "instructions" to fileEditInstructions),
                        "terminal" to mapOf("enabled" to terminalEnabled, "approval" to terminalApproval, "instructions" to terminalInstructions),
                        "webFetch" to mapOf("enabled" to webFetchEnabled, "approval" to webFetchApproval, "instructions" to webFetchInstructions),
                    )
                    val contextRulesPayload = mapOf(
                        "ignoredGlobs" to ignoredGlobs,
                        "autoInjectWorkspace" to autoInjectWorkspace,
                        "autoInjectGit" to autoInjectGit,
                    )
                    val customCommandsPayload = customCommands.map {
                        mapOf("name" to it.name, "description" to it.description, "prompt" to it.prompt)
                    }
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
                        if (thinkingEffort != null) put("thinkingEffort", thinkingEffort!!) else put("thinkingEffort", "")
                        put("rootDirectory", rootDirectory.trim())
                        put("contextDirectories", contextDirectories)
                        put("contextFiles", contextFiles)
                        put("contextRules", contextRulesPayload)
                        put("customCommands", customCommandsPayload)
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
    instructions: String,
    disabled: Boolean,
    onEnabledChange: (Boolean) -> Unit,
    onApprovalChange: (String) -> Unit,
    onApprovalExpandedChange: (Boolean) -> Unit,
    onInstructionsChange: (String) -> Unit,
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
                OutlinedTextField(
                    value = instructions,
                    onValueChange = { if (!disabled) onInstructionsChange(it) },
                    label = { Text("Instructions (optional)") },
                    placeholder = { Text("Additional guidance for this tool") },
                    enabled = !disabled,
                    minLines = 2,
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun StringListEditor(
    label: String,
    items: List<String>,
    placeholder: String,
    disabled: Boolean,
    onItemsChange: (List<String>) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            IconButton(
                onClick = { onItemsChange(items + "") },
                enabled = !disabled,
            ) {
                Icon(Icons.Default.Add, contentDescription = "Add $label")
            }
        }
        items.forEachIndexed { index, item ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                OutlinedTextField(
                    value = item,
                    onValueChange = { newVal ->
                        val updated = items.toMutableList()
                        updated[index] = newVal
                        onItemsChange(updated)
                    },
                    placeholder = { Text(placeholder) },
                    singleLine = true,
                    enabled = !disabled,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = {
                        val updated = items.toMutableList()
                        updated.removeAt(index)
                        onItemsChange(updated)
                    },
                    enabled = !disabled,
                ) {
                    Icon(Icons.Default.Delete, contentDescription = "Remove", tint = MaterialTheme.colorScheme.error)
                }
            }
        }
        if (items.isEmpty()) {
            Text("None", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun CustomCommandsEditor(
    commands: List<AgentCustomCommand>,
    disabled: Boolean,
    onCommandsChange: (List<AgentCustomCommand>) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (commands.isEmpty()) "No custom commands" else "${commands.size} command(s)",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            IconButton(
                onClick = { onCommandsChange(commands + AgentCustomCommand(name = "", description = "", prompt = "")) },
                enabled = !disabled,
            ) {
                Icon(Icons.Default.Add, contentDescription = "Add command")
            }
        }
        commands.forEachIndexed { index, cmd ->
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
                        Text("Command ${index + 1}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        IconButton(
                            onClick = {
                                val updated = commands.toMutableList()
                                updated.removeAt(index)
                                onCommandsChange(updated)
                            },
                            enabled = !disabled,
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Remove command", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                    OutlinedTextField(
                        value = cmd.name,
                        onValueChange = { newVal ->
                            val updated = commands.toMutableList()
                            updated[index] = cmd.copy(name = newVal)
                            onCommandsChange(updated)
                        },
                        label = { Text("Name") },
                        placeholder = { Text("e.g. /review") },
                        singleLine = true,
                        enabled = !disabled,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = cmd.description,
                        onValueChange = { newVal ->
                            val updated = commands.toMutableList()
                            updated[index] = cmd.copy(description = newVal)
                            onCommandsChange(updated)
                        },
                        label = { Text("Description") },
                        singleLine = true,
                        enabled = !disabled,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = cmd.prompt,
                        onValueChange = { newVal ->
                            val updated = commands.toMutableList()
                            updated[index] = cmd.copy(prompt = newVal)
                            onCommandsChange(updated)
                        },
                        label = { Text("Prompt") },
                        enabled = !disabled,
                        minLines = 3,
                        maxLines = 8,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun SkillAttachmentsSection(
    skills: List<SkillConfig>,
    attachedSkillIds: List<String>,
    disabled: Boolean,
    onRefresh: () -> Unit,
    onToggleSkill: (skillId: String, attach: Boolean) -> Unit,
    onMoveSkill: (skillId: String, direction: Int) -> Unit,
) {
    if (skills.isEmpty()) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(8.dp),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("No skills available.", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "Create skills from the Skills screen, then attach them here.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = onRefresh, enabled = !disabled) { Text("Refresh") }
            }
        }
        return
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            if (attachedSkillIds.isEmpty()) "No skills attached." else "${attachedSkillIds.size} skill(s) attached.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val orderedSkills = skills.sortedWith(compareBy<SkillConfig> {
            val index = attachedSkillIds.indexOf(it.id)
            if (index == -1) Int.MAX_VALUE else index
        }.thenBy { it.name.lowercase() })
        orderedSkills.forEach { skill ->
            SkillAttachmentRow(
                skill = skill,
                attached = attachedSkillIds.contains(skill.id),
                canMoveUp = attachedSkillIds.indexOf(skill.id) > 0,
                canMoveDown = attachedSkillIds.indexOf(skill.id).let { it >= 0 && it < attachedSkillIds.lastIndex },
                disabled = disabled,
                onToggle = { onToggleSkill(skill.id, it) },
                onMoveUp = { onMoveSkill(skill.id, -1) },
                onMoveDown = { onMoveSkill(skill.id, 1) },
            )
        }
    }
}

@Composable
private fun SkillAttachmentRow(
    skill: SkillConfig,
    attached: Boolean,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
    disabled: Boolean,
    onToggle: (Boolean) -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (attached) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(skill.icon.ifBlank { "*" }, style = MaterialTheme.typography.titleMedium)
                    Column(modifier = Modifier.weight(1f)) {
                        Text(skill.name, style = MaterialTheme.typography.bodyMedium)
                        if (skill.description.isNotBlank()) {
                            Text(
                                skill.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = if (attached) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                            )
                        }
                    }
                }
                Switch(
                    checked = attached,
                    onCheckedChange = { if (!disabled) onToggle(it) },
                    enabled = !disabled,
                )
            }
            if (attached) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = onMoveUp, enabled = !disabled && canMoveUp) { Text("Move up") }
                    TextButton(onClick = onMoveDown, enabled = !disabled && canMoveDown) { Text("Move down") }
                }
            }
        }
    }
}
