package io.nexy.android.data.model

data class TeachbackExercise(
    val prompt: String,
    val keyPoints: List<String>,
    val sourceLabel: String,
)

data class TeachbackRubricDimension(val score: Int, val feedback: String)

data class TeachbackFeedback(
    val accuracy: TeachbackRubricDimension,
    val completeness: TeachbackRubricDimension,
    val clarity: TeachbackRubricDimension,
    val strengths: List<String>,
    val corrections: List<String>,
    val followUpQuestions: List<String>,
    val attemptId: String? = null,
    val prompt: String? = null,
    val turnNumber: Int = 0,
    val attemptedAt: Long? = null,
)

data class TeachbackAttempt(
    val id: String,
    val artifactId: String,
    val versionId: String,
    val parentAttemptId: String?,
    val turnNumber: Int,
    val prompt: String,
    val transcript: String,
    val feedback: TeachbackFeedback,
    val attemptedAt: Long,
)
