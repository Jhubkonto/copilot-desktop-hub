package io.nexy.android.ui.scheduler

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AutomatedWorkflowRunInfo
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar
import org.json.JSONArray
import org.json.JSONObject

private val SCHEDULE_TYPES = listOf("daily", "weekdays", "weekly", "monthly", "one-time")
private val WEEKDAYS = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
private val NOTIFICATION_PREFS = listOf("always", "failures_only", "off")
private val TARGET_TYPES = listOf("chat" to "Standalone task", "automated_workflow" to "Automated Workflow")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SchedulerTaskConfigScreen(
    taskId: String?,
    onBack: () -> Unit,
    viewModel: SchedulerViewModel = viewModel(),
) {
    val isEdit = taskId != null
    val tasks by viewModel.tasks.collectAsStateWithLifecycle()
    val initial = remember(taskId, tasks) { tasks.firstOrNull { it.id == taskId } }

    val agents = WsRepository.agents.collectAsStateWithLifecycle().value
    val projects = WsRepository.projects.collectAsStateWithLifecycle().value
    val connectionState = WsRepository.connectionState.collectAsStateWithLifecycle().value
    val isConnected = connectionState == io.nexy.android.data.ConnectionState.CONNECTED

    var name by rememberSaveable(initial) { mutableStateOf(initial?.name ?: "") }
    var prompt by rememberSaveable(initial) { mutableStateOf(initial?.prompt ?: "") }
    var scheduleType by rememberSaveable(initial) { mutableStateOf(initial?.scheduleType ?: "daily") }
    var localTime by rememberSaveable(initial) { mutableStateOf(initial?.localTime ?: "09:00") }
    var weekday by rememberSaveable(initial) { mutableIntStateOf(initial?.weekday ?: 1) }
    var monthDay by rememberSaveable(initial) { mutableIntStateOf(initial?.monthDay ?: 1) }
    var timezone by rememberSaveable(initial) { mutableStateOf(initial?.timezone ?: java.util.TimeZone.getDefault().id) }
    var agentId by rememberSaveable(initial) { mutableStateOf(initial?.agentId ?: "") }
    var projectId by rememberSaveable(initial) { mutableStateOf(initial?.projectId ?: "") }
    var model by rememberSaveable(initial) { mutableStateOf(initial?.model ?: "") }
    var notificationPref by rememberSaveable(initial) { mutableStateOf(initial?.notificationPref ?: "failures_only") }
    var nameError by remember { mutableStateOf<String?>(null) }

    // Tool policy: a scheduled run is headless, so the desktop blocks any tool not pre-approved
    // here. Without this a tool-using agent silently can't call any of its tools when it fires.
    val preApproved = remember(initial) {
        mutableStateListOf<String>().apply { initial?.toolPolicy?.preApproved?.let { addAll(it) } }
    }
    val agentTools = remember { mutableStateListOf<io.nexy.android.data.model.McpToolInfo>() }

    // Target: a plain chat prompt (default, unchanged behavior) or one attached Automated
    // Workflow run (see src/roadmap-new/ — schedules can target a saved workflow instead of a
    // chat message).
    var targetType by rememberSaveable(initial) { mutableStateOf(initial?.targetType ?: "chat") }
    val workflowOptions = remember { mutableStateListOf<AutomatedWorkflowRunInfo>() }
    var selectedRunId by rememberSaveable(initial) { mutableStateOf(initial?.workflowSpecs?.firstOrNull()?.sourceRunId ?: "") }
    var selectedRunDetail by remember { mutableStateOf<AutomatedWorkflowRunInfo?>(null) }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.SchedulerWorkflowTemplates -> {
                    workflowOptions.clear()
                    workflowOptions.addAll(event.runs)
                }
                is WsEvent.AutomatedWorkflowRunDetailReady -> {
                    if (event.run != null && event.run.id == selectedRunId) selectedRunDetail = event.run
                }
                is WsEvent.McpToolList -> {
                    if (event.agentId == agentId) {
                        agentTools.clear()
                        agentTools.addAll(event.tools)
                    }
                }
                else -> {}
            }
        }
    }

    LaunchedEffect(agentId, targetType) {
        agentTools.clear()
        if (targetType == "chat" && agentId.isNotBlank()) {
            WsRepository.listMcpToolsForAgent(agentId)
        }
    }

    LaunchedEffect(targetType) {
        if (targetType == "automated_workflow" && workflowOptions.isEmpty()) {
            WsRepository.schedulerListWorkflowTemplates()
        }
    }

    LaunchedEffect(selectedRunId) {
        if (selectedRunId.isNotBlank() && selectedRunDetail?.id != selectedRunId) {
            WsRepository.getAutomatedWorkflowRun(selectedRunId)
        }
    }

    fun buildWorkflowSpecJson(detail: AutomatedWorkflowRunInfo): String {
        val stepsArr = JSONArray()
        detail.steps.forEach { step ->
            stepsArr.put(
                JSONObject().apply {
                    put("id", step.id)
                    put("title", step.title)
                    put("summary", step.summary)
                    step.agentId?.let { put("agentId", it) }
                    step.agentName?.let { put("agentName", it) }
                    step.model?.let { put("model", it) }
                    put("prompt", step.prompt)
                    put("expectedOutput", step.expectedOutput)
                    if (step.dependsOnStepIds.isNotEmpty()) put("dependsOnStepIds", JSONArray(step.dependsOnStepIds))
                },
            )
        }
        return JSONObject().apply {
            put("title", detail.title)
            put("goalSummary", detail.goalSummary)
            put("assumptions", JSONArray(detail.assumptions))
            put("steps", stepsArr)
        }.toString()
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        if (isEdit) "Edit Task" else "New Task",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                    )
                },
                onBack = onBack,
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!isConnected) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Filled.WifiOff,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            "Offline — changes cannot be saved until reconnected.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
            }
            Spacer(Modifier.height(4.dp))

            OutlinedTextField(
                value = name,
                onValueChange = { name = it; nameError = null },
                label = { Text("Name") },
                isError = nameError != null,
                supportingText = nameError?.let { { Text(it) } },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
            )

            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                TARGET_TYPES.forEachIndexed { i, (value, label) ->
                    SegmentedButton(
                        selected = targetType == value,
                        onClick = { targetType = value },
                        shape = SegmentedButtonDefaults.itemShape(index = i, count = TARGET_TYPES.size),
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                    }
                }
            }

            if (targetType == "chat") {
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    label = { Text("Prompt") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 4,
                    maxLines = 8,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                )
            } else {
                DropdownField(
                    label = "Automated workflow to attach",
                    options = listOf("") + workflowOptions.map { it.id },
                    selected = selectedRunId,
                    onSelect = { selectedRunId = it; selectedRunDetail = null },
                    display = { id ->
                        if (id.isEmpty()) "Select a saved workflow…"
                        else workflowOptions.firstOrNull { it.id == id }?.title ?: id
                    },
                )
                Text(
                    "Attaches a copy of that workflow's current steps — later edits to the original plan won't affect this schedule. Each firing runs the plan through automatically (no per-step review).",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            DropdownField(
                label = "Schedule type",
                options = SCHEDULE_TYPES,
                selected = scheduleType,
                onSelect = { scheduleType = it },
                display = { it.replace('-', ' ').replaceFirstChar { c -> c.uppercase() } },
            )

            OutlinedTextField(
                value = localTime,
                onValueChange = { localTime = it },
                label = { Text("Time (HH:MM)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text("09:00") },
            )

            if (scheduleType == "weekly") {
                DropdownField(
                    label = "Day of week",
                    options = WEEKDAYS.indices.toList(),
                    selected = weekday,
                    onSelect = { weekday = it },
                    display = { WEEKDAYS.getOrElse(it) { "?" } },
                )
            }

            if (scheduleType == "monthly") {
                OutlinedTextField(
                    value = monthDay.toString(),
                    onValueChange = { monthDay = it.toIntOrNull()?.coerceIn(1, 31) ?: 1 },
                    label = { Text("Day of month (1–31)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
            }

            OutlinedTextField(
                value = timezone,
                onValueChange = { timezone = it },
                label = { Text("Timezone") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text("America/New_York") },
            )

            Text(
                "With Run in background enabled, tasks continue while Nexy is in the desktop tray. The computer must stay awake and signed in; missed runs catch up the next time Nexy starts.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (agents.isNotEmpty()) {
                DropdownField(
                    label = "Agent (optional)",
                    options = listOf("") + agents.map { it.id },
                    selected = agentId,
                    onSelect = { agentId = it },
                    display = { id -> if (id.isEmpty()) "Default" else agents.firstOrNull { a -> a.id == id }?.let { "${it.icon} ${it.name}" } ?: id },
                )
            }

            if (projects.isNotEmpty()) {
                DropdownField(
                    label = "Project (optional)",
                    options = listOf("") + projects.map { it.id },
                    selected = projectId,
                    onSelect = { projectId = it },
                    display = { id -> if (id.isEmpty()) "None" else projects.firstOrNull { p -> p.id == id }?.name ?: id },
                )
            }

            OutlinedTextField(
                value = model,
                onValueChange = { model = it },
                label = { Text("Model override (optional)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text("claude-sonnet-4-6") },
            )

            if (targetType == "chat") {
                Text(
                    "Allowed tools",
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    "Scheduled tasks run unattended, so the agent can only call tools you pre-approve here — everything else is blocked when the task fires.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                when {
                    agentId.isBlank() -> Text(
                        "Select an agent to choose which of its tools may run.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    agentTools.isEmpty() -> Text(
                        "This agent has no MCP tools available.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    else -> agentTools.forEach { tool ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = preApproved.contains(tool.name),
                                onCheckedChange = { checked ->
                                    if (checked) { if (!preApproved.contains(tool.name)) preApproved.add(tool.name) }
                                    else preApproved.remove(tool.name)
                                },
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(tool.name, style = MaterialTheme.typography.bodySmall)
                                Text(
                                    tool.serverName,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                // Keep pre-approved names whose server isn't currently loaded so editing doesn't drop them.
                preApproved.filter { name -> agentTools.none { it.name == name } }.forEach { name ->
                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = true, onCheckedChange = { preApproved.remove(name) })
                        Text("$name (unavailable)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            DropdownField(
                label = "Notifications",
                options = NOTIFICATION_PREFS,
                selected = notificationPref,
                onSelect = { notificationPref = it },
                display = { it.replace('_', ' ').replaceFirstChar { c -> c.uppercase() } },
            )

            Spacer(Modifier.height(4.dp))
            val workflowSelectionIncomplete = targetType == "automated_workflow" && (selectedRunId.isBlank() || selectedRunDetail == null)
            Button(
                onClick = {
                    if (name.isBlank()) { nameError = "Name is required"; return@Button }
                    if (!isConnected || workflowSelectionIncomplete) return@Button

                    val input = buildMap<String, Any?> {
                        put("name", name.trim())
                        put("prompt", if (targetType == "chat") prompt.trim() else "")
                        put("scheduleType", scheduleType)
                        put("localTime", localTime)
                        put("timezone", timezone)
                        put("weekday", if (scheduleType == "weekly") weekday else null)
                        put("monthDay", if (scheduleType == "monthly") monthDay else null)
                        put("agentId", agentId.ifBlank { null })
                        put("projectId", projectId.ifBlank { null })
                        put("model", model.ifBlank { null })
                        put("notificationPref", notificationPref)
                        if (targetType == "chat") {
                            put("toolPolicy", mapOf("preApproved" to preApproved.toList()))
                        }
                        put("targetType", targetType)
                        if (targetType == "automated_workflow") {
                            val detail = selectedRunDetail
                            if (detail != null) {
                                put(
                                    "workflowSpecs",
                                    listOf(
                                        mapOf(
                                            "workflowSpecJson" to buildWorkflowSpecJson(detail),
                                            "sourceRunId" to selectedRunId,
                                            "confirmationMode" to "auto",
                                        ),
                                    ),
                                )
                            }
                        }
                        if (!isEdit) put("enabled", true)
                    }
                    if (taskId != null) viewModel.update(taskId, input)
                    else viewModel.create(input)
                    onBack()
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = isConnected && !workflowSelectionIncomplete,
            ) {
                Text(if (isEdit) "Save changes" else "Create task")
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> DropdownField(
    label: String,
    options: List<T>,
    selected: T,
    onSelect: (T) -> Unit,
    display: (T) -> String,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = display(selected),
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(display(option)) },
                    onClick = { onSelect(option); expanded = false },
                )
            }
        }
    }
}
