package io.nexy.android.data.model

data class ScheduleGeneratorSpec(
    val name: String,
    val prompt: String,
    val scheduleType: String,
    val localTime: String,
    val weekday: Int? = null,
    val monthDay: Int? = null,
    val timezone: String,
    val agentId: String? = null,
    val projectId: String? = null,
    val notificationPref: String = "always",
    // Defaults to "chat". "automated_workflow" requires sourceRunId — attaches an existing saved
    // Automated Workflow run rather than authoring a new spec inline.
    val targetType: String = "chat",
    val sourceRunId: String? = null,
)
