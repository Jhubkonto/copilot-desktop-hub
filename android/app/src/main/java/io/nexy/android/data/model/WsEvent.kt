package io.nexy.android.data.model

sealed class WsEvent {
    data class Connected(val version: String) : WsEvent()
    data class ToolApprovalRequest(
        val requestId: String,
        val toolName: String,
        val args: Map<String, Any>,
    ) : WsEvent()
    data class ChatStreamChunk(val conversationId: String, val text: String) : WsEvent()
    data class ChatStreamEnd(val conversationId: String) : WsEvent()
    data class ChatActivity(
        val conversationId: String,
        val state: String,
        val label: String,
        val toolName: String?,
        val serverName: String?,
    ) : WsEvent()
    data class ConversationList(val conversations: List<Conversation>) : WsEvent()
    data class ConversationMessages(
        val conversationId: String,
        val messages: List<HistoryMessage>,
    ) : WsEvent()
    data class AgentList(val agents: List<Agent>) : WsEvent()
    data class ProjectList(val projects: List<Project>) : WsEvent()
    data class ModelList(val models: List<ModelOption>, val source: ModelListSource?) : WsEvent()
    data class AndroidUpdateManifestResult(val manifest: AndroidUpdateManifest?) : WsEvent()
    data class ErrorReportCaptured(val reportId: String) : WsEvent()
    data class ErrorReportError(val message: String) : WsEvent()
    data class SelfHealInvestigationActivity(val reportId: String, val label: String, val type: String) : WsEvent()
    data class SelfHealInvestigationChunk(val reportId: String, val chunk: String) : WsEvent()
    data class SelfHealInvestigationDone(val reportId: String, val status: String, val error: String?) : WsEvent()
    data class SelfHealVerificationEvent(
        val reportId: String,
        val runId: String,
        val command: String?,
        val status: String,
        val label: String,
        val line: String?,
    ) : WsEvent()
    data class SelfHealVerificationDone(
        val reportId: String,
        val runId: String,
        val status: String,
        val error: String?,
    ) : WsEvent()
    data class SelfHealGitEvent(
        val reportId: String,
        val type: String,
        val label: String,
        val commitSha: String?,
        val error: String?,
    ) : WsEvent()
    data class SelfHealRecoveryEvent(
        val reportId: String,
        val recoveryId: String?,
        val type: String,
        val label: String,
        val status: String?,
        val error: String?,
    ) : WsEvent()
    data class ConversationModelUpdated(val conversationId: String, val model: String?) : WsEvent()
    data class ConversationCreated(
        val id: String,
        val agentId: String?,
        val projectId: String?,
        val title: String,
    ) : WsEvent()
    data class ConversationRenamed(val id: String, val title: String) : WsEvent()
    data class ConversationDeleted(val id: String) : WsEvent()
    data class ConversationSearchResults(val conversations: List<Conversation>) : WsEvent()
    data class MessageDeleted(val id: String) : WsEvent()
    data class SelfHealReports(val reports: List<ErrorReport>) : WsEvent()
    data class ProjectCreated(val project: Project) : WsEvent()
    data class ProjectRenamed(val id: String, val name: String) : WsEvent()
    data class ProjectDeleted(val id: String) : WsEvent()
    data class AgentCreated(val agent: Agent) : WsEvent()
    data class AgentUpdated(val agent: Agent) : WsEvent()
    data class AgentDeleted(val id: String) : WsEvent()
    data class AgentFull(val config: AgentFullConfig) : WsEvent()
    data class ProviderList(val providers: List<ProviderInfo>) : WsEvent()
    data class ProviderKeySet(val provider: String) : WsEvent()
    data class ProviderKeyRemoved(val provider: String) : WsEvent()
    data class CliStatus(val clis: Map<String, CliInstallInfo>) : WsEvent()
    data class SettingSet(val key: String, val value: String) : WsEvent()
    data class McpList(val servers: List<McpServerInfo>) : WsEvent()
    data class ArtifactList(val artifacts: List<ArtifactSummary>) : WsEvent()
    data class ArtifactDetail(val artifact: ArtifactDetail2?) : WsEvent()
    data class WikiList(val entries: List<WikiEntry>) : WsEvent()
    data class WikiEntryCreated(val entry: WikiEntry) : WsEvent()
    data class WikiEntryUpdated(val entry: WikiEntry) : WsEvent()
    data class WikiEntryDeleted(val id: String) : WsEvent()
    data class PromptList(val entries: List<PromptEntry>) : WsEvent()
    data class PromptEntryCreated(val entry: PromptEntry) : WsEvent()
    data class PromptEntryUpdated(val entry: PromptEntry) : WsEvent()
    data class PromptEntryDeleted(val id: String) : WsEvent()
    data class ConversationExportPackResult(val pack: ConversationExportPackData) : WsEvent()
    data class ConversationExportError(val message: String) : WsEvent()
    data class ConversationForked(val conversationId: String, val title: String, val messageCount: Int) : WsEvent()
    data class ConversationForkError(val message: String) : WsEvent()
    data class ConversationImported(val conversationId: String, val title: String, val messageCount: Int) : WsEvent()
    data class ConversationImportError(val message: String) : WsEvent()
    data class ProjectGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class ProjectGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class ProjectGeneratorSpecReady(val sessionId: String?, val spec: ProjectGeneratorSpec) : WsEvent()
    data class ProjectGeneratorCreated(val sessionId: String?, val projectId: String, val name: String) : WsEvent()
    data class ProjectGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class ProjectGeneratorCancelled(val sessionId: String?) : WsEvent()
}

data class ErrorReport(
    val id: String,
    val title: String,
    val description: String,
    val status: String,
    val fixStatus: String,
    val investigationRootCause: String?,
    val investigationMarkdown: String?,
    val createdAt: Long,
)

data class HistoryMessage(
    val id: String,
    val role: String,
    val content: String,
    val timestamp: Long,
    val attachments: List<AttachmentMeta> = emptyList(),
)

data class AttachmentMeta(
    val id: String,
    val name: String,
    val type: String?,
    val thumbnailDataUrl: String?,
)

data class ProviderInfo(
    val id: String,
    val label: String,
    val configured: Boolean,
)

data class CliInstallInfo(
    val installed: Boolean,
    val version: String?,
    val path: String?,
)

data class McpServerInfo(
    val id: String,
    val name: String,
    val command: String,
    val enabled: Boolean,
)

data class ArtifactSummary(
    val id: String,
    val projectId: String?,
    val title: String,
    val kind: String,
    val description: String?,
    val status: String,
    val currentVersionId: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class ArtifactVersionFile(
    val id: String,
    val relativePath: String,
    val mediaType: String,
    val role: String,
)

data class ArtifactVersionSummary(
    val id: String,
    val artifactId: String,
    val versionNumber: Int,
    val title: String,
    val notes: String?,
    val createdAt: Long,
    val files: List<ArtifactVersionFile>,
)

data class ArtifactDetail2(
    val id: String,
    val projectId: String?,
    val title: String,
    val kind: String,
    val description: String?,
    val status: String,
    val currentVersionId: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val currentVersion: ArtifactVersionSummary?,
)

data class WikiEntry(
    val id: String,
    val projectId: String,
    val title: String,
    val body: String,
    val tags: List<String>,
    val sourceConversationId: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class PromptEntry(
    val id: String,
    val title: String,
    val body: String,
    val description: String,
    val category: String,
    val tags: List<String>,
    val scope: String,
    val projectId: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class ProjectGeneratorSpec(
    val name: String,
    val color: String,
    val instructions: String,
    val rootDirectory: String?,
    val instructionMode: String?,
    val variables: List<Map<String, String>>,
    val inScope: List<Map<String, String>>,
    val outOfScope: List<Map<String, String>>,
    val milestones: List<Map<String, String>>,
    val orchestrationEnabled: Boolean,
    val defaultModel: String?,
    val agents: List<ProjectGeneratorAgentSpec>,
)

data class ProjectGeneratorAgentSpec(
    val role: String,
    val description: String,
    val existingAgentId: String?,
    val isLeader: Boolean,
    val newAgent: ProjectGeneratorNewAgent?,
)

data class ProjectGeneratorNewAgent(
    val name: String,
    val icon: String,
    val systemPrompt: String,
    val temperature: Double,
    val responseFormat: String,
    val tools: ProjectGeneratorAgentTools,
)

data class ProjectGeneratorAgentTools(
    val fileEdit: Boolean,
    val terminal: Boolean,
    val webFetch: Boolean,
)

data class ConversationExportPackData(
    val format: String,
    val conversationId: String,
    val fileName: String,
    val mimeType: String,
    val content: String,
)
