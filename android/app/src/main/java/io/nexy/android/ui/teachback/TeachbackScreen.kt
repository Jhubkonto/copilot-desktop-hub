package io.nexy.android.ui.teachback

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.TeachbackFeedback
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.service.NexySpeechService

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeachbackScreen(conversationId: String, artifactId: String?, onBack: () -> Unit, vm: TeachbackViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    DisposableEffect(context, conversationId) {
        onDispose { NexySpeechService.command(context, NexySpeechService.ACTION_STOP) }
    }
    val speechLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            if (!text.isNullOrBlank()) vm.setTranscript(text)
        }
    }
    val record: () -> Unit = {
        NexySpeechService.command(context, NexySpeechService.ACTION_STOP)
        speechLauncher.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Explain the concept in your own words")
        })
    }
    val speakPrompt: (String) -> Unit = { prompt ->
        NexySpeechService.play(
            context = context,
            text = prompt,
            messageId = "teachback-prompt",
            conversationId = conversationId,
        )
    }
    LaunchedEffect(conversationId, artifactId) { vm.load(conversationId, artifactId) }

    Scaffold(topBar = { NexyTopAppBar(titleContent = { Text("Teach-back") }, onBack = onBack) }) { padding ->
        when (val current = state) {
            TeachbackUiState.Loading -> Column(Modifier.fillMaxSize().padding(padding), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { CircularProgressIndicator(); Text("Preparing teach-back…", modifier = Modifier.padding(top = 12.dp)) }
            is TeachbackUiState.Error -> Column(Modifier.fillMaxSize().padding(padding).padding(24.dp), verticalArrangement = Arrangement.Center) { Text(current.message, color = MaterialTheme.colorScheme.error); Button(onClick = { vm.load(conversationId, artifactId) }, modifier = Modifier.padding(top = 12.dp)) { Text("Try again") } }
            is TeachbackUiState.Practice -> PracticeContent(current, padding, record, { speakPrompt(current.prompt) }, vm::setTranscript, vm::grade)
            is TeachbackUiState.Grading -> PracticeContent(TeachbackUiState.Practice(current.exercise, current.prompt, current.transcript, current.turnNumber), padding, {}, { speakPrompt(current.prompt) }, {}, {}, grading = true)
            is TeachbackUiState.Feedback -> FeedbackContent(current, padding, { speakPrompt(current.prompt) }, vm::answerFollowUp, vm::tryAgain)
        }
    }
}

@Composable
private fun PracticeContent(state: TeachbackUiState.Practice, padding: PaddingValues, onRecord: () -> Unit, onSpeak: () -> Unit, onTranscript: (String) -> Unit, onGrade: () -> Unit, grading: Boolean = false) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { TeachbackPanel {
            Text(if (state.turnNumber == 0) "Explain in your own words" else "Viva follow-up ${state.turnNumber} of 2", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(state.prompt, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onSpeak) { Icon(Icons.Default.RecordVoiceOver, null); Text("Read aloud", modifier = Modifier.padding(start = 6.dp)) }
                FilledTonalButton(onClick = onRecord, enabled = !grading) { Icon(Icons.Default.Mic, null); Text("Record", modifier = Modifier.padding(start = 6.dp)) }
            }
            OutlinedTextField(value = state.transcript, onValueChange = onTranscript, label = { Text("Transcript") }, minLines = 5, modifier = Modifier.fillMaxWidth(), enabled = !grading)
            Button(onClick = onGrade, enabled = state.transcript.isNotBlank() && !grading, modifier = Modifier.fillMaxWidth()) { if (grading) CircularProgressIndicator() else Text("Grade explanation") }
            if (state.savedTurns > 0) Text("${state.savedTurns} saved turns for this version", style = MaterialTheme.typography.labelSmall)
        } }
    }
}

@Composable
private fun FeedbackContent(state: TeachbackUiState.Feedback, padding: PaddingValues, onSpeak: () -> Unit, onFollowUp: (String) -> Unit, onTryAgain: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { TeachbackPanel {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { Text(state.prompt, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)); OutlinedButton(onClick = onSpeak) { Text("Listen") } }
            Rubric(state.feedback)
            if (state.feedback.strengths.isNotEmpty()) FeedbackList("What landed", state.feedback.strengths)
            if (state.feedback.corrections.isNotEmpty()) FeedbackList("Corrections", state.feedback.corrections)
            if (state.feedback.followUpQuestions.isNotEmpty()) FeedbackList("Probe deeper", state.feedback.followUpQuestions)
            if (state.turnNumber < 2 && state.feedback.followUpQuestions.isNotEmpty()) Button(onClick = { onFollowUp(state.feedback.followUpQuestions.first()) }, modifier = Modifier.fillMaxWidth()) { Text("Answer next question") }
            OutlinedButton(onClick = onTryAgain, modifier = Modifier.fillMaxWidth()) { Text("Start over") }
            Text("${state.savedTurns} saved turns", style = MaterialTheme.typography.labelSmall)
        } }
    }
}

@Composable private fun Rubric(feedback: TeachbackFeedback) { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { listOf("Accuracy" to feedback.accuracy, "Completeness" to feedback.completeness, "Clarity" to feedback.clarity).forEach { (label, value) -> Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) { Column(Modifier.fillMaxWidth().padding(10.dp)) { Text("$label ${value.score}/5", fontWeight = FontWeight.Bold); Text(value.feedback, style = MaterialTheme.typography.bodySmall) } } } } }
@Composable private fun FeedbackList(title: String, values: List<String>) { Column { Text(title, fontWeight = FontWeight.Bold); values.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) } } }
@Composable private fun TeachbackPanel(content: @Composable () -> Unit) { Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = .25f)) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { content() } } }
