package io.nexy.android.data.model

data class Conversation(
    val id: String,
    val title: String,
    val created_at: String,
    val updated_at: String,
    val agent_id: String? = null,
    val agent_name: String? = null,
    val agent_icon: String? = null,
    val project_id: String? = null,
    val project_name: String? = null,
    val model: String? = null,
    val last_message: String? = null,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val completed_at: Long? = null,
    val thinking_effort_override: String? = null,
    val full_auto_approve_override: Boolean? = null,
)

data class ModelOption(
    val id: String,
    val label: String,
    val vendor: String? = null,
    val isCliSourced: Boolean = false,
)

data class ModelListSource(
    val type: String,
    val label: String,
    val backend: String? = null,
)
