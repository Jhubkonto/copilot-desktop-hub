package io.nexy.android.ui.scheduler

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository

private val SCHEDULE_TYPES = listOf("daily", "weekdays", "weekly", "monthly", "one-time")
private val WEEKDAYS = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
private val NOTIFICATION_PREFS = listOf("always", "failures_only", "off")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SchedulerTaskConfigScreen(
    taskId: String?,
    onBack: () -> Unit,
    viewModel: SchedulerViewModel = viewModel(),
) {
    val isEdit = taskId != null
    val tasks by viewModel.tasks.collectAsState()
    val initial = remember(taskId, tasks) { tasks.firstOrNull { it.id == taskId } }

    val agents = WsRepository.agents.collectAsState().value
    val projects = WsRepository.projects.collectAsState().value
    val connectionState = WsRepository.connectionState.collectAsState().value
    val isConnected = connectionState == io.nexy.android.data.ConnectionState.CONNECTED

    var name by rememberSaveable(initial) { mutableStateOf(initial?.name ?: "") }
    var prompt by rememberSaveable(initial) { mutableStateOf(initial?.prompt ?: "") }
    var scheduleType by rememberSaveable(initial) { mutableStateOf(initial?.scheduleType ?: "daily") }
    var localTime by rememberSaveable(initial) { mutableStateOf(initial?.localTime ?: "09:00") }
    var weekday by rememberSaveable(initial) { mutableStateOf(initial?.weekday ?: 1) }
    var monthDay by rememberSaveable(initial) { mutableStateOf(initial?.monthDay ?: 1) }
    var timezone by rememberSaveable(initial) { mutableStateOf(initial?.timezone ?: java.util.TimeZone.getDefault().id) }
    var agentId by rememberSaveable(initial) { mutableStateOf(initial?.agentId ?: "") }
    var projectId by rememberSaveable(initial) { mutableStateOf(initial?.projectId ?: "") }
    var model by rememberSaveable(initial) { mutableStateOf(initial?.model ?: "") }
    var notificationPref by rememberSaveable(initial) { mutableStateOf(initial?.notificationPref ?: "failures_only") }
    var nameError by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (isEdit) "Edit Task" else "New Task") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
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
            )

            OutlinedTextField(
                value = prompt,
                onValueChange = { prompt = it },
                label = { Text("Prompt") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 4,
                maxLines = 8,
            )

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

            DropdownField(
                label = "Notifications",
                options = NOTIFICATION_PREFS,
                selected = notificationPref,
                onSelect = { notificationPref = it },
                display = { it.replace('_', ' ').replaceFirstChar { c -> c.uppercase() } },
            )

            Spacer(Modifier.height(4.dp))
            Button(
                onClick = {
                    if (name.isBlank()) { nameError = "Name is required"; return@Button }
                    if (!isConnected) return@Button

                    val input = buildMap<String, Any?> {
                        put("name", name.trim())
                        put("prompt", prompt.trim())
                        put("scheduleType", scheduleType)
                        put("localTime", localTime)
                        put("timezone", timezone)
                        put("weekday", if (scheduleType == "weekly") weekday else null)
                        put("monthDay", if (scheduleType == "monthly") monthDay else null)
                        put("agentId", agentId.ifBlank { null })
                        put("projectId", projectId.ifBlank { null })
                        put("model", model.ifBlank { null })
                        put("notificationPref", notificationPref)
                        if (!isEdit) put("enabled", true)
                    }
                    if (isEdit && taskId != null) viewModel.update(taskId, input)
                    else viewModel.create(input)
                    onBack()
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = isConnected,
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
