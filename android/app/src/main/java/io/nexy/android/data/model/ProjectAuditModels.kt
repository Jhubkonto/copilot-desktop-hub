package io.nexy.android.data.model

data class ProjectAuditSession(
    val id: String,
    val projectId: String,
    val conversationId: String?,
    val agentId: String?,
    val title: String,
    val source: String,
    val createdAt: Long,
    val updatedAt: Long,
    val fileCount: Int,
)

data class ProjectAuditFile(
    val sessionId: String,
    val relativePath: String,
    val status: String,
    val lastOperation: String,
    val firstTouchedAt: Long,
    val lastTouchedAt: Long,
    val diffAvailable: Boolean,
)

data class ProjectAuditDiff(
    val relativePath: String,
    val hunksJson: String?,
)
