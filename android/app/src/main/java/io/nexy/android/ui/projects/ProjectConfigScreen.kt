package io.nexy.android.ui.projects

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
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
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.foundation.background
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.ProjectAgentEntry
import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NewChatItem
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyExpandableSection
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.settings.SettingsNavRow
import kotlinx.coroutines.launch

private val instructionModeOptions = listOf(
    "prepend" to "Prepend",
    "append" to "Append",
    "replace" to "Replace",
    "standalone" to "Standalone",
)

private val workflowModeOptions = listOf(
    "single-agent" to "Single",
    "automated-delegation" to "Automated",
    "orchestrated" to "Orchestrated",
)

private val instructionModeDescriptions = mapOf(
    "prepend" to "Project instructions come first, before the agent's own system instructions and your message.",
    "append" to "Project instructions are inserted right after the agent's own system instructions, before your message.",
    "replace" to "Project instructions take the place of the agent's own system instructions for chats in this project.",
    "standalone" to "Currently behaves the same as Replace: project instructions take the place of the agent's own system instructions.",
)

private val milestoneStatuses = listOf("upcoming", "active", "completed")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectConfigScreen(
    projectId: String,
    onBack: () -> Unit,
    isNew: Boolean = false,
    onOpenWiki: () -> Unit = {},
    onOpenArtifacts: () -> Unit = {},
    onOpenAudit: () -> Unit = {},
    onOpenAutomatedWorkflow: () -> Unit = {},
) {
    val projects by WsRepository.projects.collectAsState()
    val allAgents by WsRepository.agents.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    val project = projects.find { it.id == projectId }

    var instructions by remember { mutableStateOf("") }
    var rootDirectory by remember { mutableStateOf("") }
    var instructionMode by remember { mutableStateOf("prepend") }
    var instructionsEnabled by remember { mutableStateOf(true) }
    var workflowMode by remember { mutableStateOf("single-agent") }
    var maxDelegationDepth by remember { mutableStateOf("5") }
    var showTeamActivity by remember { mutableStateOf(true) }
    var instructionModeExpanded by remember { mutableStateOf(false) }

    // Snapshot variables for dirty-check
    var loadedInstructions by remember { mutableStateOf("") }
    var loadedRootDirectory by remember { mutableStateOf("") }
    var loadedInstructionMode by remember { mutableStateOf("prepend") }
    var loadedInstructionsEnabled by remember { mutableStateOf(true) }
    var loadedWorkflowMode by remember { mutableStateOf("single-agent") }
    var loadedMaxDelegationDepth by remember { mutableStateOf("5") }
    var loadedShowTeamActivity by remember { mutableStateOf(true) }
    val variables = remember { mutableStateListOf<Map<String, String>>() }
    val inScope = remember { mutableStateListOf<Map<String, String>>() }
    val outOfScope = remember { mutableStateListOf<Map<String, String>>() }
    val milestones = remember { mutableStateListOf<Map<String, String>>() }
    val projectAgents = remember { mutableStateListOf<ProjectAgentEntry>() }
    var showAddAgentSheet by remember { mutableStateOf(false) }

    var loaded by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var showDiscardDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    // Section expand state
    var coreExpanded by rememberSaveable { mutableStateOf(true) }
    var pathsExpanded by rememberSaveable { mutableStateOf(false) }
    var variablesExpanded by rememberSaveable { mutableStateOf(false) }
    var scopeExpanded by rememberSaveable { mutableStateOf(false) }
    var milestonesExpanded by rememberSaveable { mutableStateOf(false) }
    var orchestrationExpanded by rememberSaveable { mutableStateOf(false) }
    var agentsExpanded by rememberSaveable { mutableStateOf(true) }
    var toolsExpanded by rememberSaveable { mutableStateOf(false) }

    val hasUnsavedChanges = loaded && (
        instructions != loadedInstructions ||
        rootDirectory != loadedRootDirectory ||
        instructionMode != loadedInstructionMode ||
        instructionsEnabled != loadedInstructionsEnabled ||
        workflowMode != loadedWorkflowMode ||
        maxDelegationDepth != loadedMaxDelegationDepth ||
        showTeamActivity != loadedShowTeamActivity
    )

    LaunchedEffect(projectId) {
        loaded = false
        WsRepository.getProjectConfig(projectId)
        WsRepository.listProjectAgents(projectId)
    }

    LaunchedEffect(projectId) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.ProjectConfig -> if (event.id == projectId) {
                    instructions = event.config.instructions
                    rootDirectory = event.config.rootDirectory.orEmpty()
                    instructionMode = event.config.instructionMode
                    instructionsEnabled = event.config.instructionsEnabled
                    workflowMode = event.config.workflowMode
                    maxDelegationDepth = event.config.maxDelegationDepth.toString()
                    showTeamActivity = event.config.showTeamActivity
                    variables.replaceWith(event.config.variables)
                    inScope.replaceWith(event.config.inScope)
                    outOfScope.replaceWith(event.config.outOfScope)
                    milestones.replaceWith(event.config.milestones)
                    // Sync snapshots
                    loadedInstructions = event.config.instructions
                    loadedRootDirectory = event.config.rootDirectory.orEmpty()
                    loadedInstructionMode = event.config.instructionMode
                    loadedInstructionsEnabled = event.config.instructionsEnabled
                    loadedWorkflowMode = event.config.workflowMode
                    loadedMaxDelegationDepth = event.config.maxDelegationDepth.toString()
                    loadedShowTeamActivity = event.config.showTeamActivity
                    loaded = true
                }
                is WsEvent.ProjectConfigUpdated -> if (event.id == projectId) {
                    saving = false
                    loadedInstructions = instructions
                    loadedRootDirectory = rootDirectory
                    loadedInstructionMode = instructionMode
                    loadedInstructionsEnabled = instructionsEnabled
                    loadedWorkflowMode = workflowMode
                    loadedMaxDelegationDepth = maxDelegationDepth
                    loadedShowTeamActivity = showTeamActivity
                    if (isNew) WsRepository.pendingHighlightProjectId.value = projectId
                    onBack()
                }
                is WsEvent.ProjectConfigChanged -> if (event.id == projectId && loaded && !hasUnsavedChanges) {
                    // Config changed on another connected client (e.g. desktop). Safe to
                    // silently refresh since there's nothing unsaved here to clobber.
                    WsRepository.getProjectConfig(projectId)
                }
                is WsEvent.ProjectAgents -> if (event.id == projectId) {
                    projectAgents.clear()
                    projectAgents.addAll(event.agents)
                }
                else -> {}
            }
        }
    }

    BackHandler(enabled = hasUnsavedChanges && !showDiscardDialog) {
        showDiscardDialog = true
    }

    if (showDiscardDialog) {
        NexyConfirmDialog(
            title = "Discard changes?",
            message = "You have unsaved changes. Leaving now will discard them.",
            confirmLabel = "Discard",
            onConfirm = { showDiscardDialog = false; onBack() },
            onDismiss = { showDiscardDialog = false },
            destructive = true,
        )
    }

    if (showDeleteDialog) {
        NexyConfirmDialog(
            title = "Delete project?",
            message = "\"${project?.name}\" and its project settings will be deleted locally and synchronized when the desktop is available.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                showDeleteDialog = false
                WsRepository.deleteProject(projectId)
                onBack()
            },
            onDismiss = { showDeleteDialog = false },
        )
    }

    // Project configuration is persisted locally and synchronized later. Team membership still
    // requires the desktop because it controls desktop orchestration identities.
    val disconnected = false
    val desktopDisconnected = connectionState != ConnectionState.CONNECTED
    val instructionModeLabel = instructionModeOptions.find { it.first == instructionMode }?.second ?: "Prepend"

    if (showAddAgentSheet) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        val assignedIds = projectAgents.map { it.agentId }.toSet()
        val available = allAgents.filter { it.id !in assignedIds }
        ModalBottomSheet(
            onDismissRequest = { showAddAgentSheet = false },
            sheetState = sheetState,
        ) {
            AddAgentToProjectSheetContent(
                available = available,
                onSelectAgent = { agent ->
                    showAddAgentSheet = false
                    WsRepository.addProjectAgent(projectId, agent.id)
                },
                onCancel = { showAddAgentSheet = false },
            )
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        project?.name?.let { "Configure: $it" } ?: "Project Settings",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                    )
                },
                onBack = { if (hasUnsavedChanges) showDiscardDialog = true else onBack() },
            )
        },
        bottomBar = {
            if (project != null && loaded) {
                Surface(shadowElevation = 3.dp, modifier = Modifier.navigationBarsPadding()) {
                    Button(
                        onClick = {
                            if (saving || disconnected) return@Button
                            saving = true
                            WsRepository.updateProjectConfig(
                                projectId,
                                ProjectSettingsConfig(
                                    instructions = instructions.trim(),
                                    rootDirectory = rootDirectory.trim().ifBlank { null },
                                    variables = variables.toList(),
                                    instructionMode = instructionMode,
                                    instructionsEnabled = instructionsEnabled,
                                    workflowMode = workflowMode,
                                    orchestrationEnabled = workflowMode == "orchestrated",
                                    maxDelegationDepth = maxDelegationDepth.toIntOrNull()?.coerceIn(1, 10) ?: 5,
                                    showTeamActivity = showTeamActivity,
                                    inScope = inScope.toList(),
                                    outOfScope = outOfScope.toList(),
                                    milestones = milestones.toList(),
                                    defaultModel = null,
                                ),
                            )
                        },
                        enabled = !saving && !disconnected,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Text(if (saving) "Saving…" else "Save settings")
                    }
                }
            }
        },
    ) { padding ->
        if (project == null) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Project not found.", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            NexyConnectionBanner(connectionState)

            // — Core Settings —
            NexyExpandableSection(
                title = "Core Settings",
                expanded = coreExpanded,
                onToggle = { coreExpanded = !coreExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    OutlinedTextField(
                        value = instructions,
                        onValueChange = { instructions = it },
                        label = { Text("Project instructions") },
                        placeholder = { Text("Guidelines appended to every chat in this project") },
                        enabled = !saving && !disconnected,
                        minLines = 4,
                        maxLines = 12,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Enable instructions", style = MaterialTheme.typography.bodyMedium)
                            Text(
                                "Include these instructions in project chats",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = instructionsEnabled,
                            onCheckedChange = { if (!saving && !disconnected) instructionsEnabled = it },
                            enabled = !saving && !disconnected,
                        )
                    }
                    ExposedDropdownMenuBox(
                        expanded = instructionModeExpanded,
                        onExpandedChange = { if (!saving && !disconnected) instructionModeExpanded = it },
                    ) {
                        OutlinedTextField(
                            value = instructionModeLabel,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Instruction mode") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = instructionModeExpanded) },
                            enabled = !saving && !disconnected,
                            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        )
                        ExposedDropdownMenu(
                            expanded = instructionModeExpanded,
                            onDismissRequest = { instructionModeExpanded = false },
                        ) {
                            instructionModeOptions.forEach { (value, label) ->
                                DropdownMenuItem(
                                    text = { Text(label) },
                                    onClick = { instructionMode = value; instructionModeExpanded = false },
                                )
                            }
                        }
                    }
                    Text(
                        instructionModeDescriptions[instructionMode].orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Project Tools —
            NexyExpandableSection(
                title = "Project Tools",
                expanded = toolsExpanded,
                onToggle = { toolsExpanded = !toolsExpanded },
            ) {
                Column(modifier = Modifier.padding(bottom = 12.dp)) {
                    SettingsNavRow(
                        title = "Project changes",
                        detail = "Review edits agents have made to this project's files",
                        onClick = onOpenAudit,
                    )
                    SettingsNavRow(
                        title = "Project wiki",
                        detail = "Notes and knowledge captured for this project",
                        onClick = onOpenWiki,
                    )
                    SettingsNavRow(
                        title = "Project artifacts",
                        detail = "Files and documents generated from chats in this project",
                        onClick = onOpenArtifacts,
                    )
                    SettingsNavRow(
                        title = "Automated workflow generator",
                        detail = "Describe a goal to get an AI-drafted, step-by-step delegation plan that runs itself",
                        onClick = onOpenAutomatedWorkflow,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Paths —
            NexyExpandableSection(
                title = "Paths",
                expanded = pathsExpanded,
                onToggle = { pathsExpanded = !pathsExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "The working directory the desktop CLI/tools use when acting on this project's files. Leave blank to use the global default directory instead.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = rootDirectory,
                        onValueChange = { rootDirectory = it },
                        label = { Text("Root directory (optional)") },
                        placeholder = { Text("e.g. /home/user/my-project") },
                        singleLine = true,
                        enabled = !saving && !disconnected,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Variables —
            NexyExpandableSection(
                title = "Variables",
                expanded = variablesExpanded,
                onToggle = { variablesExpanded = !variablesExpanded },
                badge = variables.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Reusable values you can reference as {{key}} anywhere in this project — in your chat messages, in the project instructions above, and in the automated workflow generator. Nexy substitutes the value automatically before sending.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EditableKeyValueList(
                        rows = variables,
                        keyLabel = "Key",
                        valueLabel = "Value",
                        addLabel = "Add variable",
                        enabled = !saving && !disconnected,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Scope —
            NexyExpandableSection(
                title = "Scope",
                expanded = scopeExpanded,
                onToggle = { scopeExpanded = !scopeExpanded },
                badge = (inScope.size + outOfScope.size).takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Sent to the agent with every chat message in this project. \"In scope\" tells it what to focus on; \"Out of scope\" is a hard instruction not to touch those files or areas.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EditableScopeList(
                        title = "In scope",
                        rows = inScope,
                        addLabel = "Add in-scope rule",
                        enabled = !saving && !disconnected,
                    )
                    EditableScopeList(
                        title = "Out of scope",
                        rows = outOfScope,
                        addLabel = "Add out-of-scope rule",
                        enabled = !saving && !disconnected,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Milestones —
            NexyExpandableSection(
                title = "Milestones",
                expanded = milestonesExpanded,
                onToggle = { milestonesExpanded = !milestonesExpanded },
                badge = milestones.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Track project phases here. Whichever milestone is marked \"active\" is sent to the agent with every chat message, so it stays focused on the current phase.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    EditableMilestonesList(
                        rows = milestones,
                        enabled = !saving && !disconnected,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Workflow mode —
            NexyExpandableSection(
                title = "Workflow mode",
                expanded = orchestrationExpanded,
                onToggle = { orchestrationExpanded = !orchestrationExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Workflow mode", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Choose whether the project runs as a single agent, automated delegation workflow, or full orchestration.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        val canOrchestrate = projectAgents.size >= 2
                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                            workflowModeOptions.forEachIndexed { i, (value, label) ->
                                val optionDisabled = value == "orchestrated" && !canOrchestrate
                                SegmentedButton(
                                    selected = workflowMode == value,
                                    onClick = { if (!saving && !disconnected && !optionDisabled) workflowMode = value },
                                    shape = SegmentedButtonDefaults.itemShape(index = i, count = workflowModeOptions.size),
                                    enabled = !saving && !disconnected && !optionDisabled,
                                ) {
                                    Text(label, style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                        if (!canOrchestrate) {
                            Text(
                                "Add at least two agents to enable orchestration.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        if (workflowMode == "automated-delegation") {
                            Text(
                                "Use the Automated workflow generator (above, under Project Tools) to turn a goal into a reusable delegation plan that runs itself.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (workflowMode == "orchestrated") {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            OutlinedTextField(
                                value = maxDelegationDepth,
                                onValueChange = { maxDelegationDepth = it.filter(Char::isDigit).take(2) },
                                label = { Text("Max delegation depth") },
                                singleLine = true,
                                enabled = !saving && !disconnected,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text(
                                "How many levels deep the leader agent can delegate a task before it must be handled directly (1–10). Higher values allow more sub-delegation but take longer and cost more.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Show team activity", style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    "Show delegated agent activity in chat",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(
                                checked = showTeamActivity,
                                onCheckedChange = { if (!saving && !disconnected) showTeamActivity = it },
                                enabled = !saving && !disconnected,
                            )
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Agents —
            NexyExpandableSection(
                title = "Agents",
                expanded = agentsExpanded,
                onToggle = { agentsExpanded = !agentsExpanded },
                badge = projectAgents.size.takeIf { it > 0 }?.toString(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Text(
                        "Agents assigned to this project. When Orchestration is on, the \"Primary\" agent is the leader that delegates to the others — use \"Set primary\" to change which one leads.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (projectAgents.isEmpty()) {
                        Text(
                            "No agents assigned to this project.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        projectAgents.forEachIndexed { entryIndex, entry ->
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(56.dp)
                                    .background(
                                        if (entry.isPrimary) MaterialTheme.colorScheme.primaryContainer
                                        else MaterialTheme.colorScheme.surface
                                    ),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(
                                    modifier = Modifier
                                        .weight(1f)
                                        .padding(start = 12.dp),
                                    verticalArrangement = Arrangement.Center,
                                ) {
                                    Text(
                                        if (entry.agentIcon.isNotBlank()) "${entry.agentIcon}  ${entry.agentName}" else entry.agentName,
                                        style = MaterialTheme.typography.bodyMedium,
                                        maxLines = 1,
                                    )
                                    if (entry.isPrimary) {
                                        Text(
                                            "Primary",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                                if (!entry.isPrimary && !desktopDisconnected) {
                                    TextButton(
                                        onClick = { WsRepository.setPrimaryProjectAgent(projectId, entry.agentId) },
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                                    ) {
                                        Text("Set primary", style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                                if (!desktopDisconnected) {
                                    IconButton(
                                        onClick = {
                                            if (entryIndex > 0) {
                                                projectAgents.move(entryIndex, entryIndex - 1)
                                                WsRepository.reorderProjectAgents(projectId, projectAgents.map { it.agentId })
                                            }
                                        },
                                        enabled = entryIndex > 0,
                                        modifier = Modifier.size(36.dp),
                                    ) {
                                        Icon(Icons.Default.KeyboardArrowUp, contentDescription = "Move up", modifier = Modifier.size(18.dp))
                                    }
                                    IconButton(
                                        onClick = {
                                            if (entryIndex < projectAgents.lastIndex) {
                                                projectAgents.move(entryIndex, entryIndex + 1)
                                                WsRepository.reorderProjectAgents(projectId, projectAgents.map { it.agentId })
                                            }
                                        },
                                        enabled = entryIndex < projectAgents.lastIndex,
                                        modifier = Modifier.size(36.dp),
                                    ) {
                                        Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Move down", modifier = Modifier.size(18.dp))
                                    }
                                    IconButton(
                                        onClick = { WsRepository.removeProjectAgent(projectId, entry.agentId) },
                                        modifier = Modifier.size(36.dp),
                                    ) {
                                        Icon(Icons.Default.Close, contentDescription = "Remove ${entry.agentName}", modifier = Modifier.size(18.dp))
                                    }
                                }
                            }
                        }
                    }

                    if (!desktopDisconnected) {
                        TextButton(
                            onClick = { showAddAgentSheet = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                            Text("Add agent")
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.error.copy(alpha = 0.3f))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
            ) {
                Icon(Icons.Default.Warning, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.error)
                Text("Danger Zone", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Delete project", style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "Permanently delete this project and its settings.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                    TextButton(onClick = { showDeleteDialog = true }, enabled = !desktopDisconnected) {
                        Text("Delete", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

@Composable
internal fun AddAgentToProjectSheetContent(
    available: List<Agent>,
    onSelectAgent: (Agent) -> Unit,
    onCancel: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val filtered = available.filter { query.isBlank() || it.name.contains(query, ignoreCase = true) }
    Text(
        "Add agent to project",
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
    )
    NexySearchField(query = query, onQueryChange = { query = it }, placeholder = "Search agents…")
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    LazyColumn(modifier = Modifier.fillMaxWidth()) {
        if (filtered.isEmpty()) {
            item {
                Text(
                    if (available.isEmpty()) "All agents are already in this project." else "No results for \"$query\"",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp),
                )
            }
        } else {
            items(filtered, key = { it.id }) { agent ->
                NewChatItem(label = if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name) {
                    onSelectAgent(agent)
                }
            }
        }
        item {
            TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                Text("Cancel")
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

private fun MutableList<Map<String, String>>.replaceWith(next: List<Map<String, String>>) {
    clear()
    addAll(next)
}

private fun <T> MutableList<T>.move(from: Int, to: Int) {
    val item = removeAt(from)
    add(to, item)
}

@Composable
private fun EditableKeyValueList(
    rows: MutableList<Map<String, String>>,
    keyLabel: String,
    valueLabel: String,
    addLabel: String,
    enabled: Boolean,
) {
    if (rows.isEmpty()) {
        Text(
            "No entries.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 4.dp),
        )
    }
    rows.forEachIndexed { index, row ->
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = row["key"].orEmpty(),
                onValueChange = { rows[index] = row + ("key" to it) },
                label = { Text(keyLabel) },
                singleLine = true,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = row["value"].orEmpty(),
                onValueChange = { rows[index] = row + ("value" to it) },
                label = { Text(valueLabel) },
                singleLine = true,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = { rows.removeAt(index) },
                enabled = enabled,
                modifier = Modifier.size(36.dp),
            ) {
                Icon(Icons.Default.Close, contentDescription = "Remove", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    TextButton(
        onClick = { rows.add(mapOf("key" to "", "value" to "")) },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
        Text(addLabel)
    }
}

@Composable
private fun EditableScopeList(
    title: String,
    rows: MutableList<Map<String, String>>,
    addLabel: String,
    enabled: Boolean,
) {
    Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (rows.isEmpty()) {
        Text(
            "No rules.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 4.dp),
        )
    }
    rows.forEachIndexed { index, row ->
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = row["description"].orEmpty(),
                onValueChange = { rows[index] = row + ("description" to it) },
                label = { Text("Description") },
                singleLine = true,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = row["pathGlob"].orEmpty(),
                onValueChange = { rows[index] = row + ("pathGlob" to it) },
                label = { Text("Glob") },
                singleLine = true,
                enabled = enabled,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = { rows.removeAt(index) },
                enabled = enabled,
                modifier = Modifier.size(36.dp),
            ) {
                Icon(Icons.Default.Close, contentDescription = "Remove", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    TextButton(
        onClick = { rows.add(mapOf("id" to rows.size.toString(), "description" to "", "pathGlob" to "")) },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
        Text(addLabel)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditableMilestonesList(
    rows: MutableList<Map<String, String>>,
    enabled: Boolean,
) {
    if (rows.isEmpty()) {
        Text(
            "No milestones.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 4.dp),
        )
    }
    rows.forEachIndexed { index, row ->
        val currentStatus = row["status"].orEmpty().ifBlank { "upcoming" }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(
                    value = row["title"].orEmpty(),
                    onValueChange = { rows[index] = row + ("title" to it) },
                    label = { Text("Title") },
                    singleLine = true,
                    enabled = enabled,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = row["description"].orEmpty(),
                    onValueChange = { rows[index] = row + ("description" to it) },
                    label = { Text("Description (optional)") },
                    singleLine = true,
                    enabled = enabled,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth(),
                )
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    milestoneStatuses.forEachIndexed { i, status ->
                        SegmentedButton(
                            selected = currentStatus == status,
                            onClick = { rows[index] = row + ("status" to status) },
                            shape = SegmentedButtonDefaults.itemShape(index = i, count = milestoneStatuses.size),
                            enabled = enabled,
                        ) {
                            Text(status, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
            IconButton(
                onClick = { rows.removeAt(index) },
                enabled = enabled,
                modifier = Modifier.size(36.dp).align(Alignment.Top),
            ) {
                Icon(Icons.Default.Close, contentDescription = "Remove milestone", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    TextButton(
        onClick = { rows.add(mapOf("id" to rows.size.toString(), "title" to "", "description" to "", "status" to "upcoming")) },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
        Text("Add milestone")
    }
}
