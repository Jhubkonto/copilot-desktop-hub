package io.nexy.android.ui.debrief

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ModelOption
import io.nexy.android.ui.chat.ModelPickerSheet
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.model.activeModelLabel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DebriefScreen(
    conversationId: String,
    onBack: () -> Unit,
    onQuizMe: (conversationId: String) -> Unit,
    vm: DebriefViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    val models by WsRepository.models.collectAsState()
    val cliStatus by WsRepository.cliStatus.collectAsState()
    val effectiveMode by WsRepository.effectiveMode.collectAsState()
    var showModelSheet by remember { mutableStateOf(false) }
    val modelSheetState = rememberModalBottomSheetState()

    LaunchedEffect(conversationId) { vm.load(conversationId) }

    val conversationTitle = when (val s = state) {
        is DebriefUiState.ReadyToGenerate -> s.conversationTitle
        is DebriefUiState.Generating -> s.conversationTitle
        else -> null
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Debrief") },
                subtitle = conversationTitle?.takeIf { it.isNotBlank() },
                onBack = onBack,
                actions = {
                    if (state is DebriefUiState.Loaded) {
                        IconButton(onClick = { onQuizMe(conversationId) }) {
                            Icon(Icons.Default.Psychology, contentDescription = "Quiz Me")
                        }
                    }
                },
            )
        },
    ) { padding ->
        AnimatedContent(
            targetState = state,
            transitionSpec = {
                (fadeIn(tween(250)) + slideInVertically(tween(300)) { it / 6 }) togetherWith fadeOut(tween(150))
            },
            label = "debrief-state",
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) { currentState ->
            when (currentState) {
                is DebriefUiState.CheckingExisting -> LoadingContent("Checking for an existing debrief…")
                is DebriefUiState.ReadyToGenerate -> ReadyToGenerateContent(
                    selectedModel = currentState.selectedModel,
                    models = models,
                    onPickModel = { showModelSheet = true },
                    onGenerate = { vm.generate() },
                )
                is DebriefUiState.Generating -> LoadingContent("Generating debrief…")
                is DebriefUiState.Loaded -> LoadedContent(currentState.debrief.summary, currentState.debrief.commandsTools, currentState.debrief.reproductionGuide, currentState.debrief.mentalModel)
                is DebriefUiState.Error -> ErrorContent(message = currentState.message, onRetry = { vm.retry(conversationId) })
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
                title = "Debrief model",
                subtitle = "Which model should read the transcript and write the debrief?",
                models = models,
                cliStatus = cliStatus,
                selectedModelId = (state as? DebriefUiState.ReadyToGenerate)?.selectedModel,
                effectiveMode = effectiveMode,
                onSelect = { modelId ->
                    vm.setSelectedModel(modelId)
                    showModelSheet = false
                },
            )
        }
    }
}

@Composable
internal fun ReadyToGenerateContent(
    selectedModel: String?,
    models: List<ModelOption>,
    onPickModel: () -> Unit,
    onGenerate: () -> Unit,
) {
    val modelLabel = if (selectedModel != null) activeModelLabel(selectedModel, models) else "Use this conversation's model"
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Generate a debrief", style = MaterialTheme.typography.titleMedium)
        Text(
            "A debrief asks an AI model to read this conversation's transcript and produce four things: " +
                "a short summary of what was accomplished, the commands/tools/APIs used, a step-by-step guide " +
                "to reproduce the work from scratch, and the reasoning approach that was followed. It's separate " +
                "from \"Mark complete\" — generating a debrief doesn't change the conversation's completed state, " +
                "and marking a conversation complete doesn't generate one.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(onClick = onPickModel) {
            Icon(Icons.Default.Tune, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(4.dp))
            Text(modelLabel, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        NexyPrimaryButton(text = "Generate debrief", onClick = onGenerate)
    }
}

@Composable
private fun LoadingContent(label: String) {
    var showLabel by remember { mutableStateOf(false) }
    LaunchedEffect(label) {
        showLabel = false
        kotlinx.coroutines.delay(800)
        showLabel = true
    }
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CircularProgressIndicator()
            AnimatedVisibility(visible = showLabel, enter = fadeIn(tween(400))) {
                Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun LoadedContent(summary: String, commandsTools: List<String>, reproductionGuide: String, mentalModel: String) {
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Summary", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Text(summary, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Commands & Tools", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    if (commandsTools.isEmpty()) {
                        Text("None recorded", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            commandsTools.forEach { tool ->
                                AssistChip(
                                    onClick = {},
                                    label = { Text(tool, style = MaterialTheme.typography.labelSmall) },
                                    colors = AssistChipDefaults.assistChipColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                                )
                            }
                        }
                    }
                }
            }
        }
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("How to Reproduce", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Surface(tonalElevation = 1.dp, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
                        Text(reproductionGuide, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(12.dp))
                    }
                }
            }
        }
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Mental Model / Approach", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Text(mentalModel, style = MaterialTheme.typography.bodyMedium.copy(fontStyle = FontStyle.Italic))
                }
            }
        }
        item { Spacer(modifier = Modifier.height(32.dp)) }
    }
}

@Composable
private fun ErrorContent(message: String, onRetry: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(32.dp)) {
            Icon(Icons.Default.ErrorOutline, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.error)
            Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FilledTonalButton(onClick = onRetry) { Text("Try Again") }
        }
    }
}
