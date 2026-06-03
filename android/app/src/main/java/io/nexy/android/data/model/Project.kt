package io.nexy.android.data.model

data class Project(
    val id: String,
    val name: String,
    val color: String,
    val chatCount: Int = 0,
    val agentIcons: List<String> = emptyList(),
)
