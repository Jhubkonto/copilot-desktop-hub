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
    // Optional model id the fired chat runs on (null = app/agent default).
    val model: String? = null,
    val notificationPref: String = "failures_only",
    // Tool names the fired chat may call unattended (see ScheduledTaskToolPolicy). A scheduled run
    // blocks any tool not listed here.
    val preApproved: List<String> = emptyList(),
    // Defaults to "chat". "automated_workflow" requires sourceRunId — attaches an existing saved
    // Automated Workflow run rather than authoring a new spec inline.
    val targetType: String = "chat",
    val sourceRunId: String? = null,
)
