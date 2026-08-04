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
    val id: String,
    val sessionId: String,
    val sourceId: String?,
    val sourceLabel: String?,
    val repositoryId: String?,
    val repositoryLabel: String?,
    val repositoryAvailable: Boolean?,
    val relativePath: String,
    val displayPath: String,
    val status: String,
    val lastOperation: String,
    val branch: String?,
    val commitHash: String?,
    val legacyRepositoryUnknown: Boolean,
    val firstTouchedAt: Long,
    val lastTouchedAt: Long,
    val diffAvailable: Boolean,
)

data class ProjectAuditDiff(
    val fileId: String?,
    val relativePath: String,
    val hunksJson: String?,
)
