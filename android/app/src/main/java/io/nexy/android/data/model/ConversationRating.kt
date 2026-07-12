package io.nexy.android.data.model

data class ConversationRatingSnapshot(
    val agentId: String?,
    val agentName: String?,
    val model: String?,
    val backend: String?,
    val projectId: String?,
    val projectName: String?,
    val workflowMode: String?,
    val toolNames: List<String>,
    val serverNames: List<String>,
    val skillIds: List<String>,
    val skillNames: List<String>,
    val keywords: List<String>,
)

data class ConversationRating(
    val id: String,
    val conversationId: String,
    val rating: Int,
    val note: String?,
    val snapshot: ConversationRatingSnapshot,
    val createdAt: Long,
    val updatedAt: Long,
)

data class ConversationRatingListItem(
    val id: String,
    val conversationId: String,
    val conversationTitle: String,
    val projectId: String?,
    val projectName: String?,
    val rating: Int,
    val note: String?,
    val agentName: String?,
    val model: String?,
    val toolNames: List<String>,
    val skillNames: List<String>,
    val createdAt: Long,
    val updatedAt: Long,
)

data class RatingAggregate(
    val label: String,
    val average: Double,
    val count: Int,
)

data class RatingTrendPoint(
    val date: String,
    val average: Double,
    val count: Int,
)

data class ConversationRatingStats(
    val averageByAgent: List<RatingAggregate>,
    val averageByModel: List<RatingAggregate>,
    val averageBySkill: List<RatingAggregate>,
    val averageByServer: List<RatingAggregate>,
    val averageByProject: List<RatingAggregate>,
    val trend: List<RatingTrendPoint>,
)
