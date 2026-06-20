package io.nexy.android.ui.home

import io.nexy.android.data.model.AgentFullConfig

internal fun buildAgentUpdatePayload(config: AgentFullConfig): Map<String, Any> {
    val tools = mapOf(
        "fileEdit" to mapOf(
            "enabled" to config.tools.fileEdit.enabled,
            "approval" to config.tools.fileEdit.approval,
            "instructions" to config.tools.fileEdit.instructions,
        ),
        "terminal" to mapOf(
            "enabled" to config.tools.terminal.enabled,
            "approval" to config.tools.terminal.approval,
            "instructions" to config.tools.terminal.instructions,
        ),
        "webFetch" to mapOf(
            "enabled" to config.tools.webFetch.enabled,
            "approval" to config.tools.webFetch.approval,
            "instructions" to config.tools.webFetch.instructions,
        ),
    )
    val contextRules = config.contextRules
    val contextRulesPayload = mapOf(
        "ignoredGlobs" to (contextRules?.ignoredGlobs ?: emptyList()),
        "autoInjectWorkspace" to (contextRules?.autoInjectWorkspace ?: true),
        "autoInjectGit" to (contextRules?.autoInjectGit ?: true),
    )
    val customCommands = config.customCommands.map {
        mapOf("name" to it.name, "description" to it.description, "prompt" to it.prompt)
    }

    return buildMap {
        put("id", config.id)
        put("name", config.name)
        put("icon", config.icon)
        put("systemPrompt", config.systemPrompt)
        put("memory", config.memory)
        put("agenticMode", config.agenticMode)
        put("backend", config.backend ?: "")
        put("cliModel", config.cliModel ?: "")
        put("responseFormat", config.responseFormat)
        put("temperature", config.temperature)
        put("maxTokens", config.maxTokens.coerceIn(256, 128000))
        put("tools", tools)
        put("mcpServers", config.mcpServers)
        put("thinkingEffort", config.thinkingEffort ?: "")
        put("rootDirectory", config.rootDirectory ?: "")
        put("contextDirectories", config.contextDirectories)
        put("contextFiles", config.contextFiles)
        put("contextRules", contextRulesPayload)
        put("customCommands", customCommands)
    }
}
