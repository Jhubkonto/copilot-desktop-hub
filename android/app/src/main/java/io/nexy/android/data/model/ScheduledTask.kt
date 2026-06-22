package io.nexy.android.data.model

data class ScheduledTask(
    val id: String,
    val name: String,
    val prompt: String,
    val enabled: Boolean,
    val agentId: String?,
    val projectId: String?,
    val model: String?,
    val conversationId: String?,
    val scheduleType: String,
    val localTime: String,
    val weekday: Int?,
    val monthDay: Int?,
    val timezone: String,
    val notificationPref: String,
    val nextRunAt: Long?,
    val lastRunAt: Long?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class ScheduledRun(
    val id: String,
    val taskId: String,
    val scheduledAt: Long?,
    val startedAt: Long?,
    val finishedAt: Long?,
    val status: String,
    val error: String?,
    val conversationId: String?,
    val messageId: String?,
    val triggerSource: String,
    val createdAt: Long,
)
