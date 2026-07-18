package io.nexy.android.ui.teachback

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.TeachbackAttempt
import io.nexy.android.data.model.TeachbackExercise
import io.nexy.android.data.model.TeachbackFeedback
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class TeachbackUiState {
    object Loading : TeachbackUiState()
    data class Practice(val exercise: TeachbackExercise, val prompt: String, val transcript: String = "", val turnNumber: Int = 0, val savedTurns: Int = 0) : TeachbackUiState()
    data class Grading(val exercise: TeachbackExercise, val prompt: String, val transcript: String, val turnNumber: Int) : TeachbackUiState()
    data class Feedback(val exercise: TeachbackExercise, val prompt: String, val transcript: String, val feedback: TeachbackFeedback, val turnNumber: Int, val savedTurns: Int) : TeachbackUiState()
    data class Error(val message: String) : TeachbackUiState()
}

class TeachbackViewModel(app: Application) : AndroidViewModel(app) {
    private val _state = MutableStateFlow<TeachbackUiState>(TeachbackUiState.Loading)
    val state: StateFlow<TeachbackUiState> = _state.asStateFlow()
    private var conversationId = ""
    private var artifactId: String? = null
    private var versionId: String? = null
    private var parentAttemptId: String? = null
    private var exercise: TeachbackExercise? = null
    private var attempts: List<TeachbackAttempt> = emptyList()

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.TeachbackReady -> if (event.conversationId == conversationId) acceptExercise(event.artifactId, event.versionId, event.exercise)
                    is WsEvent.TeachbackLoaded -> if (event.conversationId == conversationId) {
                        if (event.exercise == null || event.artifactId == null || event.versionId == null) WsRepository.generateTeachback(conversationId)
                        else acceptExercise(event.artifactId, event.versionId, event.exercise)
                    }
                    is WsEvent.TeachbackAttempts -> if (event.artifactId == artifactId) restoreAttempts(event.attempts)
                    is WsEvent.TeachbackGraded -> if (event.artifactId == artifactId && event.versionId == versionId) {
                        val current = _state.value as? TeachbackUiState.Grading ?: return@collect
                        parentAttemptId = parentAttemptId ?: event.feedback.attemptId
                        _state.value = TeachbackUiState.Feedback(current.exercise, current.prompt, current.transcript, event.feedback, current.turnNumber, attempts.size + 1)
                        artifactId?.let(WsRepository::getTeachbackAttempts)
                    }
                    is WsEvent.TeachbackError -> _state.value = TeachbackUiState.Error(event.message)
                    else -> Unit
                }
            }
        }
    }

    fun load(conversationId: String, artifactId: String?) {
        this.conversationId = conversationId
        this.artifactId = artifactId
        _state.value = TeachbackUiState.Loading
        if (artifactId.isNullOrBlank()) WsRepository.getTeachback(conversationId)
        else WsRepository.getTeachbackByArtifact(conversationId, artifactId)
    }

    private fun acceptExercise(artifactId: String, versionId: String, exercise: TeachbackExercise) {
        this.artifactId = artifactId; this.versionId = versionId; this.exercise = exercise
        _state.value = TeachbackUiState.Practice(exercise, exercise.prompt)
        WsRepository.getTeachbackAttempts(artifactId)
    }

    private fun restoreAttempts(history: List<TeachbackAttempt>) {
        attempts = history.filter { it.versionId == versionId }
        val latest = attempts.lastOrNull() ?: return
        parentAttemptId = latest.parentAttemptId ?: latest.id
        val currentExercise = exercise ?: return
        _state.value = TeachbackUiState.Feedback(currentExercise, latest.prompt, latest.transcript, latest.feedback.copy(attemptId = latest.id), latest.turnNumber, attempts.size)
    }

    fun setTranscript(value: String) {
        val current = _state.value as? TeachbackUiState.Practice ?: return
        _state.value = current.copy(transcript = value)
    }

    fun grade() {
        val current = _state.value as? TeachbackUiState.Practice ?: return
        if (current.transcript.isBlank()) return
        val aid = artifactId ?: return; val vid = versionId ?: return
        _state.value = TeachbackUiState.Grading(current.exercise, current.prompt, current.transcript, current.turnNumber)
        WsRepository.gradeTeachback(aid, vid, current.transcript, current.prompt, parentAttemptId, current.turnNumber)
    }

    fun answerFollowUp(question: String) {
        val current = _state.value as? TeachbackUiState.Feedback ?: return
        _state.value = TeachbackUiState.Practice(current.exercise, question, turnNumber = current.turnNumber + 1, savedTurns = current.savedTurns)
    }

    fun tryAgain() {
        val currentExercise = exercise ?: return
        parentAttemptId = null
        _state.value = TeachbackUiState.Practice(currentExercise, currentExercise.prompt, savedTurns = attempts.size)
    }
}
