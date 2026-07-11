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
    // Defaults to "chat" — every existing task keeps firing a plain chat message unchanged.
    // "automated_workflow" fires the attached workflowSpecs instead (one or many, sequentially).
    val targetType: String = "chat",
    val workflowSpecs: List<ScheduledTaskWorkflowSpec> = emptyList(),
)

/** One Automated Workflow spec attached to a schedule. workflowSpecJson is a frozen copy of the
 *  spec (captured at attach time), so the schedule's behavior doesn't change if sourceRunId's
 *  original run is later edited/discarded — sourceRunId is only an optional UI back-link. */
data class ScheduledTaskWorkflowSpec(
    val workflowSpecJson: String,
    val sourceRunId: String?,
    val confirmationMode: String,
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
    // Ids of every automated_workflow_runs row spawned by this run, in execution order. Null for
    // a targetType="chat" run (or any run that hasn't spawned a workflow).
    val workflowRunIds: List<String>? = null,
)
