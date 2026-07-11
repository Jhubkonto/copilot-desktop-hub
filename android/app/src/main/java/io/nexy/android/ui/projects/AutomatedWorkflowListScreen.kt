package io.nexy.android.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AutomatedWorkflowRunInfo
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar

private enum class WorkflowFilter { ALL, GLOBAL }

/**
 * Global, top-level browse/manage surface for Automated Workflow runs — reached from the
 * dashboard's 3-dot menu, additive to (not a replacement for) the project-nested entry point in
 * ProjectConfigScreen.kt's "Project Tools" section, which still owns project-scoped plan
 * generation via AutomatedWorkflowScreen.kt. Detail rendering reuses SavedWorkflowRunDetailView
 * from that same screen rather than a second copy.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AutomatedWorkflowListScreen(
    projectId: String?,
    onBack: () -> Unit,
    onOpenConversation: (String) -> Unit,
) {
    val connectionState by WsRepository.connectionState.collectAsState()
    val disconnected = connectionState != ConnectionState.CONNECTED
    val projects by WsRepository.projects.collectAsState()
    val stepStreamText by WsRepository.automatedWorkflowStepStreamText.collectAsState()

    val runs = remember { mutableStateListOf<AutomatedWorkflowRunInfo>() }
    var activeRun by remember { mutableStateOf<AutomatedWorkflowRunInfo?>(null) }
    var filter by remember { mutableStateOf(WorkflowFilter.ALL) }

    fun refresh() {
        if (projectId.isNullOrBlank()) WsRepository.listAllAutomatedWorkflowRuns() else WsRepository.listAutomatedWorkflowRuns(projectId)
        activeRun?.let { WsRepository.getAutomatedWorkflowRun(it.id) }
    }

    LifecycleResumeEffect(Unit) {
        refresh()
        onPauseOrDispose {}
    }

    // Reconnect-resync — mirrors RemoteEditReportDetailScreen.kt's established pattern. A run can
    // fully progress through several auto-executed steps while the phone was disconnected.
    LaunchedEffect(disconnected) {
        if (!disconnected) refresh()
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.AutomatedWorkflowRunsListAll -> {
                    runs.clear()
                    runs.addAll(event.runs)
                }
                is WsEvent.AutomatedWorkflowRunsList -> if (projectId != null && event.projectId == projectId) {
                    runs.clear()
                    runs.addAll(event.runs)
                }
                is WsEvent.AutomatedWorkflowRunDetailReady -> {
                    val run = event.run ?: return@collect
                    val idx = runs.indexOfFirst { it.id == run.id }
                    if (idx >= 0) runs[idx] = run else runs.add(0, run)
                    if (activeRun?.id == run.id) {
                        activeRun = run
                        WsRepository.pruneAutomatedWorkflowStepStreamText(
                            run.steps.filter { it.status == "running" }.map { it.dbId }.toSet(),
                        )
                    }
                }
                is WsEvent.AutomatedWorkflowRunDiscarded -> if (event.ok) {
                    runs.removeAll { it.id == event.runId }
                    if (activeRun?.id == event.runId) activeRun = null
                }
                else -> {}
            }
        }
    }

    fun projectName(id: String?): String =
        id?.let { pid -> projects.find { it.id == pid }?.name } ?: "Global"

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(activeRun?.title?.takeIf(String::isNotBlank) ?: "Automated Workflows", style = MaterialTheme.typography.titleMedium)
                },
                onBack = { if (activeRun != null) activeRun = null else onBack() },
            )
        },
    ) { padding ->
        val run = activeRun
        if (run != null) {
            SavedWorkflowRunDetailView(
                modifier = Modifier.fillMaxSize().padding(padding),
                run = run,
                stepStreamText = stepStreamText,
                onStart = { WsRepository.startAutomatedWorkflowRun(run.id) },
                onModeChange = { mode -> WsRepository.setAutomatedWorkflowConfirmationMode(run.id, mode) },
                onAbort = { WsRepository.abortAutomatedWorkflowRun(run.id) },
                onApprove = { step, output -> WsRepository.confirmAutomatedWorkflowStep(run.id, step.dbId, output.takeIf { it != step.output }) },
                onRetry = { step -> WsRepository.retryAutomatedWorkflowStep(run.id, step.dbId) },
                onSkip = { step -> WsRepository.skipAutomatedWorkflowStep(run.id, step.dbId) },
                onOpenConversation = onOpenConversation,
            )
        } else {
            Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    listOf(WorkflowFilter.ALL to "All", WorkflowFilter.GLOBAL to "Global only").forEachIndexed { i, (value, label) ->
                        SegmentedButton(
                            selected = filter == value,
                            onClick = { filter = value },
                            shape = SegmentedButtonDefaults.itemShape(index = i, count = 2),
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                val filtered = if (filter == WorkflowFilter.GLOBAL) runs.filter { it.projectId == null } else runs
                if (filtered.isEmpty()) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            if (filter == WorkflowFilter.GLOBAL) "No standalone (project-less) workflows yet" else "No automated workflows yet",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(filtered, key = { it.id }) { run2 ->
                            WorkflowRunListRow(
                                run = run2,
                                projectName = projectName(run2.projectId),
                                onOpen = { activeRun = run2; WsRepository.getAutomatedWorkflowRun(run2.id) },
                            )
                        }
                        item { androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(bottom = 16.dp)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkflowRunListRow(run: AutomatedWorkflowRunInfo, projectName: String, onOpen: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.medium,
        onClick = onOpen,
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(run.title.ifBlank { "Untitled workflow" }, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                Surface(color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.extraSmall) {
                    Text(
                        projectName,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            if (run.goalSummary.isNotBlank()) {
                Text(run.goalSummary, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            val inProgress = run.stepCounts.running + run.stepCounts.awaitingConfirmation
            Text(
                "${run.stepCounts.done}/${run.stepCounts.total} steps done" +
                    (if (inProgress > 0) " · $inProgress in progress" else "") +
                    (when (run.status) {
                        "done" -> " · Completed"
                        "failed" -> " · Failed"
                        else -> ""
                    }),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
