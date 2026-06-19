package io.nexy.android.data.model

data class AgentFullConfig(
    val id: String,
    val name: String,
    val icon: String = "",
    val systemPrompt: String = "",
    val backend: String? = null,
    val cliModel: String? = null,
    val temperature: Float = 0.7f,
    val maxTokens: Int = 8192,
    val responseFormat: String = "default",
    val agenticMode: Boolean = false,
    val memory: String = "",
    val tools: AgentTools = AgentTools(),
    val mcpServers: List<String> = emptyList(),
    val thinkingEffort: String? = null,
    val rootDirectory: String? = null,
    val contextDirectories: List<String> = emptyList(),
    val contextFiles: List<String> = emptyList(),
    val contextRules: AgentContextRules? = null,
    val customCommands: List<AgentCustomCommand> = emptyList(),
)

data class AgentTools(
    val fileEdit: ToolConfig = ToolConfig(enabled = true, approval = "always-ask"),
    val terminal: ToolConfig = ToolConfig(enabled = false, approval = "always-ask"),
    val webFetch: ToolConfig = ToolConfig(enabled = true, approval = "auto"),
)

data class ToolConfig(
    val enabled: Boolean = true,
    val approval: String = "always-ask",
    val instructions: String = "",
)

data class AgentContextRules(
    val ignoredGlobs: List<String> = emptyList(),
    val autoInjectWorkspace: Boolean = true,
    val autoInjectGit: Boolean = true,
)

data class AgentCustomCommand(
    val name: String,
    val description: String,
    val prompt: String,
)
