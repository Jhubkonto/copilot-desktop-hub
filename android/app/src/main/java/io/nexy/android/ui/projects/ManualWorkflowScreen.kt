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
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import io.nexy.android.data.model.ManualWorkflowStepInfo
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

    // Discard any workflow session left over from a different project.
    LaunchedEffect(projectId) {
        if (session != null && session?.projectId != projectId) {
            WsRepository.cancelManualWorkflow()
        }
    }

    LaunchedEffect(Unit) { WsRepository.send("model:list", emptyMap()) }

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

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Manual Workflow") },
                onBack = onBack,
                actions = {
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
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            NexyStepIndicator(
                steps = listOf("Describe", "Plan"),
                currentStep = if (session == null) 0 else 1,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

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
                            "The plan is generated fresh each time and isn't saved — copy each step's prompt before leaving this screen if you want to keep it.",
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
