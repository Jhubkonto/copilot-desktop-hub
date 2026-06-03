package io.nexy.android.data.model

data class Conversation(
    val id: String,
    val title: String,
    val created_at: String,
    val updated_at: String,
    val agent_name: String? = null,
    val agent_icon: String? = null,
    val project_id: String? = null,
    val project_name: String? = null,
    val last_message: String? = null,
)
