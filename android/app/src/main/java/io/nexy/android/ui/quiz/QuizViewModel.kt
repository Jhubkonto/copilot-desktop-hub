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
    /** No quiz exists yet for this conversation (or the user asked to regenerate) — mirrors
     *  desktop's QuizSpecDialog, shown here before generation ever starts rather than only on
     *  "Regenerate", so first-time generation is also customizable. */
    object ReadyToGenerate : QuizUiState()
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

/** Pre-generation spec — mirrors desktop's QuizSpec (source/difficulty/topic/questionCount). */
data class QuizSpecState(
    val source: String = "conversation",
    val difficulty: String = "medium",
    val topic: String = "",
    val questionCount: Int? = null,
)

class QuizViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<QuizUiState>(QuizUiState.CheckingExisting)
    val state: StateFlow<QuizUiState> = _state.asStateFlow()

    private val _specState = MutableStateFlow(QuizSpecState())
    val specState: StateFlow<QuizSpecState> = _specState.asStateFlow()

    private var questions: List<QuizQuestion> = emptyList()
    private var answers: MutableList<Int> = mutableListOf()
    private var loadedConversationId: String? = null
    // True while waiting on a startQuizForArtifact() lookup — a specific, already-confirmed-
    // to-exist quiz was tapped, so an empty result here means something's actually wrong
    // (corrupt/missing file, deleted artifact), not "no quiz yet." That must surface as an
    // error, never silently fall through to generating an unwanted replacement quiz.
    private var isArtifactLookup: Boolean = false

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
                        } else if (isArtifactLookup) {
                            _state.value = QuizUiState.Error(
                                "This quiz could not be loaded. It may have been deleted or its content is missing.",
                            )
                        } else {
                            // No quiz exists yet for this conversation — let the user customize
                            // source/difficulty/topic/count before generating, rather than
                            // silently generating with hidden defaults.
                            _state.value = QuizUiState.ReadyToGenerate
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
        isArtifactLookup = false
        questions = emptyList()
        answers = mutableListOf()
        _state.value = QuizUiState.CheckingExisting
        WsRepository.getQuiz(conversationId)
    }

    /**
     * Loads a specific, already-known quiz by artifact id instead of re-deriving "the quiz
     * for this conversation" server-side. The chat card that opened this screen already
     * resolved its exact artifactId (and confirmed it's a real, ready quiz) before the user
     * ever tapped it — re-deriving by conversationId alone can miss for older/unlinked rows
     * and silently fall through to "no quiz found, generate a new one" instead, which is
     * exactly the bug this bypasses: tapping an existing quiz must never trigger regeneration.
     */
    fun startQuizForArtifact(conversationId: String, artifactId: String) {
        loadedConversationId = conversationId
        isArtifactLookup = true
        questions = emptyList()
        answers = mutableListOf()
        _state.value = QuizUiState.CheckingExisting
        WsRepository.getQuizByArtifact(conversationId, artifactId)
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

    /** Explicit user request for a fresh attempt — routes back through the spec dialog rather
     *  than immediately regenerating with whatever spec was last used, unlike startQuiz() which
     *  only opens the dialog when nothing exists yet. */
    fun tryAgain(conversationId: String) {
        loadedConversationId = conversationId
        isArtifactLookup = false
        questions = emptyList()
        answers = mutableListOf()
        _state.value = QuizUiState.ReadyToGenerate
    }

    fun setSource(source: String) {
        _specState.value = _specState.value.copy(source = source)
    }

    fun setDifficulty(difficulty: String) {
        _specState.value = _specState.value.copy(difficulty = difficulty)
    }

    fun setTopic(topic: String) {
        _specState.value = _specState.value.copy(topic = topic)
    }

    fun setQuestionCount(count: Int?) {
        _specState.value = _specState.value.copy(questionCount = count)
    }

    /** Kicks off generation with the current spec — used both for first-time generation and
     *  for "Try Again", which now routes back through ReadyToGenerate instead of reusing the
     *  previous spec silently. */
    fun generateWithSpec() {
        val id = loadedConversationId ?: return
        val spec = _specState.value
        _state.value = QuizUiState.Generating
        WsRepository.generateQuiz(
            conversationId = id,
            source = spec.source,
            topic = spec.topic.trim().ifBlank { null },
            difficulty = spec.difficulty,
            questionCount = spec.questionCount,
        )
    }
}
