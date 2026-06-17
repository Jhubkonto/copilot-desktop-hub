package io.nexy.android.ui.featuregenerator

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
import androidx.compose.material3.CircularProgressIndicator
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
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.FeatureSpec
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyInfoDialog

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeatureGeneratorScreen(
    onBack: () -> Unit,
    vm: FeatureGeneratorViewModel = viewModel(),
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
            message = "The current Feature Generator run will be cleared from this screen.",
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
                titleContent = { Text("Feature Generator", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                actions = {
                    if (uiState.phase != FeatureGenPhase.CHAT || uiState.messages.isNotEmpty() || uiState.streamingText.isNotBlank()) {
                        TextButton(onClick = { confirmReset = true }) {
                            Text("Reset")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            FeatureGeneratorPhaseHeader(phase = uiState.phase)
            when (uiState.phase) {
                FeatureGenPhase.CHAT -> ChatPhase(
                    uiState = uiState,
                    onSend = { vm.sendMessage(it) },
                    modifier = Modifier.weight(1f),
                )
                FeatureGenPhase.SPEC_REVIEW -> SpecReviewPhase(
                    spec = uiState.pendingSpec,
                    isLoading = uiState.isLoading,
                    onConfirm = { vm.confirmSpec() },
                    onBack = { vm.reset() },
                    modifier = Modifier.weight(1f),
                )
                FeatureGenPhase.PLAN_REVIEW -> PlanReviewPhase(
                    plan = uiState.plan.orEmpty(),
                    isLoading = uiState.isLoading,
                    onConfirm = { vm.confirmPlan() },
                    modifier = Modifier.weight(1f),
                )
                FeatureGenPhase.DIFF_REVIEW -> DiffReviewPhase(
                    stagedFiles = uiState.stagedFiles,
                    appliedFiles = uiState.appliedFiles,
                    isLoading = uiState.isLoading,
                    onApplyAll = { vm.applyAll() },
                    onCommit = { msg -> vm.commit(msg) },
                    modifier = Modifier.weight(1f),
                )
                FeatureGenPhase.DONE -> DonePhase(
                    commitSha = uiState.commitSha.orEmpty(),
                    appliedFiles = uiState.appliedFiles,
                    onReset = { vm.reset() },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun FeatureGeneratorPhaseHeader(phase: FeatureGenPhase) {
    val steps = listOf(
        FeatureGenPhase.CHAT to "Describe",
        FeatureGenPhase.SPEC_REVIEW to "Spec",
        FeatureGenPhase.PLAN_REVIEW to "Plan",
        FeatureGenPhase.DIFF_REVIEW to "Apply",
        FeatureGenPhase.DONE to "Done",
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
    uiState: FeatureGeneratorUiState,
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
                    "Describe a feature, bug fix, or refactor you want to implement. The assistant will ask a few questions then generate a spec.",
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
                placeholder = { Text("Describe your feature…") },
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
    spec: FeatureSpec?,
    isLoading: Boolean,
    onConfirm: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        Text("Review Spec", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))

        if (spec == null) {
            Text("No spec generated yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            SpecField("Title", spec.title)
            SpecField("Type", spec.type)
            SpecField("User story", spec.userStory)
            SpecListField("Acceptance criteria", spec.acceptanceCriteria)
            SpecListField("Target areas", spec.targetAreas)
            SpecListField("Likely affected files", spec.likelyAffectedFiles)
            if (spec.constraints.isNotEmpty()) SpecListField("Constraints", spec.constraints)
            if (spec.outOfScope.isNotEmpty()) SpecListField("Out of scope", spec.outOfScope)
            if (spec.risks.isNotEmpty()) SpecListField("Risks", spec.risks)
        }

        Spacer(Modifier.height(24.dp))

        if (isLoading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Text("Generating plan…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onBack) { Text("Start over") }
                Button(onClick = onConfirm, enabled = spec != null) { Text("Approve & generate plan") }
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
private fun PlanReviewPhase(
    plan: String,
    isLoading: Boolean,
    onConfirm: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
        ) {
            Text("Implementation Plan", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            if (plan.isBlank()) {
                CircularProgressIndicator()
            } else {
                Text(plan, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Box(modifier = Modifier.padding(16.dp)) {
            if (isLoading) {
                Column {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(4.dp))
                    Text("Generating implementation…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                Button(onClick = onConfirm, enabled = plan.isNotBlank()) {
                    Text("Approve & implement")
                }
            }
        }
    }
}

@Composable
private fun DiffReviewPhase(
    stagedFiles: List<String>,
    appliedFiles: List<String>,
    isLoading: Boolean,
    onApplyAll: () -> Unit,
    onCommit: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var commitMessage by remember { mutableStateOf("") }
    var confirmApplyAll by remember { mutableStateOf(false) }
    var confirmCommit by remember { mutableStateOf(false) }
    val applied = appliedFiles.isNotEmpty()

    if (confirmApplyAll) {
        NexyConfirmDialog(
            title = "Apply generated changes?",
            message = "The staged changes will be written into the desktop workspace. Review the file list before continuing.",
            confirmLabel = "Apply changes",
            onConfirm = {
                confirmApplyAll = false
                onApplyAll()
            },
            onDismiss = { confirmApplyAll = false },
        )
    }

    if (confirmCommit) {
        NexyConfirmDialog(
            title = "Commit applied changes?",
            message = "A git commit will be created on the desktop with the message \"$commitMessage\".",
            confirmLabel = "Commit",
            onConfirm = {
                confirmCommit = false
                onCommit(commitMessage)
            },
            onDismiss = { confirmCommit = false },
        )
    }

    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Text("Staged Changes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            "${stagedFiles.size} file(s) ready to apply.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))

        LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(stagedFiles) { file ->
                val isApplied = appliedFiles.contains(file)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        file,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.weight(1f),
                    )
                    if (isApplied) {
                        Text("✓", color = MaterialTheme.colorScheme.primary)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }

        Spacer(Modifier.height(16.dp))

        if (!applied) {
            Button(onClick = { confirmApplyAll = true }, enabled = stagedFiles.isNotEmpty() && !isLoading, modifier = Modifier.fillMaxWidth()) {
                Text("Apply all changes to workspace")
            }
        } else {
            OutlinedTextField(
                value = commitMessage,
                onValueChange = { commitMessage = it },
                label = { Text("Commit message") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = { if (commitMessage.isNotBlank()) confirmCommit = true },
                enabled = commitMessage.isNotBlank() && !isLoading,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Commit") }
        }

        if (isLoading) {
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun DonePhase(
    commitSha: String,
    appliedFiles: List<String>,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Done", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        if (commitSha.isNotBlank()) {
            Text("Committed: $commitSha", style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
        }
        Text("${appliedFiles.size} file(s) applied.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(24.dp))
        Button(onClick = onReset) { Text("Start new feature") }
    }
}
