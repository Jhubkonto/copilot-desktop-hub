package io.nexy.android.data.model

data class ConversationDebrief(
    val id: String,
    val conversationId: String,
    val projectId: String?,
    val summary: String,
    val commandsTools: List<String>,
    val reproductionGuide: String,
    val mentalModel: String,
    val generatedAt: Long,
    val createdAt: Long,
)
