package io.nexy.android.ui.projectgenerator

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.ProjectGeneratorSpec
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyInfoDialog
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectGeneratorScreen(
    onBack: () -> Unit,
    vm: ProjectGeneratorViewModel = viewModel(),
) {
    val uiState by vm.uiState.collectAsState()
    var confirmReset by remember { mutableStateOf(false) }

    uiState.error?.let { err ->
        NexyInfoDialog(
            title = "Error",
            message = err,
            onDismiss = { vm.dismissError() },
        )
    }

    if (confirmReset) {
        NexyConfirmDialog(
            title = "Start over?",
            message = "The current Project Generator session will be cleared.",
            confirmLabel = "Start over",
            destructive = true,
            onConfirm = {
                confirmReset = false
                vm.reset()
            },
            onDismiss = { confirmReset = false },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Project Generator", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                actions = {
                    if (uiState.phase != ProjectGenPhase.CHAT || uiState.messages.isNotEmpty() || uiState.streamingText.isNotBlank()) {
                        TextButton(onClick = { confirmReset = true }) {
                            Text("Reset")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            ProjectGenPhaseHeader(phase = uiState.phase)
            when (uiState.phase) {
                ProjectGenPhase.CHAT -> ChatPhase(
                    uiState = uiState,
                    onSend = { vm.sendMessage(it) },
                    modifier = Modifier.weight(1f),
                )
                ProjectGenPhase.SPEC_REVIEW -> SpecReviewPhase(
                    spec = uiState.pendingSpec,
                    isLoading = uiState.isLoading,
                    onConfirm = { vm.confirmSpec() },
                    onBack = { vm.reset() },
                    modifier = Modifier.weight(1f),
                )
                ProjectGenPhase.DONE -> DonePhase(
                    projectName = uiState.createdProjectName.orEmpty(),
                    onReset = { vm.reset() },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun ProjectGenPhaseHeader(phase: ProjectGenPhase) {
    val steps = listOf(
        ProjectGenPhase.CHAT to "Describe",
        ProjectGenPhase.SPEC_REVIEW to "Review",
        ProjectGenPhase.DONE to "Done",
    )
    val activeIndex = steps.indexOfFirst { it.first == phase }.coerceAtLeast(0)

    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            steps.forEachIndexed { index, (_, label) ->
                val active = index == activeIndex
                val complete = index < activeIndex
                Surface(
                    modifier = Modifier.weight(1f),
                    shape = MaterialTheme.shapes.small,
                    color = when {
                        active -> MaterialTheme.colorScheme.primaryContainer
                        complete -> MaterialTheme.colorScheme.surfaceVariant
                        else -> MaterialTheme.colorScheme.surface
                    },
                ) {
                    Text(
                        label,
                        style = MaterialTheme.typography.labelSmall,
                        color = when {
                            active -> MaterialTheme.colorScheme.onPrimaryContainer
                            complete -> MaterialTheme.colorScheme.onSurfaceVariant
                            else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.72f)
                        },
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 6.dp),
                        maxLines = 1,
                    )
                }
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun ChatPhase(
    uiState: ProjectGeneratorUiState,
    onSend: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    var input by remember { mutableStateOf("") }

    LaunchedEffect(uiState.messages.size, uiState.streamingText) {
        if (uiState.messages.isNotEmpty() || uiState.streamingText.isNotBlank()) {
            listState.animateScrollToItem(listState.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1)
        }
    }

    Column(modifier = modifier.fillMaxSize().imePadding()) {
        if (uiState.messages.isEmpty() && uiState.streamingText.isBlank()) {
            Box(
                modifier = Modifier.weight(1f).padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Describe the project you want to set up — its goals, scope, team roles, and milestones. The assistant will ask a few questions then generate a full project spec.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(uiState.messages) { msg ->
                    ChatBubble(role = msg.role, text = msg.content)
                }
                if (uiState.streamingText.isNotBlank()) {
                    item {
                        ChatBubble(role = "assistant", text = uiState.streamingText, streaming = true)
                    }
                }
            }
        }

        if (uiState.isLoading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("Describe your project…") },
                modifier = Modifier.weight(1f),
                maxLines = 4,
            )
            Spacer(Modifier.width(8.dp))
            IconButton(
                onClick = {
                    val text = input.trim()
                    if (text.isNotBlank()) {
                        onSend(text)
                        input = ""
                    }
                },
                enabled = input.isNotBlank() && !uiState.isLoading,
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
            }
        }
    }
}

@Composable
private fun ChatBubble(role: String, text: String, streaming: Boolean = false) {
    val isUser = role == "user"
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            shape = MaterialTheme.shapes.medium,
            color = if (isUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.fillMaxWidth(0.85f),
        ) {
            Text(
                text = text + if (streaming) "▍" else "",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(12.dp),
                color = if (isUser) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SpecReviewPhase(
    spec: ProjectGeneratorSpec?,
    isLoading: Boolean,
    onConfirm: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        Text("Review Project Spec", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))

        if (spec == null) {
            Text("No spec generated yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            SpecField("Name", spec.name)
            SpecField("Color", spec.color)
            if (spec.instructions.isNotBlank()) SpecField("Instructions", spec.instructions)
            if (spec.inScope.isNotEmpty()) {
                SpecListField("In scope", spec.inScope.mapNotNull { it["description"] })
            }
            if (spec.outOfScope.isNotEmpty()) {
                SpecListField("Out of scope", spec.outOfScope.mapNotNull { it["description"] })
            }
            if (spec.milestones.isNotEmpty()) {
                SpecListField("Milestones", spec.milestones.mapNotNull { it["title"] })
            }
            if (spec.agents.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text("Agents", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                spec.agents.forEach { agent ->
                    val label = buildString {
                        append(if (agent.existingAgentId != null) "Existing" else agent.newAgentIcon?.let { "$it " }.orEmpty())
                        append(agent.newAgentName ?: agent.role)
                        if (agent.isLeader) append(" (leader)")
                    }
                    Text("• $label", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        if (isLoading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Text("Creating project…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onBack) { Text("Start over") }
                Button(onClick = onConfirm, enabled = spec != null) { Text("Create project") }
            }
        }
    }
}

@Composable
private fun SpecField(label: String, value: String) {
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun SpecListField(label: String, items: List<String>) {
    if (items.isEmpty()) return
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        items.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
    }
}

@Composable
private fun DonePhase(
    projectName: String,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Project Created!", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        if (projectName.isNotBlank()) {
            Text(
                "\"$projectName\" is ready. Head to the Projects tab to start chatting.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(24.dp))
        Button(onClick = onReset) { Text("Generate another project") }
    }
}
