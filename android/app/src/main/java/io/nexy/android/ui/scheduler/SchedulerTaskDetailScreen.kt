package io.nexy.android.ui.scheduler

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ScheduledRun
import io.nexy.android.data.model.ScheduledTask
import io.nexy.android.ui.components.NexyTopAppBar
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SchedulerTaskDetailScreen(
    taskId: String,
    onBack: () -> Unit,
    onEdit: (taskId: String) -> Unit,
    viewModel: SchedulerViewModel = viewModel(),
) {
    val tasks by viewModel.tasks.collectAsState()
    val runsMap by viewModel.runs.collectAsState()
    val actionError by viewModel.actionError.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    val isConnected = connectionState == ConnectionState.CONNECTED
    val task = tasks.firstOrNull { it.id == taskId }
    val runs = runsMap[taskId] ?: emptyList()
    var confirmDelete by remember { mutableStateOf(false) }

    LaunchedEffect(taskId) {
        viewModel.loadRuns(taskId)
    }

    actionError?.let { msg ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissActionError() },
            title = { Text("Error") },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { viewModel.dismissActionError() }) { Text("OK") } },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete task?") },
            text = { Text("This task and all its run history will be permanently deleted.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    viewModel.delete(taskId)
                    onBack()
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        task?.name ?: "Task",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                    )
                },
                onBack = onBack,
                actions = {
                    if (task != null) {
                        IconButton(onClick = { onEdit(taskId) }, enabled = isConnected) {
                            Icon(Icons.Filled.Edit, contentDescription = "Edit")
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (task == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)) {
            if (!isConnected) {
                item {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.errorContainer,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
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
                                "Offline — reconnect to make changes.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                    }
                }
            }
            item {
                Spacer(Modifier.height(12.dp))
                InfoSection(task)
                Spacer(Modifier.height(12.dp))
                ActionButtons(
                    task = task,
                    isConnected = isConnected,
                    onToggle = { viewModel.setEnabled(task.id, !task.enabled) },
                    onRunNow = { viewModel.runNow(task.id) },
                    onDelete = { confirmDelete = true },
                )
                Spacer(Modifier.height(16.dp))
                Text("Run History", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(8.dp))
                HorizontalDivider()
            }
            if (runs.isEmpty()) {
                item {
                    Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
                        Text("No runs yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                items(runs, key = { it.id }) { run ->
                    RunRow(run)
                    HorizontalDivider()
                }
            }
            item { Spacer(Modifier.height(80.dp)) }
        }
    }
}

@Composable
private fun InfoSection(task: ScheduledTask) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp,
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LabelValue("Schedule", scheduleLabel(task))
            LabelValue("Timezone", task.timezone)
            LabelValue("Notifications", task.notificationPref.replace('_', ' '))
            task.nextRunAt?.let { LabelValue("Next run", formatTimestamp(it)) }
            task.lastRunAt?.let { LabelValue("Last run", formatTimestamp(it)) }
        }
    }
    Spacer(Modifier.height(8.dp))
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp,
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text("Prompt", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            Text(task.prompt, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ActionButtons(
    task: ScheduledTask,
    isConnected: Boolean,
    onToggle: () -> Unit,
    onRunNow: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = onToggle, modifier = Modifier.weight(1f), enabled = isConnected) {
            Text(if (task.enabled) "Pause" else "Resume")
        }
        Button(
            onClick = onRunNow,
            modifier = Modifier.weight(1f),
            enabled = isConnected,
        ) {
            Icon(Icons.Filled.PlayArrow, contentDescription = null)
            Text("Run now")
        }
    }
    Spacer(Modifier.height(4.dp))
    OutlinedButton(
        onClick = onDelete,
        modifier = Modifier.fillMaxWidth(),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
        enabled = isConnected,
    ) {
        Text("Delete task")
    }
}

@Composable
private fun RunRow(run: ScheduledRun) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            val label = run.finishedAt?.let { formatTimestamp(it) }
                ?: run.startedAt?.let { "Started ${formatTimestamp(it)}" }
                ?: "Pending"
            Text(label, style = MaterialTheme.typography.bodySmall)
            if (run.error != null) {
                Text(run.error, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error, maxLines = 2)
            }
        }
        StatusBadge(run.status)
    }
}

@Composable
private fun LabelValue(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun StatusBadge(status: String) {
    val color = when (status) {
        "success" -> MaterialTheme.colorScheme.primary
        "failed" -> MaterialTheme.colorScheme.error
        "running" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(
        shape = MaterialTheme.shapes.extraSmall,
        color = color.copy(alpha = 0.15f),
    ) {
        Text(
            status,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = color,
        )
    }
}

private fun scheduleLabel(task: ScheduledTask): String {
    val base = when (task.scheduleType) {
        "daily" -> "Daily"
        "weekdays" -> "Weekdays"
        "weekly" -> {
            val day = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat").getOrElse(task.weekday ?: 1) { "?" }
            "Weekly on $day"
        }
        "monthly" -> "Monthly on day ${task.monthDay ?: 1}"
        "one-time" -> "One-time"
        else -> task.scheduleType
    }
    return "$base at ${task.localTime}"
}

private fun formatTimestamp(epochMs: Long): String =
    SimpleDateFormat("MMM d, h:mm a", Locale.getDefault()).format(Date(epochMs))
