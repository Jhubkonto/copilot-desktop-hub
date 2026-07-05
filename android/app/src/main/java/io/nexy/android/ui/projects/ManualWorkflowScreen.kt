package io.nexy.android.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualWorkflowScreen(
    projectId: String,
    onBack: () -> Unit,
) {
    val session by WsRepository.manualWorkflowSession.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var messageInput by remember { mutableStateOf("") }

    // Discard any workflow session left over from a different project.
    LaunchedEffect(projectId) {
        if (session != null && session?.projectId != projectId) {
            WsRepository.cancelManualWorkflow()
        }
    }

    fun sendMessage() {
        val text = messageInput.trim()
        if (text.isBlank()) return
        if (session == null) {
            WsRepository.startManualWorkflow(projectId, text)
        } else {
            WsRepository.sendManualWorkflowMessage(text)
        }
        messageInput = ""
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Manual Workflow") },
                onBack = onBack,
                actions = {
                    if (session != null) {
                        IconButton(onClick = { WsRepository.cancelManualWorkflow() }) {
                            Icon(Icons.Filled.Close, contentDescription = "Cancel workflow")
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
        ) {
            val activeSession = session
            if (activeSession == null) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(top = 24.dp),
                ) {
                    Text(
                        "Describe the workflow you want to generate — the assistant will propose a goal, assumptions, and a step-by-step plan with agent assignments.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                if (activeSession.title.isNotEmpty() || activeSession.goalSummary.isNotEmpty() || activeSession.steps.isNotEmpty()) {
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 12.dp),
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
                                activeSession.steps.forEachIndexed { index, step ->
                                    Text(
                                        "${index + 1}. $step",
                                        style = MaterialTheme.typography.bodySmall,
                                        modifier = Modifier.padding(top = 4.dp),
                                    )
                                }
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

                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(activeSession.messages) { message ->
                        ManualWorkflowMessageBubble(message)
                    }
                    if (activeSession.streamingText.isNotEmpty()) {
                        item {
                            ManualWorkflowMessageBubble(
                                WsRepository.ManualWorkflowMessage("assistant", activeSession.streamingText),
                            )
                        }
                    }
                    if (activeSession.isLoading && activeSession.streamingText.isEmpty()) {
                        item {
                            Box(modifier = Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.CenterStart) {
                                CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                            }
                        }
                    }
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

            if (session == null || activeSession?.isActive == true) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    OutlinedTextField(
                        value = messageInput,
                        onValueChange = { messageInput = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text(if (session == null) "Describe the workflow you want…" else "Send message…") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Sentences,
                            autoCorrectEnabled = true,
                            imeAction = ImeAction.Send,
                        ),
                    )
                    IconButton(onClick = { sendMessage() }) {
                        Icon(Icons.AutoMirrored.Filled.Send, "Send")
                    }
                }
            }
        }
    }
}

@Composable
private fun ManualWorkflowMessageBubble(message: WsRepository.ManualWorkflowMessage) {
    val isUser = message.role == "user"
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            modifier = Modifier.widthIn(max = 320.dp),
            color = when {
                message.isError -> MaterialTheme.colorScheme.errorContainer
                isUser -> MaterialTheme.colorScheme.primaryContainer
                else -> MaterialTheme.colorScheme.surfaceVariant
            },
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(
                message.text,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(8.dp),
            )
        }
    }
}
