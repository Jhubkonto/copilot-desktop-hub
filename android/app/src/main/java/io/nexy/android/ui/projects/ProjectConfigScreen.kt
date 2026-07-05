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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
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
import io.nexy.android.data.model.ProjectAgentEntry
import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.components.NexyExpandableSection
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.launch

private val instructionModeOptions = listOf(
    "prepend" to "Prepend",
    "append" to "Append",
    "replace" to "Replace",
    "standalone" to "Standalone",
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
    onOpenManualWorkflow: () -> Unit = {},
) {
    val projects by WsRepository.projects.collectAsState()
    val allAgents by WsRepository.agents.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    val project = projects.find { it.id == projectId }

    var instructions by remember { mutableStateOf("") }
    var rootDirectory by remember { mutableStateOf("") }
    var instructionMode by remember { mutableStateOf("prepend") }
    var instructionsEnabled by remember { mutableStateOf(true) }
    var orchestrationEnabled by remember { mutableStateOf(false) }
    var maxDelegationDepth by remember { mutableStateOf("5") }
    var showTeamActivity by remember { mutableStateOf(true) }
    var instructionModeExpanded by remember { mutableStateOf(false) }

    // Snapshot variables for dirty-check
    var loadedInstructions by remember { mutableStateOf("") }
    var loadedRootDirectory by remember { mutableStateOf("") }
    var loadedInstructionMode by remember { mutableStateOf("prepend") }
    var loadedInstructionsEnabled by remember { mutableStateOf(true) }
    var loadedOrchestrationEnabled by remember { mutableStateOf(false) }
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
                    orchestrationEnabled = event.config.orchestrationEnabled
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
                    loadedOrchestrationEnabled = event.config.orchestrationEnabled
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
                    loadedOrchestrationEnabled = orchestrationEnabled
                    loadedMaxDelegationDepth = maxDelegationDepth
                    loadedShowTeamActivity = showTeamActivity
                    if (isNew) WsRepository.pendingHighlightProjectId.value = projectId
                    onBack()
                }
                is WsEvent.ProjectAgents -> if (event.id == projectId) {
                    projectAgents.clear()
                    projectAgents.addAll(event.agents)
                }
                else -> {}
            }
        }
    }

    val hasUnsavedChanges = loaded && (
        instructions != loadedInstructions ||
        rootDirectory != loadedRootDirectory ||
        instructionMode != loadedInstructionMode ||
        instructionsEnabled != loadedInstructionsEnabled ||
        orchestrationEnabled != loadedOrchestrationEnabled ||
        maxDelegationDepth != loadedMaxDelegationDepth ||
        showTeamActivity != loadedShowTeamActivity
    )

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
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Add agent to project", style = MaterialTheme.typography.titleMedium)
                if (available.isEmpty()) {
                    Text(
                        "All agents are already in this project.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                } else {
                    available.forEach { agent ->
                        TextButton(
                            onClick = {
                                showAddAgentSheet = false
                                WsRepository.addProjectAgent(projectId, agent.id)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
                TextButton(onClick = { showAddAgentSheet = false }, modifier = Modifier.fillMaxWidth()) {
                    Text("Cancel")
                }
            }
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
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Paths —
            NexyExpandableSection(
                title = "Paths",
                expanded = pathsExpanded,
                onToggle = { pathsExpanded = !pathsExpanded },
            ) {
                Column(modifier = Modifier.padding(bottom = 12.dp)) {
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
                Column(modifier = Modifier.padding(bottom = 12.dp)) {
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
                Column(modifier = Modifier.padding(bottom = 12.dp)) {
                    EditableMilestonesList(
                        rows = milestones,
                        enabled = !saving && !disconnected,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Orchestration —
            NexyExpandableSection(
                title = "Orchestration",
                expanded = orchestrationExpanded,
                onToggle = { orchestrationExpanded = !orchestrationExpanded },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text("Orchestration", style = MaterialTheme.typography.bodyMedium)
                            Text(
                                "Allow a leader agent to delegate tasks to others",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = orchestrationEnabled,
                            onCheckedChange = { if (!saving && !disconnected) orchestrationEnabled = it },
                            enabled = !saving && !disconnected,
                        )
                    }
                    if (orchestrationEnabled) {
                        OutlinedTextField(
                            value = maxDelegationDepth,
                            onValueChange = { maxDelegationDepth = it.filter(Char::isDigit).take(2) },
                            label = { Text("Max delegation depth") },
                            singleLine = true,
                            enabled = !saving && !disconnected,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            modifier = Modifier.fillMaxWidth(),
                        )
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
                            orchestrationEnabled = orchestrationEnabled,
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
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            ) {
                Text(if (saving) "Saving…" else "Save settings")
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

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            // — Wiki & Artifacts quick links (not collapsible) —
            TextButton(
                onClick = onOpenAudit,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("View project changes")
            }

            TextButton(
                onClick = onOpenWiki,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("View project wiki")
            }

            TextButton(
                onClick = onOpenArtifacts,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("View project artifacts")
            }

            TextButton(
                onClick = onOpenManualWorkflow,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Manual workflow generator")
            }
        }
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
