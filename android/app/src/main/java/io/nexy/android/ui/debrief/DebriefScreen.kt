package io.nexy.android.ui.debrief

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    val state by vm.state.collectAsStateWithLifecycle()
    val view by vm.view.collectAsStateWithLifecycle()
    val storyState by vm.storyState.collectAsStateWithLifecycle()
    val models by WsRepository.models.collectAsStateWithLifecycle()
    val cliStatus by WsRepository.cliStatus.collectAsStateWithLifecycle()
    val effectiveMode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    var showModelSheet by remember { mutableStateOf(false) }
    var showStylePicker by remember { mutableStateOf(false) }
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            if (state is DebriefUiState.Loaded) {
                DebriefViewToggle(
                    view = view,
                    onSelect = { newView ->
                        vm.setView(newView)
                        if (newView == DebriefView.STORY && storyState.story == null) showStylePicker = true
                    },
                )
            }
            Box(modifier = Modifier.fillMaxSize()) {
                val currentState = state
                when (currentState) {
                    is DebriefUiState.CheckingExisting -> LoadingContent("Checking for an existing debrief…")
                    is DebriefUiState.ReadyToGenerate -> ReadyToGenerateContent(
                        selectedModel = currentState.selectedModel,
                        models = models,
                        onPickModel = { showModelSheet = true },
                        onGenerate = { vm.generate() },
                    )
                    is DebriefUiState.Generating -> LoadingContent("Generating debrief…")
                    is DebriefUiState.Loaded -> when (view) {
                        DebriefView.STRUCTURED -> LoadedContent(currentState.debrief.summary, currentState.debrief.commandsTools, currentState.debrief.reproductionGuide, currentState.debrief.mentalModel)
                        DebriefView.STORY -> StoryContent(
                            storyState = storyState,
                            showStylePicker = showStylePicker,
                            onToneChange = { vm.setStoryTone(it) },
                            onBeatCountChange = { vm.setStoryBeatCount(it) },
                            onTellStory = { showStylePicker = false; vm.fetchStory(forceRegenerate = storyState.story != null) },
                            onRetell = { showStylePicker = true },
                            onRetry = { vm.fetchStory() },
                        )
                    }
                    is DebriefUiState.Error -> ErrorContent(message = currentState.message, onRetry = { vm.retry(conversationId) })
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
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CircularProgressIndicator()
            Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Structured/Story tab switcher — mirrors desktop's DebriefArtifactCard view pill pair. */
@Composable
private fun DebriefViewToggle(view: DebriefView, onSelect: (DebriefView) -> Unit) {
    Row(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.20f),
        ) {
            Row(modifier = Modifier.padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                DebriefTogglePill(label = "Structured", selected = view == DebriefView.STRUCTURED, onClick = { onSelect(DebriefView.STRUCTURED) })
                DebriefTogglePill(
                    label = "Story",
                    selected = view == DebriefView.STORY,
                    onClick = { onSelect(DebriefView.STORY) },
                    icon = Icons.Default.AutoAwesome,
                )
            }
        }
    }
}

@Composable
private fun DebriefTogglePill(label: String, selected: Boolean, onClick: () -> Unit, icon: androidx.compose.ui.graphics.vector.ImageVector? = null) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = if (selected) MaterialTheme.colorScheme.surface else Color.Transparent,
        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp), tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private val STORY_TONES = listOf("adventure" to "Adventure", "noir" to "Noir", "fable" to "Fable", "deadpan-technical" to "Deadpan technical")
private val STORY_MOOD_EMOJI = mapOf(
    "problem" to "🧩",
    "attempt" to "🔧",
    "discovery" to "💡",
    "resolution" to "✅",
)

@Composable
private fun StoryContent(
    storyState: StoryState,
    showStylePicker: Boolean,
    onToneChange: (String) -> Unit,
    onBeatCountChange: (Int) -> Unit,
    onTellStory: () -> Unit,
    onRetell: () -> Unit,
    onRetry: () -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (showStylePicker) {
            item {
                StoryStylePicker(
                    tone = storyState.tone,
                    beatCount = storyState.beatCount,
                    hasStory = storyState.story != null,
                    onToneChange = onToneChange,
                    onBeatCountChange = onBeatCountChange,
                    onConfirm = onTellStory,
                )
            }
        }
        if (storyState.loading) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text("Writing the story…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
        if (!storyState.loading && storyState.error != null) {
            item {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.4f),
                ) {
                    Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(storyState.error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.weight(1f))
                        TextButton(onClick = onRetry) { Text("Try again") }
                    }
                }
            }
        }
        if (!storyState.loading && storyState.error == null && storyState.story != null) {
            val story = storyState.story
            item {
                Text(story.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            items(story.beats) { beat ->
                StoryBeatView(caption = beat.caption, moodKey = beat.mood.name, svg = beat.svg)
            }
            item {
                OutlinedButton(onClick = onRetell) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Retell")
                }
            }
        }
        item { Spacer(modifier = Modifier.height(32.dp)) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StoryStylePicker(
    tone: String,
    beatCount: Int,
    hasStory: Boolean,
    onToneChange: (String) -> Unit,
    onBeatCountChange: (Int) -> Unit,
    onConfirm: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Tone", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                STORY_TONES.forEach { (value, label) ->
                    val selected = tone == value
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.6f),
                        modifier = Modifier.clip(RoundedCornerShape(999.dp)).clickable { onToneChange(value) },
                    ) {
                        Text(
                            label,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                        )
                    }
                }
            }
            Text("Beats", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Slider(
                    value = beatCount.toFloat(),
                    onValueChange = { onBeatCountChange(it.toInt()) },
                    valueRange = 3f..5f,
                    steps = 1,
                    modifier = Modifier.weight(1f),
                )
                Text("$beatCount", style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(20.dp))
            }
            Button(onClick = onConfirm, modifier = Modifier.align(Alignment.End)) {
                Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text(if (hasStory) "Retell with this style" else "Tell the story")
            }
        }
    }
}

@Composable
private fun StoryBeatView(caption: String, moodKey: String, svg: String) {
    val nodes = rememberStorySvgNodes(svg)
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.7f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f)),
    ) {
        Row(modifier = Modifier.padding(10.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (nodes != null) {
                    StorySvgCanvas(nodes = nodes, accentColor = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
                } else {
                    Text(STORY_MOOD_EMOJI[moodKey] ?: "💡", style = MaterialTheme.typography.titleMedium)
                }
            }
            Text(caption, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).padding(top = 4.dp))
        }
    }
}

@Composable
private fun LoadedContent(summary: String, commandsTools: List<String>, reproductionGuide: String, mentalModel: String) {
    SelectionContainer {
        LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                DebriefOverviewCard(
                    summary = summary,
                    commandsTools = commandsTools,
                    reproductionGuide = reproductionGuide,
                    mentalModel = mentalModel,
                )
            }
            item { Spacer(modifier = Modifier.height(32.dp)) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DebriefOverviewCard(
    summary: String,
    commandsTools: List<String>,
    reproductionGuide: String,
    mentalModel: String,
) {
    val borderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.35f)
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.18f),
        border = BorderStroke(1.dp, borderColor),
        tonalElevation = 0.dp,
    ) {
        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(
                    Icons.AutoMirrored.Filled.MenuBook,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Text(
                    "Debrief overview",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
            }

            DebriefSection("Summary") {
                Text(summary, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            }

            DebriefSection("Commands & Tools") {
                if (commandsTools.isEmpty()) {
                    DebriefPill("None recorded")
                } else {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        commandsTools.forEach { tool -> DebriefPill(tool) }
                    }
                }
            }

            DebriefSection("How to Reproduce") {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.70f),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                ) {
                    Text(
                        reproductionGuide,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            DebriefSection("Mental Model / Approach") {
                Text(
                    mentalModel,
                    style = MaterialTheme.typography.bodyMedium.copy(fontStyle = FontStyle.Italic),
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun DebriefSection(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            title.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.8.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        content()
    }
}

@Composable
private fun DebriefPill(label: String) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.75f),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
        )
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
