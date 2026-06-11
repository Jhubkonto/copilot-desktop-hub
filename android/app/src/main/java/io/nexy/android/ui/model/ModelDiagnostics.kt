package io.nexy.android.ui.model

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption

fun modelSourceTitle(source: ModelListSource?): String =
    source?.label?.takeIf { it.isNotBlank() } ?: "Model source unknown"

fun modelSourceDetail(source: ModelListSource?, modelCount: Int): String {
    if (source == null) return "Open a chat or refresh models to load backend details."
    return when (source.type) {
        "cli" -> {
            val backend = backendDisplayName(source.backend)
            "$backend is providing ${modelCountLabel(modelCount)}."
        }
        "provider" -> "${source.label} are available from configured API providers."
        "none" -> "No CLI or API provider is configured on the paired desktop."
        else -> source.backend?.let { "Backend: ${backendDisplayName(it)}" } ?: source.label
    }
}

fun activeModelLabel(selectedModel: String?, models: List<ModelOption>): String {
    val id = selectedModel?.takeIf { it.isNotBlank() && it != "default" } ?: "default"
    return models.find { it.id == id }?.label ?: if (id == "default") "Default model" else id
}

fun activeModelDetail(
    selectedModel: String?,
    agent: Agent?,
    source: ModelListSource?,
): String {
    if (!selectedModel.isNullOrBlank() && selectedModel != "default") {
        return "This conversation overrides the default model."
    }
    val agentModel = agent?.cliModel?.takeIf { it.isNotBlank() }
    if (agentModel != null) return "Using ${agent.name}'s default model: $agentModel."
    val backend = agent?.backend ?: source?.backend
    if (!backend.isNullOrBlank()) return "Using the default model for ${backendDisplayName(backend)}."
    return "Using the desktop default model when no agent or project default applies."
}

fun emptyModelListDetail(source: ModelListSource?): String =
    when (source?.type) {
        "none" -> "Configure Claude CLI, Codex CLI, or an API provider on desktop to choose models here."
        null -> "Model options have not loaded yet. Refresh models or check the desktop connection."
        else -> "No selectable models were returned for ${modelSourceTitle(source)}."
    }

private fun modelCountLabel(count: Int): String =
    if (count == 1) "1 model" else "$count models"

private fun backendDisplayName(backend: String?): String =
    when (backend) {
        "claude-cli" -> "Claude CLI"
        "codex-cli" -> "Codex CLI"
        null, "" -> "the selected backend"
        else -> backend
    }
