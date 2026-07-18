package io.nexy.android.ui.projects

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyTopAppBar

private enum class WorkflowFilter { ALL, GLOBAL }

// The 4-stage flow shown in the info banner below — "Run it whenever you're ready" is deliberate:
// a saved plan sits as "Pending" indefinitely until Start is pressed, so this must not read as
// "review and run happen back-to-back."
private val WORKFLOW_STAGES: List<Pair<ImageVector, String>> = listOf(
    Icons.Default.Edit to "Describe your goal",
    Icons.Default.Description to "Review the generated plan",
    Icons.Default.PlayArrow to "Run it whenever you're ready — step-by-step or automatic",
    Icons.Default.Refresh to "Reuse it later with \"Run again\" — no need to re-describe the goal",
)

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
    onNewWorkflow: () -> Unit,
    onOpenConversation: (String) -> Unit,
) {
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val disconnected = connectionState != ConnectionState.CONNECTED
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val stepStreamText by WsRepository.automatedWorkflowStepStreamText.collectAsStateWithLifecycle()

    val runs = remember { mutableStateListOf<AutomatedWorkflowRunInfo>() }
    var activeRun by remember { mutableStateOf<AutomatedWorkflowRunInfo?>(null) }
    var filter by remember { mutableStateOf(WorkflowFilter.ALL) }
    var discardTarget by remember { mutableStateOf<AutomatedWorkflowRunInfo?>(null) }
    var showInfo by remember { mutableStateOf(false) }
    // Set when "Run again" is tapped — matched back by templateId (not run id, which doesn't
    // exist client-side yet) to know when to navigate into the freshly spawned run.
    var pendingRunAgainTemplateId by remember { mutableStateOf<String?>(null) }

    // Mirrors the TopAppBar's `onBack = { if (activeRun != null) activeRun = null else onBack() }`
    // below — without this, system/gesture back exits the whole screen even while viewing a run's
    // detail, instead of returning to the run list first.
    BackHandler(enabled = activeRun != null) { activeRun = null }

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
                    } else if (pendingRunAgainTemplateId != null && run.templateId == pendingRunAgainTemplateId) {
                        pendingRunAgainTemplateId = null
                        activeRun = run
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

    discardTarget?.let { target ->
        NexyConfirmDialog(
            title = "Discard this workflow?",
            message = "This plan and its step progress will be permanently removed.",
            confirmLabel = "Discard",
            destructive = true,
            onConfirm = {
                discardTarget = null
                WsRepository.discardAutomatedWorkflowRun(target.id)
            },
            onDismiss = { discardTarget = null },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(activeRun?.title?.takeIf(String::isNotBlank) ?: "Automated Workflows", style = MaterialTheme.typography.titleMedium)
                },
                onBack = { if (activeRun != null) activeRun = null else onBack() },
                actions = {
                    if (activeRun == null) {
                        IconButton(onClick = { showInfo = !showInfo }) {
                            Icon(Icons.Default.Info, contentDescription = "How Automated Workflows work")
                        }
                        IconButton(onClick = onNewWorkflow) {
                            Icon(Icons.Default.Add, contentDescription = "New workflow")
                        }
                    }
                },
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
                onRunAgain = { templateId ->
                    pendingRunAgainTemplateId = templateId
                    WsRepository.runAgainAutomatedWorkflow(templateId)
                },
            )
        } else {
            Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                if (showInfo) {
                    Surface(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        shape = MaterialTheme.shapes.medium,
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                WORKFLOW_STAGES.forEach { (icon, label) ->
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                                        Text(label, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("Good to know", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(
                                    "• Each step runs in its own dedicated conversation, not the project's main chat — open it via \"Open conversation\" once the step starts.\n" +
                                        "• Gated mode pauses for your approval after every step; automatic mode advances immediately and only pauses if a step fails.\n" +
                                        "• The planner assigns each step to an agent (that agent's own skills apply) or a plain model — this isn't editable after the plan is generated.\n" +
                                        "• A workflow's project — or lack of one — is fixed when you generate it and can't be changed afterward.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
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
                    Column(
                        modifier = Modifier.fillMaxSize().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        NexyEmptyState(
                            title = if (filter == WorkflowFilter.GLOBAL) "No standalone (project-less) workflows yet" else "No automated workflows yet",
                            detail = "Describe a goal, review the plan, then run it whenever you're ready.",
                            action = { TextButton(onClick = onNewWorkflow) { Text("Start a new workflow") } },
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        items(filtered, key = { it.id }) { run2 ->
                            WorkflowRunListRow(
                                run = run2,
                                projectName = projectName(run2.projectId),
                                isConnected = !disconnected,
                                onOpen = { activeRun = run2; WsRepository.getAutomatedWorkflowRun(run2.id) },
                                onDiscard = { discardTarget = run2 },
                            )
                        }
                        item { androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(bottom = 16.dp)) }
                    }
                }
            }
        }
    }
}

// Mirrors ScheduledScreen.kt's TaskRow — bodyLarge title, tonalElevation surface (not a solid
// color fill), and a 3-dot overflow menu for the discard action — so this list reads consistently
// with the app's other top-level entity lists (Chats/Agents/Projects/Skills/Scheduled) rather than
// a visually distinct, shorter card style.
@Composable
private fun WorkflowRunListRow(
    run: AutomatedWorkflowRunInfo,
    projectName: String,
    isConnected: Boolean,
    onOpen: () -> Unit,
    onDiscard: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }

    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 2.dp),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        run.title.ifBlank { "Untitled workflow" },
                        style = MaterialTheme.typography.bodyLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.extraSmall) {
                        Text(
                            projectName,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
                if (run.goalSummary.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        run.goalSummary,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
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
            Spacer(Modifier.width(4.dp))
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = "More")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        leadingIcon = { Icon(Icons.Default.Delete, null, modifier = Modifier.size(18.dp)) },
                        text = { Text("Discard", color = MaterialTheme.colorScheme.error) },
                        onClick = { menuOpen = false; if (isConnected) onDiscard() },
                        enabled = isConnected,
                    )
                }
            }
        }
    }
}
