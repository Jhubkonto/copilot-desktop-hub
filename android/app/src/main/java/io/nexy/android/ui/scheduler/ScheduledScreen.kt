package io.nexy.android.ui.scheduler

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ScheduledTask
import io.nexy.android.ui.components.NexyTopAppBar
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class TaskFilter { ALL, ACTIVE, PAUSED }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduledScreen(
    onBack: () -> Unit,
    onNewTask: () -> Unit,
    onOpenGenerator: () -> Unit,
    onTaskDetail: (taskId: String) -> Unit,
    viewModel: SchedulerViewModel = viewModel(),
) {
    val tasks by viewModel.tasks.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val actionError by viewModel.actionError.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val isConnected = connectionState == ConnectionState.CONNECTED
    var filter by remember { mutableStateOf(TaskFilter.ALL) }

    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose {}
    }

    val filtered = when (filter) {
        TaskFilter.ALL -> tasks
        TaskFilter.ACTIVE -> tasks.filter { it.enabled }
        TaskFilter.PAUSED -> tasks.filter { !it.enabled }
    }

    actionError?.let { msg ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissActionError() },
            title = { Text("Error") },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { viewModel.dismissActionError() }) { Text("OK") } },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Scheduled Tasks", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
            )
        },
        floatingActionButton = {
            var showFabMenu by remember { mutableStateOf(false) }
            Box(modifier = Modifier.padding(end = 20.dp)) {
                FloatingActionButton(
                    onClick = {
                        showFabMenu = true
                    },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    Icon(Icons.Default.Add, contentDescription = "New task")
                }
                DropdownMenu(
                    expanded = showFabMenu,
                    onDismissRequest = { showFabMenu = false },
                ) {
                    DropdownMenuItem(
                        text = { Text("Add task") },
                        onClick = { showFabMenu = false; onNewTask() },
                        enabled = isConnected,
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                if (isConnected) {
                                    "Generate schedule"
                                } else {
                                    "Generate schedule · desktop required"
                                },
                            )
                        },
                        onClick = { showFabMenu = false; onOpenGenerator() },
                        enabled = isConnected,
                    )
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isLoading,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
        Column(modifier = Modifier.fillMaxSize()) {
            if (!isConnected) {
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
                            "Offline — showing last synced tasks. Reconnect to make changes.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
            }
            LazyRow(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(TaskFilter.entries) { f ->
                    FilterChip(
                        selected = filter == f,
                        onClick = { filter = f },
                        label = { Text(f.name.lowercase().replaceFirstChar { it.uppercase() }) },
                    )
                }
            }

            when {
                isLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                error != null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(error!!, color = MaterialTheme.colorScheme.error)
                        Spacer(Modifier.height(8.dp))
                        TextButton(onClick = { viewModel.refresh() }) { Text("Retry") }
                    }
                }
                filtered.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (tasks.isEmpty()) "No scheduled tasks yet. Tap + to create one."
                        else "No tasks match the selected filter.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(filtered, key = { it.id }) { task ->
                        TaskRow(
                            task = task,
                            isConnected = isConnected,
                            onTap = { onTaskDetail(task.id) },
                            onToggle = { viewModel.setEnabled(task.id, !task.enabled) },
                            onRunNow = { viewModel.runNow(task.id) },
                            onDelete = { viewModel.delete(task.id) },
                        )
                    }
                }
            }
        }
        }
    }
}

@Composable
private fun TaskRow(
    task: ScheduledTask,
    isConnected: Boolean,
    onTap: () -> Unit,
    onToggle: () -> Unit,
    onRunNow: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete task?") },
            text = { Text("\"${task.name}\" will be permanently deleted.") },
            confirmButton = {
                TextButton(onClick = { confirmDelete = false; onDelete() }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }

    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onTap).padding(horizontal = 12.dp, vertical = 2.dp),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(task.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    StatusBadge(task.enabled)
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    task.prompt,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                task.nextRunAt?.let { next ->
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "Next: ${formatTimestamp(next)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.width(4.dp))
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "More")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text(if (task.enabled) "Pause" else "Resume") },
                        onClick = { menuOpen = false; if (isConnected) onToggle() },
                        enabled = isConnected,
                    )
                    DropdownMenuItem(
                        leadingIcon = { Icon(Icons.Filled.PlayArrow, null, modifier = Modifier.size(18.dp)) },
                        text = { Text("Run now") },
                        onClick = { menuOpen = false; if (isConnected) onRunNow() },
                        enabled = isConnected,
                    )
                    DropdownMenuItem(
                        text = { Text("Delete", color = MaterialTheme.colorScheme.error) },
                        onClick = { menuOpen = false; if (isConnected) confirmDelete = true },
                        enabled = isConnected,
                    )
                }
            }
        }
    }
}

@Composable
private fun StatusBadge(enabled: Boolean) {
    val label = if (enabled) "Active" else "Paused"
    val color = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Surface(
        shape = MaterialTheme.shapes.extraSmall,
        color = color.copy(alpha = 0.15f),
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
            style = MaterialTheme.typography.labelSmall,
            color = color,
        )
    }
}

private fun formatTimestamp(epochMs: Long): String {
    val fmt = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())
    return fmt.format(Date(epochMs))
}
