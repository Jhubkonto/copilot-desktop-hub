package io.nexy.android.ui.quiz

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.QuizQuestion
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class QuizUiState {
    object CheckingExisting : QuizUiState()
    object Generating : QuizUiState()
    data class Question(
        val question: QuizQuestion,
        val index: Int,
        val total: Int,
        val selected: Int? = null,
    ) : QuizUiState()
    data class Feedback(
        val question: QuizQuestion,
        val index: Int,
        val total: Int,
        val selected: Int,
        val isCorrect: Boolean,
    ) : QuizUiState()
    data class Summary(
        val score: Int,
        val total: Int,
        val categoryBreakdown: Map<String, Pair<Int, Int>>,
    ) : QuizUiState()
    data class Error(val message: String) : QuizUiState()
}

class QuizViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<QuizUiState>(QuizUiState.CheckingExisting)
    val state: StateFlow<QuizUiState> = _state.asStateFlow()

    private var questions: List<QuizQuestion> = emptyList()
    private var answers: MutableList<Int> = mutableListOf()
    private var loadedConversationId: String? = null

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.QuizReady -> {
                        questions = event.questions
                        answers = MutableList(questions.size) { -1 }
                        if (questions.isNotEmpty()) {
                            _state.value = QuizUiState.Question(questions[0], 0, questions.size)
                        } else {
                            _state.value = QuizUiState.Error("No questions generated.")
                        }
                    }
                    is WsEvent.QuizLoaded -> {
                        if (event.conversationId != loadedConversationId) return@collect
                        if (event.questions != null && event.questions.isNotEmpty()) {
                            questions = event.questions
                            answers = MutableList(questions.size) { -1 }
                            _state.value = QuizUiState.Question(questions[0], 0, questions.size)
                        } else {
                            // No quiz exists yet for this conversation — generate one now.
                            _state.value = QuizUiState.Generating
                            WsRepository.generateQuiz(loadedConversationId!!)
                        }
                    }
                    is WsEvent.QuizError -> _state.value = QuizUiState.Error(event.message)
                    else -> {}
                }
            }
        }
    }

    /** Checks for an existing quiz artifact first (mirrors DebriefViewModel.load()) — only
     *  generates a new one if none exists, instead of unconditionally regenerating every time
     *  this screen opens. */
    fun startQuiz(conversationId: String) {
        loadedConversationId = conversationId
        questions = emptyList()
        answers = mutableListOf()
        _state.value = QuizUiState.CheckingExisting
        WsRepository.getQuiz(conversationId)
    }

    fun selectOption(index: Int) {
        val current = _state.value as? QuizUiState.Question ?: return
        _state.value = current.copy(selected = index)
    }

    fun submitAnswer() {
        val current = _state.value as? QuizUiState.Question ?: return
        val selected = current.selected ?: return
        answers[current.index] = selected
        val isCorrect = selected == current.question.correctIndex
        _state.value = QuizUiState.Feedback(
            question = current.question,
            index = current.index,
            total = current.total,
            selected = selected,
            isCorrect = isCorrect,
        )
    }

    fun nextQuestion() {
        val current = _state.value as? QuizUiState.Feedback ?: return
        val nextIndex = current.index + 1
        if (nextIndex < questions.size) {
            _state.value = QuizUiState.Question(questions[nextIndex], nextIndex, current.total)
        } else {
            val score = answers.indices.count { i -> answers[i] == questions[i].correctIndex }
            val breakdown = questions.groupBy { it.category }.mapValues { (_, qs) ->
                val correct = qs.count { q ->
                    val idx = questions.indexOf(q)
                    idx >= 0 && answers[idx] == q.correctIndex
                }
                correct to qs.size
            }
            _state.value = QuizUiState.Summary(score, questions.size, breakdown)
        }
    }

    /** Explicit user request for a fresh attempt — always regenerates rather than reusing the
     *  cached quiz, unlike startQuiz() which only generates when nothing exists yet. */
    fun tryAgain(conversationId: String) {
        loadedConversationId = conversationId
        questions = emptyList()
        answers = mutableListOf()
        _state.value = QuizUiState.Generating
        WsRepository.generateQuiz(conversationId)
    }
}
