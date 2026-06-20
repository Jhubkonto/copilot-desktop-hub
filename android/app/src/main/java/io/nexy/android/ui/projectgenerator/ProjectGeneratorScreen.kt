package io.nexy.android.ui.projectgenerator

import androidx.compose.foundation.layout.Arrangement
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
import io.nexy.android.ui.components.NexyStepIndicator
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
            actionLabel = "Retry",
            onAction = { vm.retryLastMessage() },
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
                    if (uiState.phase != ProjectGenPhase.CHAT || uiState.messages.size > 1 || uiState.streamingText.isNotBlank()) {
                        TextButton(onClick = { confirmReset = true }) {
                            Text("Reset")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            NexyStepIndicator(
                steps = listOf("Describe", "Review", "Done"),
                currentStep = uiState.phase.ordinal,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            when (uiState.phase) {
                ProjectGenPhase.CHAT -> ChatPhase(
                    uiState = uiState,
                    onSend = { vm.sendMessage(it) },
                    missedSpec = uiState.missedSpec,
                    modifier = Modifier.weight(1f),
                )
                ProjectGenPhase.SPEC_REVIEW -> SpecReviewPhase(
                    spec = uiState.pendingSpec,
                    isLoading = uiState.isLoading,
                    onSpecChange = { vm.updateSpec(it) },
                    onConfirm = { vm.confirmSpec() },
                    onBack = { vm.backToChat() },
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
private fun ChatPhase(
    uiState: ProjectGeneratorUiState,
    onSend: (String) -> Unit,
    missedSpec: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    var input by remember { mutableStateOf("") }

    LaunchedEffect(uiState.messages.size, uiState.streamingText) {
        if (uiState.messages.size > 1 || uiState.streamingText.isNotBlank()) {
            listState.animateScrollToItem(listState.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1)
        }
    }

    Column(modifier = modifier.fillMaxSize().imePadding()) {
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

        if (uiState.isLoading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }

        if (missedSpec) {
            Surface(
                color = MaterialTheme.colorScheme.tertiaryContainer,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    "No spec was generated — try asking me to set up the project.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
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
    onSpecChange: (ProjectGeneratorSpec) -> Unit,
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
            OutlinedTextField(
                value = spec.name,
                onValueChange = { onSpecChange(spec.copy(name = it)) },
                label = { Text("Name") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.height(8.dp))
            SpecField("Color", spec.color)
            OutlinedTextField(
                value = spec.rootDirectory.orEmpty(),
                onValueChange = { onSpecChange(spec.copy(rootDirectory = it.ifBlank { null })) },
                label = { Text("Root directory") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = spec.instructions,
                onValueChange = { onSpecChange(spec.copy(instructions = it)) },
                label = { Text("Instructions") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 6,
            )
            Spacer(Modifier.height(8.dp))
            InstructionModePicker(
                selected = spec.instructionMode ?: "prepend",
                onChange = { onSpecChange(spec.copy(instructionMode = it)) },
            )
            if (!spec.defaultModel.isNullOrBlank()) SpecField("Default model", spec.defaultModel)
            if (spec.variables.isNotEmpty()) {
                SpecListField("Variables", spec.variables.map { v -> "${v["key"].orEmpty()}=${v["value"].orEmpty()}" })
            }
            if (spec.inScope.isNotEmpty()) {
                SpecListField("In scope", spec.inScope.map { scope ->
                    val glob = scope["pathGlob"].orEmpty()
                    if (glob.isBlank()) scope["description"].orEmpty() else "${scope["description"].orEmpty()} ($glob)"
                })
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
                        append(if (agent.existingAgentId != null) "Existing " else agent.newAgent?.icon?.let { "$it " }.orEmpty())
                        append(agent.newAgent?.name ?: agent.role)
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
            val canCreate = spec?.let { it.name.isNotBlank() && !it.rootDirectory.isNullOrBlank() } ?: false
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onBack) { Text("Back") }
                Button(onClick = onConfirm, enabled = canCreate) {
                    Text("Create project")
                }
            }
        }
    }
}

@Composable
private fun InstructionModePicker(
    selected: String,
    onChange: (String) -> Unit,
) {
    val options = listOf("prepend", "append", "replace", "standalone")
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text("Instruction mode", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            options.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    row.forEach { option ->
                        if (selected == option) {
                            Button(onClick = { onChange(option) }, modifier = Modifier.weight(1f)) { Text(option, maxLines = 1) }
                        } else {
                            OutlinedButton(onClick = { onChange(option) }, modifier = Modifier.weight(1f)) { Text(option, maxLines = 1) }
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
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
