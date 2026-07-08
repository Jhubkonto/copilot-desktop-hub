package io.nexy.android.ui.projects

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ManualWorkflowRunInfo
import io.nexy.android.data.model.ManualWorkflowRunStepData
import io.nexy.android.data.model.ManualWorkflowStepInfo
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.chat.ChatInputBar
import io.nexy.android.ui.chat.ModelPickerSheet
import io.nexy.android.ui.chat.rememberOnDeviceVoiceInput
import io.nexy.android.ui.components.GeneratorChatBubble
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyStepIndicator
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.model.activeModelLabel
import kotlinx.coroutines.launch

private enum class ManualWorkflowView { Workspace, List, Detail }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualWorkflowScreen(
    projectId: String,
    onBack: () -> Unit,
) {
    val session by WsRepository.manualWorkflowSession.collectAsState()
    val activeSession = session
    val models by WsRepository.models.collectAsState()
    val cliStatus by WsRepository.cliStatus.collectAsState()
    val effectiveMode by WsRepository.effectiveMode.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var messageInput by remember { mutableStateOf("") }
    var confirmReset by remember { mutableStateOf(false) }
    var selectedModel by remember { mutableStateOf<String?>(null) }
    var showModelSheet by remember { mutableStateOf(false) }
    val modelSheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val voiceInput = rememberOnDeviceVoiceInput(
        onText = { text -> messageInput = if (messageInput.isBlank()) text else "${messageInput.trimEnd()} $text" },
        onError = { message -> scope.launch { snackbarHostState.showSnackbar(message) } },
    )

    var view by remember { mutableStateOf(ManualWorkflowView.Workspace) }
    val savedRuns = remember { mutableStateListOf<ManualWorkflowRunInfo>() }
    var activeRun by remember { mutableStateOf<ManualWorkflowRunInfo?>(null) }
    var discardTarget by remember { mutableStateOf<String?>(null) }

    // Discard any workflow session left over from a different project.
    LaunchedEffect(projectId) {
        if (session != null && session?.projectId != projectId) {
            WsRepository.cancelManualWorkflow()
        }
    }

    LaunchedEffect(Unit) { WsRepository.send("model:list", emptyMap()) }

    LaunchedEffect(projectId) { WsRepository.listManualWorkflowRuns(projectId) }

    LaunchedEffect(projectId) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.ManualWorkflowRunsList -> if (event.projectId == projectId) {
                    savedRuns.clear()
                    savedRuns.addAll(event.runs)
                }
                is WsEvent.ManualWorkflowRunDetailReady -> {
                    val run = event.run
                    if (run != null && run.projectId == projectId) {
                        val idx = savedRuns.indexOfFirst { it.id == run.id }
                        if (idx >= 0) savedRuns[idx] = run else savedRuns.add(0, run)
                        if (activeRun?.id == run.id) activeRun = run
                    }
                }
                is WsEvent.ManualWorkflowRunDiscarded -> if (event.ok) {
                    savedRuns.removeAll { it.id == event.runId }
                    if (activeRun?.id == event.runId) {
                        activeRun = null
                        view = ManualWorkflowView.List
                    }
                }
                else -> {}
            }
        }
    }

    LaunchedEffect(activeSession?.savedRunId) {
        if (activeSession?.savedRunId != null) {
            snackbarHostState.showSnackbar("Workflow saved")
        }
    }

    fun sendMessage() {
        val text = messageInput.trim()
        if (text.isBlank()) return
        if (session == null) {
            WsRepository.startManualWorkflow(projectId, text, model = selectedModel)
        } else {
            WsRepository.sendManualWorkflowMessage(text, model = selectedModel)
        }
        messageInput = ""
    }

    if (confirmReset) {
        NexyConfirmDialog(
            title = "Start over?",
            message = "The current Manual Workflow session will be cleared.",
            confirmLabel = "Start over",
            destructive = true,
            onConfirm = {
                confirmReset = false
                WsRepository.cancelManualWorkflow()
            },
            onDismiss = { confirmReset = false },
        )
    }

    discardTarget?.let { runId ->
        NexyConfirmDialog(
            title = "Discard this workflow?",
            message = "This plan and its step progress will be permanently removed.",
            confirmLabel = "Discard",
            destructive = true,
            onConfirm = {
                discardTarget = null
                WsRepository.discardManualWorkflowRun(runId)
            },
            onDismiss = { discardTarget = null },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        when (view) {
                            ManualWorkflowView.Workspace -> "Manual Workflow"
                            ManualWorkflowView.List -> "Saved Workflows"
                            ManualWorkflowView.Detail -> activeRun?.title?.takeIf(String::isNotBlank) ?: "Workflow"
                        },
                    )
                },
                onBack = {
                    when (view) {
                        ManualWorkflowView.Detail -> { activeRun = null; view = ManualWorkflowView.List }
                        ManualWorkflowView.List -> view = ManualWorkflowView.Workspace
                        ManualWorkflowView.Workspace -> onBack()
                    }
                },
                actions = {
                    if (view == ManualWorkflowView.Workspace) {
                        TextButton(onClick = { showModelSheet = true }) {
                            Icon(
                                Icons.Default.Tune,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                activeModelLabel(selectedModel, models),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = 100.dp),
                            )
                        }
                        if (session != null) {
                            NexyGhostButton(text = "Reset", onClick = { confirmReset = true })
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        when (view) {
            ManualWorkflowView.List -> SavedWorkflowRunListView(
                modifier = Modifier.fillMaxSize().padding(padding),
                runs = savedRuns,
                onOpen = { run -> activeRun = run; WsRepository.getManualWorkflowRun(run.id); view = ManualWorkflowView.Detail },
                onDiscard = { run -> discardTarget = run.id },
                onNewWorkflow = { view = ManualWorkflowView.Workspace },
            )
            ManualWorkflowView.Detail -> {
                val run = activeRun
                if (run == null) {
                    view = ManualWorkflowView.List
                } else {
                    SavedWorkflowRunDetailView(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        run = run,
                        onMarkStatus = { step, status -> WsRepository.updateManualWorkflowRunStepStatus(run.id, step.dbId, status) },
                    )
                }
            }
            ManualWorkflowView.Workspace -> Column(modifier = Modifier.fillMaxSize().padding(padding)) {
                NexyStepIndicator(
                    steps = listOf("Describe", "Plan"),
                    currentStep = if (session == null) 0 else 1,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                if (savedRuns.isNotEmpty()) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        TextButton(onClick = { view = ManualWorkflowView.List }) {
                            Text("My workflows (${savedRuns.size})", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(horizontal = 16.dp),
                ) {
                    if (activeSession == null) {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "Describe the workflow you want to generate — the assistant will propose a goal, assumptions, and a step-by-step plan with agent assignments.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                "Once a plan comes back you can save it — saved plans sync to the desktop app and back, and track step progress as you complete them.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        // Plan header, step cards, and the chat log all live in this single scrollable
                        // LazyColumn (rather than the plan/steps block being a separate unbounded
                        // Column) so a workflow with many steps scrolls fully into view instead of
                        // squeezing the chat log toward zero height — mirrors ChatScreen.kt's pattern
                        // of one weighted LazyColumn with no competing unbounded sibling.
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f)
                                .padding(vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (activeSession.title.isNotEmpty() || activeSession.goalSummary.isNotEmpty() || activeSession.steps.isNotEmpty()) {
                                item {
                                    Surface(
                                        modifier = Modifier.fillMaxWidth(),
                                        color = MaterialTheme.colorScheme.surfaceVariant,
                                        shape = MaterialTheme.shapes.medium,
                                    ) {
                                        Column(modifier = Modifier.padding(12.dp)) {
                                            if (activeSession.title.isNotEmpty()) {
                                                Text(activeSession.title, style = MaterialTheme.typography.labelLarge)
                                            }
                                            if (activeSession.goalSummary.isNotEmpty()) {
                                                Text(
                                                    "Goal: ${activeSession.goalSummary}",
                                                    style = MaterialTheme.typography.bodySmall,
                                                    modifier = Modifier.padding(top = 4.dp),
                                                )
                                            }
                                            if (activeSession.assumptions.isNotEmpty()) {
                                                Text(
                                                    "Assumptions: ${activeSession.assumptions}",
                                                    style = MaterialTheme.typography.bodySmall,
                                                    modifier = Modifier.padding(top = 4.dp),
                                                )
                                            }
                                            if (activeSession.steps.isNotEmpty()) {
                                                Text(
                                                    "Steps:",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    modifier = Modifier.padding(top = 8.dp),
                                                )
                                            }
                                            if (activeSession.currentModel != null) {
                                                Text(
                                                    "Model: ${activeSession.currentModel}",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    modifier = Modifier.padding(top = 8.dp),
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                            itemsIndexed(activeSession.steps) { index, step ->
                                ManualWorkflowStepCard(index = index, step = step)
                            }
                            if (activeSession.steps.isNotEmpty() && activeSession.rawSpec != null) {
                                item {
                                    Button(
                                        onClick = {
                                            WsRepository.saveManualWorkflowRun(
                                                projectId,
                                                activeSession.rawSpec,
                                                activeSession.currentModel,
                                                activeSession.savedRunId,
                                            )
                                        },
                                        enabled = !activeSession.saving,
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text(
                                            when {
                                                activeSession.saving -> "Saving…"
                                                activeSession.savedRunId != null -> "Update saved workflow"
                                                else -> "Save workflow"
                                            },
                                        )
                                    }
                                }
                            }
                            items(activeSession.messages) { message ->
                                GeneratorChatBubble(role = message.role, text = message.text, isError = message.isError)
                            }
                            if (activeSession.streamingText.isNotEmpty()) {
                                item {
                                    GeneratorChatBubble(role = "assistant", text = activeSession.streamingText, streaming = true)
                                }
                            }
                        }

                        if (activeSession.isLoading && activeSession.streamingText.isEmpty()) {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        }

                        if (!activeSession.isActive) {
                            Box(
                                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text("Workflow ended", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }

                if (session == null || activeSession?.isActive == true) {
                    ChatInputBar(
                        input = messageInput,
                        onInputChange = { messageInput = it },
                        attachments = emptyList(),
                        onRemoveAttachment = {},
                        canSend = messageInput.isNotBlank(),
                        onSend = { sendMessage() },
                        onAttachFile = {},
                        placeholder = if (session == null) "Describe the workflow you want…" else "Send message…",
                        showAttachOptions = false,
                        isListening = voiceInput.listening,
                        onVoiceInput = voiceInput.toggle,
                    )
                }
            }
        }
    }

    if (showModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModelSheet = false },
            sheetState = modelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ModelPickerSheet(
                title = "Workflow generator model",
                models = models,
                cliStatus = cliStatus,
                selectedModelId = selectedModel,
                effectiveMode = effectiveMode,
                onSelect = { modelId ->
                    selectedModel = modelId
                    showModelSheet = false
                },
            )
        }
    }
}

@Composable
internal fun ManualWorkflowStepCard(index: Int, step: ManualWorkflowStepInfo) {
    val context = LocalContext.current
    val clipboardManager = context.getSystemService(ClipboardManager::class.java)
    val metaLine = buildString {
        append(step.agentName ?: "Unassigned")
        if (step.expectedOutput.isNotBlank()) append(" · Output: ${step.expectedOutput}")
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.small,
    ) {
        Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("${index + 1}. ${step.title}", style = MaterialTheme.typography.labelMedium)
            Text(metaLine, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (step.summary.isNotBlank()) {
                Text(step.summary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 2.dp))
            }
            if (step.prompt.isNotBlank()) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(
                        onClick = {
                            clipboardManager?.setPrimaryClip(ClipData.newPlainText("Workflow step prompt", step.prompt))
                        },
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                        Text("Copy prompt")
                    }
                }
            }
        }
    }
}

@Composable
private fun SavedWorkflowRunListView(
    modifier: Modifier = Modifier,
    runs: List<ManualWorkflowRunInfo>,
    onOpen: (ManualWorkflowRunInfo) -> Unit,
    onDiscard: (ManualWorkflowRunInfo) -> Unit,
    onNewWorkflow: () -> Unit,
) {
    Column(modifier = modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = onNewWorkflow, modifier = Modifier.fillMaxWidth()) {
            Text("Start a new workflow")
        }
        if (runs.isEmpty()) {
            Text(
                "No saved workflows yet.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 16.dp),
            )
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(runs, key = { it.id }) { run ->
                    SavedWorkflowRunRow(run = run, onOpen = { onOpen(run) }, onDiscard = { onDiscard(run) })
                }
            }
        }
    }
}

@Composable
private fun SavedWorkflowRunRow(run: ManualWorkflowRunInfo, onOpen: () -> Unit, onDiscard: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.medium,
        onClick = onOpen,
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(run.title.ifBlank { "Untitled workflow" }, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = onDiscard) {
                    Icon(Icons.Default.Delete, contentDescription = "Discard workflow", modifier = Modifier.size(18.dp))
                }
            }
            if (run.goalSummary.isNotBlank()) {
                Text(run.goalSummary, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text(
                "${run.stepCounts.done}/${run.stepCounts.total} steps done" +
                    (if (run.stepCounts.started > 0) " · ${run.stepCounts.started} in progress" else "") +
                    (if (run.status == "completed") " · Completed" else ""),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SavedWorkflowRunDetailView(
    modifier: Modifier = Modifier,
    run: ManualWorkflowRunInfo,
    onMarkStatus: (ManualWorkflowRunStepData, String) -> Unit,
) {
    val byStepKey = run.steps.associateBy { it.id }
    fun isDependencyDone(key: String) = byStepKey[key]?.status == "done"
    val readySteps = run.steps.filter { it.status != "done" && it.dependsOnStepIds.all(::isDependencyDone) }
    val waitingSteps = run.steps.filter { it.status != "done" && !it.dependsOnStepIds.all(::isDependencyDone) }
    val completedSteps = run.steps.filter { it.status == "done" }

    LazyColumn(modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (run.goalSummary.isNotBlank() || run.assumptions.isNotEmpty()) {
            item {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (run.goalSummary.isNotBlank()) Text("Goal: ${run.goalSummary}", style = MaterialTheme.typography.bodySmall)
                        if (run.assumptions.isNotEmpty()) {
                            Text("Assumptions: ${run.assumptions.joinToString(" • ")}", style = MaterialTheme.typography.bodySmall)
                        }
                        Text("${run.stepCounts.done}/${run.stepCounts.total} steps done", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        if (readySteps.isNotEmpty()) {
            item { Text("Ready now", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(readySteps, key = { it.dbId }) { step -> RunStepCard(step = step, waitingOn = emptyList(), onMarkStatus = onMarkStatus) }
        }
        if (waitingSteps.isNotEmpty()) {
            item { Text("Waiting on earlier steps", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(waitingSteps, key = { it.dbId }) { step ->
                val waitingOn = step.dependsOnStepIds.filterNot(::isDependencyDone).map { byStepKey[it]?.title ?: it }
                RunStepCard(step = step, waitingOn = waitingOn, onMarkStatus = onMarkStatus)
            }
        }
        if (completedSteps.isNotEmpty()) {
            item { Text("Completed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(completedSteps, key = { it.dbId }) { step -> RunStepCard(step = step, waitingOn = emptyList(), onMarkStatus = onMarkStatus) }
        }
    }
}

@Composable
private fun RunStepCard(
    step: ManualWorkflowRunStepData,
    waitingOn: List<String>,
    onMarkStatus: (ManualWorkflowRunStepData, String) -> Unit,
) {
    val context = LocalContext.current
    val clipboardManager = context.getSystemService(ClipboardManager::class.java)
    Surface(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.small) {
        Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${step.stepIndex + 1}. ${step.title}", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                Text(step.status.replace('_', ' '), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                step.agentName ?: "Unassigned",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (waitingOn.isNotEmpty()) {
                Text(
                    "Waiting on: ${waitingOn.joinToString(", ")}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            if (step.summary.isNotBlank()) {
                Text(step.summary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 2.dp))
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { clipboardManager?.setPrimaryClip(ClipData.newPlainText("Workflow step prompt", step.prompt)) }) {
                    Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                    Text("Copy")
                }
                if (step.status != "done") {
                    TextButton(onClick = { onMarkStatus(step, "done") }) { Text("Mark done") }
                }
                if (step.status != "not_started") {
                    TextButton(onClick = { onMarkStatus(step, "not_started") }) { Text("Reopen") }
                }
            }
        }
    }
}
