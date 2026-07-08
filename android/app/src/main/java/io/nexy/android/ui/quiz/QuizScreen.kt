package io.nexy.android.ui.quiz

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.SuggestionChipDefaults
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuizScreen(
    conversationId: String,
    onBack: () -> Unit,
    vm: QuizViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()

    LaunchedEffect(conversationId) { vm.startQuiz(conversationId) }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Quiz") },
                onBack = onBack,
            )
        },
    ) { padding ->
        AnimatedContent(
            targetState = state,
            transitionSpec = {
                when (targetState) {
                    is QuizUiState.Summary ->
                        (slideInVertically(tween(300)) { it / 6 } + fadeIn(tween(250))) togetherWith fadeOut(tween(150))
                    else ->
                        (slideInHorizontally(tween(280)) { it / 4 } + fadeIn(tween(250))) togetherWith (slideOutHorizontally(tween(220)) { -it / 4 } + fadeOut(tween(150)))
                }
            },
            label = "quiz-state",
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) { currentState ->
            when (currentState) {
                is QuizUiState.CheckingExisting -> GeneratingContent()
                is QuizUiState.Generating -> GeneratingContent()
                is QuizUiState.Question -> QuestionContent(
                    state = currentState,
                    onSelect = { vm.selectOption(it) },
                    onSubmit = { vm.submitAnswer() },
                )
                is QuizUiState.Feedback -> FeedbackContent(
                    state = currentState,
                    onNext = { vm.nextQuestion() },
                )
                is QuizUiState.Summary -> SummaryContent(
                    state = currentState,
                    onTryAgain = { vm.tryAgain(conversationId) },
                    onDone = onBack,
                )
                is QuizUiState.Error -> ErrorContent(
                    message = currentState.message,
                    onRetry = { vm.startQuiz(conversationId) },
                )
            }
        }
    }
}

@Composable
private fun GeneratingContent() {
    var showLabel by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(600)
        showLabel = true
    }
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            androidx.compose.material3.CircularProgressIndicator()
            AnimatedVisibility(visible = showLabel, enter = fadeIn(tween(400))) {
                Text("Generating quiz questions…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun QuestionContent(
    state: QuizUiState.Question,
    onSelect: (Int) -> Unit,
    onSubmit: () -> Unit,
) {
    val progress by animateFloatAsState(
        targetValue = (state.index + 1).toFloat() / state.total,
        animationSpec = tween(400),
        label = "quiz-progress",
    )
    val submitAlpha by animateFloatAsState(
        targetValue = if (state.selected != null) 1f else 0.4f,
        animationSpec = tween(200),
        label = "submit-alpha",
    )

    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            QuizPanel(title = "Quiz question") {
                LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth(), trackColor = MaterialTheme.colorScheme.surfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${state.index + 1} / ${state.total}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    CategoryChip(state.question.category)
                }
                Text(state.question.question, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                state.question.options.forEachIndexed { i, option ->
                    val isSelected = state.selected == i
                    val borderColor by animateColorAsState(
                        targetValue = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                        animationSpec = tween(200),
                        label = "option-border-$i",
                    )
                    val bgColor by animateColorAsState(
                        targetValue = if (isSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f) else Color.Transparent,
                        animationSpec = tween(200),
                        label = "option-bg-$i",
                    )
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(width = if (isSelected) 2.dp else 1.dp, color = borderColor, shape = MaterialTheme.shapes.medium)
                            .clip(MaterialTheme.shapes.medium)
                            .background(bgColor)
                            .clickable { onSelect(i) },
                        color = Color.Transparent,
                    ) {
                        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(
                                modifier = Modifier.size(28.dp).background(if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = listOf("A", "B", "C", "D")[i],
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (isSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                            Text(option, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        }
                    }
                }
                FilledTonalButton(
                    onClick = onSubmit,
                    enabled = state.selected != null,
                    modifier = Modifier.fillMaxWidth().alpha(submitAlpha),
                ) {
                    Text("Submit")
                }
            }
        }
    }
}

@Composable
private fun FeedbackContent(state: QuizUiState.Feedback, onNext: () -> Unit) {
    var showExplanation by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(150)
        showExplanation = true
    }

    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            QuizPanel(title = "Answer review") {
                AnimatedVisibility(
                    visible = true,
                    enter = slideInVertically(tween(300)) { -it } + fadeIn(tween(300)),
                ) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = if (state.isCorrect) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.errorContainer,
                        shape = MaterialTheme.shapes.medium,
                    ) {
                        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(
                                imageVector = if (state.isCorrect) Icons.Default.CheckCircle else Icons.Default.ErrorOutline,
                                contentDescription = null,
                                tint = if (state.isCorrect) MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onErrorContainer,
                            )
                            Text(
                                text = if (state.isCorrect) "Correct!" else "Incorrect",
                                style = MaterialTheme.typography.titleSmall,
                                color = if (state.isCorrect) MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                    }
                }

                state.question.options.forEachIndexed { i, option ->
                    val isCorrect = i == state.question.correctIndex
                    val isWrongSelected = i == state.selected && !state.isCorrect
                    val borderColor by animateColorAsState(
                        targetValue = when {
                            isCorrect -> Color(0xFF34D399)
                            isWrongSelected -> MaterialTheme.colorScheme.error
                            else -> MaterialTheme.colorScheme.outline
                        },
                        animationSpec = tween(300),
                        label = "feedback-border-$i",
                    )
                    val bgColor by animateColorAsState(
                        targetValue = when {
                            isCorrect -> MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.4f)
                            isWrongSelected -> MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.4f)
                            else -> Color.Transparent
                        },
                        animationSpec = tween(300),
                        label = "feedback-bg-$i",
                    )
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(width = if (isCorrect || isWrongSelected) 2.dp else 1.dp, color = borderColor, shape = MaterialTheme.shapes.medium)
                            .clip(MaterialTheme.shapes.medium)
                            .background(bgColor),
                        color = Color.Transparent,
                    ) {
                        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(
                                modifier = Modifier.size(28.dp).background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(listOf("A", "B", "C", "D")[i], style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                            }
                            Text(option, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        }
                    }
                }

                AnimatedVisibility(visible = showExplanation, enter = expandVertically(tween(350)) + fadeIn(tween(350))) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.78f),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Explanation", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                            Text(state.question.explanation, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }

                FilledTonalButton(onClick = onNext, modifier = Modifier.fillMaxWidth()) {
                    Text(if (state.index + 1 < state.total) "Next Question" else "See Results")
                }
            }
        }
    }
}

@Composable
private fun SummaryContent(state: QuizUiState.Summary, onTryAgain: () -> Unit, onDone: () -> Unit) {
    val animatedScore by animateIntAsState(
        targetValue = state.score,
        animationSpec = tween(800),
        label = "score-count",
    )
    val motivationLabel = when {
        state.score == state.total -> "Perfect score!"
        state.score.toFloat() / state.total >= 0.8f -> "Great job!"
        state.score.toFloat() / state.total >= 0.5f -> "Good effort!"
        else -> "Keep practicing!"
    }

    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Text("$animatedScore / ${state.total}", style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                Text(motivationLabel, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        if (state.categoryBreakdown.isNotEmpty()) {
            item {
                Text("By Category", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            }
            item {
                val categories = state.categoryBreakdown.entries.toList()
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    categories.chunked(2).forEachIndexed { rowIndex, rowCats ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            rowCats.forEachIndexed { colIndex, (cat, pair) ->
                                val staggerIndex = rowIndex * 2 + colIndex
                                var visible by remember { mutableStateOf(false) }
                                LaunchedEffect(Unit) {
                                    kotlinx.coroutines.delay(staggerIndex * 100L)
                                    visible = true
                                }
                                AnimatedVisibility(visible = visible, enter = fadeIn(tween(300)) + slideInVertically(tween(300)) { it / 3 }, modifier = Modifier.weight(1f)) {
                                    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                                        Column(modifier = Modifier.padding(12.dp)) {
                                            Text(cat.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            Text("${pair.first} / ${pair.second}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                        }
                                    }
                                }
                            }
                            if (rowCats.size == 1) Spacer(modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = onTryAgain, modifier = Modifier.weight(1f)) { Text("Try Again") }
                FilledTonalButton(onClick = onDone, modifier = Modifier.weight(1f)) { Text("Done") }
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

@Composable
private fun QuizPanel(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.16f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.30f)),
        tonalElevation = 0.dp,
    ) {
        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(
                    Icons.Default.Psychology,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
            }
            content()
        }
    }
}

@Composable
private fun CategoryChip(category: String) {
    val chipColor = when (category) {
        "command" -> MaterialTheme.colorScheme.primaryContainer
        "concept" -> MaterialTheme.colorScheme.secondaryContainer
        "sequence" -> Color(0xFFFEF3C7)
        "approach" -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
    val textColor = when (category) {
        "command" -> MaterialTheme.colorScheme.onPrimaryContainer
        "concept" -> MaterialTheme.colorScheme.onSecondaryContainer
        "sequence" -> Color(0xFF92400E)
        "approach" -> MaterialTheme.colorScheme.onTertiaryContainer
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    SuggestionChip(
        onClick = {},
        label = { Text(category.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall) },
        colors = SuggestionChipDefaults.suggestionChipColors(containerColor = chipColor, labelColor = textColor),
    )
}
