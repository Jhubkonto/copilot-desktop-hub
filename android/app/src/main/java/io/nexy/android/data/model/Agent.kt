package io.nexy.android.data.model

data class Agent(
    val id: String,
    val name: String,
    val icon: String = "",
    val backend: String? = null,
    val cliModel: String? = null,
)
