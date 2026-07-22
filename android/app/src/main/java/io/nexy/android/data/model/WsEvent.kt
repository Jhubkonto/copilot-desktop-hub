package io.nexy.android.data.model

data class RemoteEditStagedFileEntry(
    val relativePath: String,
    val diffLineCount: Int,
    val reviewed: Boolean,
)

/** One child of a remotely-browsed desktop directory (see WsEvent.FsDirectoryListing).
 *  [fullPath] is joined server-side with the desktop's own path separator — never construct
 *  it client-side, since Android has no idea whether the desktop is Windows or POSIX. */
data class FsEntry(
    val name: String,
    val fullPath: String,
    val isDirectory: Boolean,
)

sealed class WsEvent {
    data class Connected(
        val version: String,
        val macAddress: String? = null,
        val broadcastAddress: String? = null,
        val mDnsName: String? = null,
        /** Whether the desktop runs as the installed (packaged) app; null for older desktops. */
        val isPackaged: Boolean? = null,
    ) : WsEvent()
    data class SyncWelcome(
        val protocolVersion: Int,
        val desktopDeviceId: String,
        val datasetId: String,
        val snapshotJson: String,
    ) : WsEvent()
    data class SyncAck(
        val operationIds: List<String>,
        val lastReceivedSequence: Long,
        val conflictsJson: String,
        val snapshotJson: String?,
    ) : WsEvent()
    data class SyncConflictResolved(val conflictId: String, val resolution: String?) : WsEvent()
    data class SyncError(val code: String, val message: String, val supportedProtocolVersion: Int?) : WsEvent()
    data class SyncAttachmentStatus(
        val contentHash: String,
        val nextOffset: Long,
        val complete: Boolean,
    ) : WsEvent()
    data class SyncAttachmentChunk(
        val contentHash: String,
        val displayName: String,
        val mimeType: String,
        val attachmentId: String?,
        val messageId: String?,
        val sizeBytes: Long,
        val offset: Long,
        val dataBase64: String,
        val complete: Boolean,
    ) : WsEvent()
    data class ToolApprovalRequest(
        val requestId: String,
        val toolName: String,
        val args: Map<String, Any>,
    ) : WsEvent()
    data class ChatToolCallEvent(
        val conversationId: String,
        val id: String? = null,
        val toolName: String,
        val serverName: String?,
        val args: String?,
        val result: String,
        val success: Boolean,
    ) : WsEvent()
    data class ChatStreamChunk(val conversationId: String, val text: String) : WsEvent()
    data class ChatStreamEnd(val conversationId: String) : WsEvent()
    data class ChatThinkingDelta(val conversationId: String, val blockId: String, val chunk: String) : WsEvent()
    data class ChatThinkingEnd(val conversationId: String, val blockId: String) : WsEvent()
    data class ChatCost(val conversationId: String, val inputTokens: Int, val outputTokens: Int, val totalCostUsd: Double) : WsEvent()
    data class ChatActivity(
        val conversationId: String,
        val state: String,
        val label: String,
        val toolName: String?,
        val serverName: String?,
    ) : WsEvent()
    data class ChatTurnEvent(
        val conversationId: String,
        val turnId: String,
        val sequence: Long,
        val type: String,
        val timestamp: Long,
        val payloadJson: String,
    ) : WsEvent()
    data class ActiveTurnToolCall(
        val id: String?,
        val toolName: String,
        val serverName: String?,
        val argsJson: String?,
        val result: String,
        val success: Boolean,
        val inProgress: Boolean,
    )
    data class ActiveTurnActivity(
        val state: String,
        val label: String,
        val toolName: String?,
        val serverName: String?,
    )
    data class ChatActiveTurnSnapshot(
        val conversationId: String,
        val turnId: String,
        val latestSequence: Long,
        val assistantText: String,
        val status: String,
        // Tool calls that already ran (or are still running) as of this snapshot — lets a
        // client that re-fetches this after missing the live events (e.g. re-entering a
        // chat mid-generation) restore ones that already happened, not just the flat text.
        val toolCalls: List<ActiveTurnToolCall> = emptyList(),
        val activity: ActiveTurnActivity? = null,
    ) : WsEvent()
    data class ChatTeamActivity(
        val conversationId: String,
        val stepId: String,
        val agentName: String,
        val agentIcon: String,
        val task: String,
        val status: String,
        val result: String?,
        val durationMs: Long?,
    ) : WsEvent()
    data class ConversationList(val conversations: List<Conversation>) : WsEvent()
    data class ConversationMessages(
        val conversationId: String,
        val messages: List<HistoryMessage>,
        val paged: Boolean = false,
        val hasMore: Boolean = false,
        val nextBeforeTimestamp: Long? = null,
        val nextBeforeId: String? = null,
    ) : WsEvent()
    data class AgentList(val agents: List<Agent>) : WsEvent()
    data class ProjectList(val projects: List<Project>) : WsEvent()
    data class ModelList(val models: List<ModelOption>, val source: ModelListSource?) : WsEvent()
    data class AndroidUpdateManifestResult(val manifest: AndroidUpdateManifest?) : WsEvent()
    data class ErrorReportCaptured(val reportId: String) : WsEvent()
    data class ErrorReportError(val message: String) : WsEvent()
    data class RemoteEditInvestigationActivity(val reportId: String, val label: String, val type: String) : WsEvent()
    data class RemoteEditInvestigationChunk(val reportId: String, val chunk: String) : WsEvent()
    data class RemoteEditInvestigationDone(val reportId: String, val status: String, val error: String?) : WsEvent()
    data class RemoteEditVerificationEvent(
        val reportId: String,
        val runId: String,
        val command: String?,
        val status: String,
        val label: String,
        val line: String?,
    ) : WsEvent()
    data class RemoteEditVerificationDone(
        val reportId: String,
        val runId: String,
        val status: String,
        val error: String?,
    ) : WsEvent()
    data class RemoteEditFixDone(
        val reportId: String,
        val status: String,
        val stagedFiles: List<RemoteEditStagedFileEntry>,
        val error: String?,
    ) : WsEvent()
    data class RemoteEditStagedFiles(
        val reportId: String,
        val fixStatus: String,
        val stagedFiles: List<RemoteEditStagedFileEntry>,
    ) : WsEvent()
    data class RemoteEditStagedDiff(
        val reportId: String,
        val relativePath: String,
        val hunksJson: String?,
    ) : WsEvent()
    data class RemoteEditFileReviewed(
        val reportId: String,
        val relativePath: String,
        val reviewed: Boolean,
    ) : WsEvent()
    data class RemoteEditHistoryForReport(
        val reportId: String,
        val committed: Boolean,
        val commitSha: String?,
    ) : WsEvent()
    data class RemoteEditGitCommitResult(
        val reportId: String,
        val sha: String?,
        val error: String?,
    ) : WsEvent()
    data class RemoteEditGitEvent(
        val reportId: String,
        val type: String,
        val label: String,
        val commitSha: String?,
        val error: String?,
    ) : WsEvent()
    data class RemoteEditRecoveryEvent(
        val reportId: String,
        val recoveryId: String?,
        val type: String,
        val label: String,
        val status: String?,
        val error: String?,
    ) : WsEvent()
    data class RemoteEditReportDeleted(
        val reportId: String,
        val deleted: Boolean,
        val error: String?,
    ) : WsEvent()
    data class RemoteEditApplyResult(
        val reportId: String,
        val appliedFiles: List<String>,
        val backupPaths: List<String>,
        val error: String?,
    ) : WsEvent()
    data class RemoteEditActiveCodeChangesChanged(val countsByProjectId: Map<String, Int>) : WsEvent()
    data class CodeChangeError(val reportId: String?, val error: String) : WsEvent()
    data class CodeChangeRepoWire(val relativePath: String, val branch: String, val dirty: Boolean = false)
    data class CodeChangeRepos(val repos: List<CodeChangeRepoWire>) : WsEvent()
    data class CodeChangeFiles(val files: List<String>) : WsEvent()
    /** Fires for the code-change:submitted/accepted/pushed/completed replies — every one of the
     *  independent slash commands (/code-change, /code-execute, /code-push) resolves to one of
     *  these "kind" values rather than its own class, mirroring how the backend collapsed the old
     *  step-machine into flat one-shot replies. */
    data class CodeChangeAck(val reportId: String, val kind: String) : WsEvent()
    data class CodeChangeReport(
        val reportId: String?,
        val step: String?,
        val repoRelativePath: String?,
        val plan: String?,
        val title: String?,
        val description: String?,
        val confidence: String?,
        val rootCause: String?,
        val affectedFiles: List<String> = emptyList(),
    ) : WsEvent()
    data class CodeChangeReloadPrepareResult(val reportId: String, val recoveryId: String?, val canReload: Boolean, val reason: String?) : WsEvent()
    data class CodeChangeUndone(val rolledBack: Boolean, val error: String?) : WsEvent()
    /** code-change:status is overloaded server-side: it's both a lightweight execute/verify/commit
     *  progress broadcast ({reportId, status}) and the reply to code-change:get-status
     *  ({report, gitRepo}). WsEventParser disambiguates on the presence of a "report" key and
     *  emits one of these two distinct events so callers never have to re-derive which shape it is. */
    data class CodeChangeStatusProgress(val reportId: String, val status: String) : WsEvent()
    data class CodeChangeStatusResult(
        val reportId: String?,
        val step: String?,
        val repoRelativePath: String?,
        val title: String?,
        val gitRepoOk: Boolean,
        val gitRepoRelativePath: String?,
        val gitRepoReason: String?,
    ) : WsEvent()
    data class CodeChangeWarning(val reportId: String, val warning: String) : WsEvent()
    data class CodeChangeInvestigationChunk(val reportId: String, val chunk: String) : WsEvent()
    data class CodeChangeInvestigationActivity(val reportId: String, val type: String, val label: String) : WsEvent()
    data class ChangedFileInfo(val relativePath: String, val staged: Boolean)
    data class CodeChangeChangedFiles(val files: List<ChangedFileInfo>, val seq: Int = 0) : WsEvent()
    data class CodeChangeBranches(val current: String, val local: List<String>, val remote: List<String>, val seq: Int = 0) : WsEvent()
    data class CodeChangeCheckedOut(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeBranchCreated(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeFetched(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeMergeConflictFile(val relativePath: String, val content: String)
    data class CodeChangeMerged(
        val ok: Boolean,
        val conflicted: Boolean,
        val conflictedFiles: List<CodeChangeMergeConflictFile>,
        val error: String?,
        val summary: String?,
    ) : WsEvent()
    data class CodeChangeRepoInitialized(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeCredentialMethod(val label: String, val detail: String)
    data class CodeChangeCredentials(
        val remoteUrl: String?,
        val host: String?,
        val methods: List<CodeChangeCredentialMethod>,
    ) : WsEvent()
    data class CodeChangePulled(
        val ok: Boolean,
        val conflicted: Boolean,
        val conflictedFiles: List<CodeChangeMergeConflictFile>,
        val error: String?,
        val summary: String?,
    ) : WsEvent()
    data class CodeChangeBranchPushed(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeCommitted(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeFileDiscarded(val ok: Boolean, val error: String?, val relativePath: String) : WsEvent()
    data class CodeChangeStashed(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeStashPopped(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeStashCount(val count: Int) : WsEvent()
    data class CodeChangeBranchDeleted(val ok: Boolean, val error: String?, val branchName: String) : WsEvent()
    data class CodeChangeFileDiff(val diff: String, val binary: Boolean, val relativePath: String, val seq: Int = 0) : WsEvent()
    data class CodeChangeStaged(val ok: Boolean, val error: String?) : WsEvent()
    data class CodeChangeUnstaged(val ok: Boolean, val error: String?) : WsEvent()
    data class ConversationModelUpdated(val conversationId: String, val model: String?) : WsEvent()
    data class ConversationModeUpdated(val conversationId: String, val thinkingEffortOverride: String?, val fullAutoApproveOverride: Boolean?, val terminalSandboxOverride: Boolean?) : WsEvent()
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
    data class RemoteEditReports(val reports: List<ErrorReport>) : WsEvent()
    data class RemoteEditReportsChanged(val reportId: String, val status: String) : WsEvent()
    data class RemoteEditInvestigationSettingsLoaded(val settings: RemoteEditInvestigationSettings) : WsEvent()
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
    data class SettingValue(val key: String, val value: String?) : WsEvent()
    data class McpList(val servers: List<McpServerInfo>) : WsEvent()
    data class SkillList(val skills: List<SkillConfig>) : WsEvent()
    data class SkillDetail(val skill: SkillConfig?) : WsEvent()
    data class SkillCreated(val skill: SkillConfig) : WsEvent()
    data class SkillUpdated(val skill: SkillConfig) : WsEvent()
    data class SkillDeleted(val id: String) : WsEvent()
    data class SkillDuplicated(val skill: SkillConfig?) : WsEvent()
    data class SkillExported(val skill: SkillConfig?) : WsEvent()
    data class SkillAgentLinks(val agentId: String, val links: List<SkillAgentLink>) : WsEvent()
    data class SkillAgentUsageList(val usage: List<SkillAgentUsage>) : WsEvent()
    data class ArtifactList(val artifacts: List<ArtifactSummary>) : WsEvent()
    data class ArtifactDetail(val artifactId: String, val artifact: ArtifactDetail2?) : WsEvent()
    data class ArtifactVersions(val artifactId: String, val versions: List<ArtifactVersionSummary>) : WsEvent()
    data class ArtifactDeleted(val id: String, val deleted: Boolean) : WsEvent()
    data class ArtifactVersionDeleted(val versionId: String, val deleted: Boolean, val artifactId: String?) : WsEvent()
    data class ArtifactVersionDeleteError(val message: String) : WsEvent()
    data class ArtifactPromoted(val artifactId: String, val versionId: String, val title: String, val messageId: String?) : WsEvent()
    data class ArtifactPromoteError(val message: String, val messageId: String?) : WsEvent()
    data class ArtifactExportPack(val versionId: String, val files: List<ArtifactExportFile>) : WsEvent()
    data class ArtifactExportError(val message: String) : WsEvent()
    data class WikiList(val entries: List<WikiEntry>) : WsEvent()
    data class WikiEntryCreated(val entry: WikiEntry) : WsEvent()
    data class WikiEntryUpdated(val entry: WikiEntry) : WsEvent()
    data class WikiEntryDeleted(val id: String) : WsEvent()
    data class PromptList(val entries: List<PromptEntry>) : WsEvent()
    data class PromptVersions(val promptId: String, val versions: List<PromptVersion>) : WsEvent()
    data class PromptEntryCreated(val entry: PromptEntry) : WsEvent()
    data class PromptEntryUpdated(val entry: PromptEntry) : WsEvent()
    data class PromptEntryDeleted(val id: String) : WsEvent()
    data class PromptError(val message: String) : WsEvent()
    data class ConversationExportPackResult(val pack: ConversationExportPackData) : WsEvent()
    data class ConversationExportError(val message: String) : WsEvent()
    data class ConversationForked(val conversationId: String, val title: String, val messageCount: Int) : WsEvent()
    data class ConversationForkError(val message: String) : WsEvent()
    data class ConversationImported(val conversationId: String, val title: String, val messageCount: Int) : WsEvent()
    data class ConversationImportError(val message: String) : WsEvent()
    data class ConversationPinned(val id: String, val pinned: Boolean) : WsEvent()
    data class ConversationContextUpdated(val conversationId: String, val projectId: String?, val agentId: String?) : WsEvent()
    data class MessageInserted(val conversationId: String, val messageId: String, val role: String, val content: String, val timestamp: Long) : WsEvent()
    data class MessagesDeletedAfter(val conversationId: String, val timestamp: Long) : WsEvent()
    data class CompressionPreview(
        val conversationId: String,
        val hasSummary: Boolean,
        val summarizedMessageCount: Int,
        val retainedMessageCount: Int,
        val estimatedTokensBefore: Int,
        val targetBudget: Int,
        val strategy: String?,
        val updatedAt: Long?,
    ) : WsEvent()
    data class CompressionDraft(
        val conversationId: String,
        val summarizedMessageCount: Int,
        val retainedMessageCount: Int,
        val estimatedTokensBefore: Int,
        val targetBudget: Int,
        val strategy: String,
        val sections: CompressionSections,
    ) : WsEvent()
    data class CompressionSaved(val conversationId: String, val hasSummary: Boolean, val summarizedMessageCount: Int, val retainedMessageCount: Int) : WsEvent()
    data class CompressionError(val message: String) : WsEvent()
    data class InspectorSnapshot(val snapshot: ContextInspectorSnapshot?) : WsEvent()
    data class InspectorSnapshotError(val message: String) : WsEvent()
    data class ProjectGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class ProjectGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class ProjectGeneratorSpecReady(val sessionId: String?, val spec: ProjectGeneratorSpec) : WsEvent()
    data class ProjectGeneratorCreated(val sessionId: String?, val projectId: String, val name: String) : WsEvent()
    data class ProjectGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class ProjectGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class ProjectConfigUpdated(val id: String) : WsEvent()
    data class ProjectConfigChanged(val id: String) : WsEvent()
    data class ProjectConfig(val id: String, val config: ProjectSettingsConfig) : WsEvent()
    data class ProjectAgents(val id: String, val agents: List<ProjectAgentEntry>) : WsEvent()
    data class ProjectAuditSessions(val projectId: String?, val sessions: List<ProjectAuditSession>) : WsEvent()
    data class ProjectAuditFiles(val sessionId: String, val files: List<ProjectAuditFile>) : WsEvent()
    data class ProjectAuditDiffLoaded(val sessionId: String, val diff: ProjectAuditDiff?) : WsEvent()
    data class ProjectGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class SkillGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class ArtifactGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class AgentGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class AgentGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class AgentGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class AgentGeneratorSpecReady(val sessionId: String?, val spec: AgentGeneratorSpec) : WsEvent()
    data class AgentGeneratorCreated(val sessionId: String?, val agentId: String, val name: String) : WsEvent()
    data class AgentGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class AgentGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class ArtifactGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class ArtifactGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class ArtifactGeneratorSpecReady(val sessionId: String?, val spec: ArtifactGeneratorSpec) : WsEvent()
    data class ArtifactGeneratorCreated(val sessionId: String?, val artifactId: String, val title: String) : WsEvent()
    data class ArtifactGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class ArtifactGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class ArtifactMoveToProject(val artifactId: String, val projectId: String?) : WsEvent()
    data class ArtifactMovedToProject(val artifactId: String, val projectId: String?) : WsEvent()
    data class SkillGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class SkillGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class SkillGeneratorSpecReady(val sessionId: String?, val spec: SkillGeneratorSpec) : WsEvent()
    data class SkillGeneratorCreated(val sessionId: String?, val skillId: String, val name: String) : WsEvent()
    data class SkillGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class SkillGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class SchedulerGeneratorToken(val sessionId: String?, val chunk: String) : WsEvent()
    data class SchedulerGeneratorTurnComplete(val sessionId: String?, val content: String, val hasSpec: Boolean = false) : WsEvent()
    data class SchedulerGeneratorSpecReady(val sessionId: String?, val spec: ScheduleGeneratorSpec) : WsEvent()
    data class SchedulerGeneratorCreated(val sessionId: String?, val taskId: String, val name: String) : WsEvent()
    data class SchedulerGeneratorError(val sessionId: String?, val message: String) : WsEvent()
    data class SchedulerGeneratorCancelled(val sessionId: String?) : WsEvent()
    data class SchedulerGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()
    data class ProviderAzureEndpoint(val endpoint: String) : WsEvent()
    data class ProviderAzureEndpointSet(val endpoint: String) : WsEvent()
    data class ProviderTestResult(val provider: String, val valid: Boolean, val error: String?) : WsEvent()
    data class AgentKnowledgeFiles(val agentId: String, val files: List<AgentKnowledgeFile>) : WsEvent()
    data class AgentKnowledgeFileAdded(val agentId: String, val file: AgentKnowledgeFile) : WsEvent()
    data class AgentKnowledgeFileRemoved(val agentId: String, val id: String) : WsEvent()
    data class AgentKnowledgeFileContent(val agentId: String, val filePath: String, val content: String) : WsEvent()
    data class AgentKnowledgeFileSaved(val agentId: String, val filePath: String) : WsEvent()
    data class AgentKnowledgeFileError(val message: String) : WsEvent()
    data class AgentMcpToolOverrides(val agentId: String, val overrides: List<AgentMcpToolOverride>) : WsEvent()
    data class AgentMcpServerTrustList(val agentId: String, val trust: List<AgentMcpServerTrust>) : WsEvent()
    data class McpServerAdded(val server: McpServerWithStatus) : WsEvent()
    data class McpServerUpdated(val server: McpServerWithStatus) : WsEvent()
    data class McpServerRemoved(val id: String) : WsEvent()
    data class McpServerStatus(val id: String, val status: String, val error: String?, val toolCount: Int) : WsEvent()
    data class McpToolList(val agentId: String?, val tools: List<McpToolInfo>) : WsEvent()
    data class WikiExtractionCandidates(val conversationId: String, val candidates: List<WikiExtractionCandidate>) : WsEvent()
    data class WikiExtractionError(val message: String) : WsEvent()
    data class BuildRecords(val records: List<BuildRecord>) : WsEvent()
    data class BuildWorkspaceInfo(val path: String, val branch: String?, val commitSha: String?, val dirty: Boolean, val version: String?, val isGitRepo: Boolean) : WsEvent()
    data class BuildPreflightResult(val checks: List<PreflightCheck>) : WsEvent()
    data class BuildStarted(val buildId: String, val command: String) : WsEvent()
    data class BuildLogChunk(val buildId: String, val line: String, val stream: String, val replace: Boolean = false) : WsEvent()
    data class BuildCommandDone(val buildId: String?, val status: String, val exitCode: Int?, val error: String? = null) : WsEvent()
    data class BuildCancelled(val buildId: String, val cancelled: Boolean) : WsEvent()
    data class UpdateRestarting(val eta: Int, val version: String?, val error: String? = null) : WsEvent()
    data class AndroidWorkspaceInfo(val path: String, val branch: String?, val commitSha: String?, val dirty: Boolean, val versionCode: Int?, val versionName: String?, val isGitRepo: Boolean, val hasGradleProject: Boolean) : WsEvent()
    data class AndroidSigningValidation(val valid: Boolean, val checks: List<PreflightCheck>) : WsEvent()
    data class AndroidPublishResult(val published: Boolean, val error: String?, val manifest: AndroidPublishManifest?) : WsEvent()
    data class AndroidRestoreResult(val restored: Boolean, val error: String?, val manifest: AndroidPublishManifest?) : WsEvent()
    // Scheduler
    data class SchedulerTaskList(val tasks: List<ScheduledTask>) : WsEvent()
    data class SchedulerTaskUpdated(val task: ScheduledTask) : WsEvent()
    data class SchedulerTaskDeleted(val taskId: String) : WsEvent()
    data class SchedulerRunUpdated(val run: ScheduledRun) : WsEvent()
    data class SchedulerRunList(val taskId: String, val runs: List<ScheduledRun>) : WsEvent()
    data class SchedulerRunError(val taskId: String, val error: String) : WsEvent()
    /** Candidate saved Automated Workflow runs for the "attach an existing workflow to this
     *  schedule" picker — fetched over WS since Android has no direct DB access. */
    data class SchedulerWorkflowTemplates(val runs: List<AutomatedWorkflowRunInfo>) : WsEvent()
    // Debrief
    // artifactId/versionId are the debrief's artifact-backed home (desktop Phase 2) — null when
    // talking to an older desktop build that hasn't migrated debrief off conversation_debriefs yet.
    data class DebriefReady(val debrief: ConversationDebrief, val artifactId: String? = null, val versionId: String? = null) : WsEvent()
    data class DebriefLoaded(val debrief: ConversationDebrief?) : WsEvent()
    data class DebriefError(val message: String) : WsEvent()
    data class DebriefConversationCompleted(val conversationId: String, val completedAt: Long) : WsEvent()
    data class DebriefConversationIncompleted(val conversationId: String) : WsEvent()
    // Ratings
    data class RatingUpdated(val conversationId: String, val rating: ConversationRating?) : WsEvent()
    data class RatingLoaded(val conversationId: String, val rating: ConversationRating?) : WsEvent()
    data class RatingError(val message: String) : WsEvent()
    data class RatingListLoaded(val ratings: List<ConversationRatingListItem>) : WsEvent()
    data class RatingStatsLoaded(val stats: ConversationRatingStats) : WsEvent()
    // Quiz
    data class QuizReady(val questions: List<QuizQuestion>, val artifactId: String? = null, val versionId: String? = null, val conversationId: String? = null) : WsEvent()
    data class QuizLoaded(val conversationId: String, val questions: List<QuizQuestion>?, val artifactId: String? = null, val versionId: String? = null) : WsEvent()
    data class QuizError(val message: String) : WsEvent()
    data class TeachbackReady(val conversationId: String, val artifactId: String, val versionId: String, val exercise: TeachbackExercise) : WsEvent()
    data class TeachbackLoaded(val conversationId: String, val artifactId: String?, val versionId: String?, val exercise: TeachbackExercise?) : WsEvent()
    data class TeachbackGraded(val artifactId: String, val versionId: String, val feedback: TeachbackFeedback) : WsEvent()
    data class TeachbackAttempts(val artifactId: String, val attempts: List<TeachbackAttempt>) : WsEvent()
    data class TeachbackError(val message: String) : WsEvent()

    data class ActivityChanged(val activities: List<io.nexy.android.data.BackgroundActivity>) : WsEvent()
    // Provider Key Handoff (opt-in, consent-gated exception)
    data class ProviderKeyHandoffRequest(
        val providerId: String,
        val providerName: String,
    ) : WsEvent()
    data class ProviderKeyHandoffValue(
        val providerId: String,
        val keyValue: String,
    ) : WsEvent()
    // Automated Workflow Generator
    data class AutomatedWorkflowReady(
        val sessionId: String,
        val title: String,
        val goalSummary: String,
        val assumptions: String,
        val steps: List<AutomatedWorkflowStepInfo>,
        /** The raw spec JSON (title/goalSummary/assumptions/steps incl. agentId + dependsOnStepIds),
         *  kept verbatim so it can be forwarded as-is to automated-workflow-runs:save-spec without
         *  the friendlier [AutomatedWorkflowStepInfo] view's field loss. */
        val rawSpec: Map<String, Any> = emptyMap(),
    ) : WsEvent()
    data class AutomatedWorkflowModel(val sessionId: String, val modelId: String) : WsEvent()
    data class AutomatedWorkflowToken(val sessionId: String, val chunk: String) : WsEvent()
    data class AutomatedWorkflowMessage(val sessionId: String, val message: String) : WsEvent()
    data class AutomatedWorkflowError(val sessionId: String, val message: String) : WsEvent()
    data class AutomatedWorkflowCancelled(val sessionId: String) : WsEvent()
    // Persisted automated workflow runs
    data class AutomatedWorkflowRunsList(val projectId: String?, val runs: List<AutomatedWorkflowRunInfo>) : WsEvent()
    /** Every run regardless of project — backs the global, top-level Automated Workflows list screen. */
    data class AutomatedWorkflowRunsListAll(val runs: List<AutomatedWorkflowRunInfo>) : WsEvent()
    data class AutomatedWorkflowRunDetailReady(val run: AutomatedWorkflowRunInfo?) : WsEvent()
    data class AutomatedWorkflowRunDiscarded(val runId: String, val ok: Boolean) : WsEvent()
    /** Live token stream for a step actually being executed by the automated runner — distinct
     *  from AutomatedWorkflowToken, which streams the plan-generation chat, not a step's own run. */
    data class AutomatedWorkflowStepStream(val runId: String, val stepDbId: String, val chunk: String) : WsEvent()
    /** automated-workflow-runs:* commands reply with this on failure (a bad spec, a DB error) —
     *  see ws-handlers.ts's try/catch-with-reply — so the UI can surface it instead of a
     *  permanently-stuck "Saving…" button with no explanation. */
    data class AutomatedWorkflowRunsError(val message: String) : WsEvent()
    // Remote workspace file explorer — depth-1 per request, re-fetched lazily on each folder tap
    // rather than pre-fetched deep, to keep WS payloads small (see fs:list-directory on desktop).
    data class FsDirectoryListing(
        val path: String,
        val entries: List<FsEntry>,
        val truncated: Boolean,
        val error: String?,
    ) : WsEvent()
    data class FsStartRoots(val home: String, val recents: List<String>) : WsEvent()
}

data class BuildRecord(
    val id: String,
    val workspacePath: String,
    val commitSha: String?,
    val branch: String?,
    val version: String?,
    val versionCode: Int?,
    val platform: String,
    val command: String,
    val status: String,
    val exitCode: Int?,
    val artifactPaths: List<String>,
    val logTail: String,
    val startedAt: Long,
    val finishedAt: Long?,
)

data class PreflightCheck(
    val label: String,
    val status: String,
    val detail: String,
)

data class AndroidPublishManifest(
    val versionCode: Int,
    val versionName: String,
    val commitSha: String?,
    val changelog: String,
    val checksum: String,
    val artifactUrl: String,
    val publishedAt: Long,
)

data class AgentKnowledgeFile(
    val id: String,
    val agentId: String,
    val filePath: String,
    val injectMode: String,
    val sortOrder: Int,
    val createdAt: Long,
    val updatedAt: Long,
)

data class AgentMcpToolOverride(
    val agentId: String,
    val serverId: String,
    val toolName: String,
    val enabled: Boolean,
    val approval: String,
    val instructions: String,
)

data class AgentMcpServerTrust(
    val serverId: String,
    val trust: String,
)

data class McpServerWithStatus(
    val id: String,
    val name: String,
    val command: String,
    val args: List<String> = emptyList(),
    val enabled: Boolean,
    val status: String,
    val error: String? = null,
    val toolCount: Int = 0,
)

data class McpToolInfo(
    val name: String,
    val description: String?,
    val serverId: String,
    val serverName: String,
)

data class WikiExtractionCandidate(
    val title: String,
    val body: String,
    val tags: List<String>,
)

data class CompressionSections(
    val goals: List<String> = emptyList(),
    val decisions: List<String> = emptyList(),
    val constraints: List<String> = emptyList(),
    val filesTouched: List<String> = emptyList(),
    val commandsRun: List<String> = emptyList(),
    val openQuestions: List<String> = emptyList(),
    val nextActions: List<String> = emptyList(),
    val recentContextNotes: List<String> = emptyList(),
)

typealias CompressionPreview = WsEvent.CompressionPreview
typealias CompressionDraft = WsEvent.CompressionDraft

data class ContextInspectorRefSnapshot(
    val token: String,
    val key: String,
    val estimatedTokens: Int,
)

data class ContextInspectorAttachmentSnapshot(
    val name: String,
    val size: Long,
    val estimatedTokens: Int,
)

/** Mirrors the desktop's ContextInspectorSnapshot (src/shared/types.ts) relayed from the focused Electron window. */
data class ContextInspectorSnapshot(
    val conversationId: String?,
    val model: String,
    val systemPrompt: String,
    val systemPromptTokens: Int,
    val contextRefs: List<ContextInspectorRefSnapshot> = emptyList(),
    val attachments: List<ContextInspectorAttachmentSnapshot> = emptyList(),
    val imageCount: Int,
    val historyMessageCount: Int,
    val currentInputTokens: Int,
    val totalTokens: Int,
    val maxTokens: Int,
)

data class ProjectAgentEntry(
    val agentId: String,
    val agentName: String,
    val agentIcon: String,
    val isPrimary: Boolean,
    val sortOrder: Int,
)

data class ErrorReport(
    val id: String,
    val title: String,
    val description: String,
    val status: String,
    val fixStatus: String,
    val investigationConfidence: String?,
    val investigationRootCause: String?,
    val investigationMarkdown: String?,
    val investigationAffectedFiles: List<String> = emptyList(),
    val createdAt: Long,
    val projectId: String? = null,
    val requestType: String = "edit",
    val customTypeLabel: String? = null,
)

data class RemoteEditVerificationRun(
    val runId: String,
    val status: String,
    val error: String?,
)

data class RemoteEditInvestigationSettings(
    val backend: String,
    val model: String,
    val retryLimit: Int,
    val autoApproveTools: Boolean,
)

data class RemoteEditRecoveryRun(
    val recoveryId: String,
    val status: String,
    val error: String?,
)

data class HistoryMessage(
    val id: String,
    val role: String,
    val content: String,
    val timestamp: Long,
    val attachments: List<AttachmentMeta> = emptyList(),
    val thinkingBlocks: List<ThinkingBlock> = emptyList(),
    // Ordered response-text bursts when the reply was interrupted by a tool call (e.g.
    // "I'll check X." -> tool call -> "Here's the answer.") — reuses ThinkingBlock's
    // shape (blockId/content/done) since the data is structurally identical. `content`
    // remains the full concatenated text regardless; this is purely a rendering aid for
    // interleaving with tool-call messages, mirroring desktop's text_segments column.
    val textSegments: List<ThinkingBlock> = emptyList(),
    val model: String? = null,
)

data class ThinkingBlock(
    val blockId: String,
    val content: String,
    val done: Boolean,
    // Wall-clock ms when this block's first chunk arrived — lets historical rendering
    // interleave thinking/text blocks with the tool-call rows that actually separated
    // them (via real timestamps) instead of always grouping every block together ahead
    // of the tool calls. Null for blocks persisted before this field existed.
    val firstSeenAt: Long? = null,
)

data class AttachmentMeta(
    val id: String,
    val name: String,
    val type: String?,
    val thumbnailDataUrl: String?,
)

/** Mirrors desktop's `AutomatedWorkflowStep` (src/shared/types.ts). Notably missing
 *  `dependsOnStepIds`: it's structurally dropped from this pre-save view — only the saved-run
 *  model ([AutomatedWorkflowRunStepData]) carries it. */
data class AutomatedWorkflowStepInfo(
    val id: String,
    val title: String,
    val summary: String,
    val agentName: String?,
    val prompt: String,
    val expectedOutput: String,
    // Alternative to agentName — a bare-model step (no agent) gets no skill augmentation at all.
    val model: String? = null,
)

/** Mirrors desktop's `AutomatedWorkflowRunStep` (src/shared/types.ts). */
data class AutomatedWorkflowRunStepData(
    val id: String,
    val dbId: String,
    val runId: String,
    val stepIndex: Int,
    val title: String,
    val summary: String,
    val agentId: String?,
    val agentName: String?,
    val prompt: String,
    val expectedOutput: String,
    val dependsOnStepIds: List<String> = emptyList(),
    val status: String,
    val attempt: Int = 0,
    val output: String = "",
    val error: String? = null,
    val conversationId: String? = null,
    val startedAt: Long?,
    val completedAt: Long?,
    // Alternative to agentId, not additional to it — a step fulfilled by a bare model gets no
    // skill augmentation at all (skills are strictly agent-gated).
    val model: String? = null,
)

/** Mirrors desktop's `AutomatedWorkflowRunDetail extends AutomatedWorkflowRunSummary` (src/shared/types.ts).
 *  Used for both list rows (steps/assumptions empty) and full detail (steps populated).
 *  projectId is nullable — an Automated Workflow run is project-optional, so it can be a
 *  self-contained, standalone entity (see src/roadmap-new/). */
data class AutomatedWorkflowRunInfo(
    val id: String,
    val projectId: String?,
    val title: String,
    val goalSummary: String,
    val model: String?,
    val status: String,
    val confirmationMode: String = "gated",
    val currentStepId: String? = null,
    val lastError: String? = null,
    val stepCounts: StepCounts,
    val createdAt: Long,
    val updatedAt: Long,
    val assumptions: List<String> = emptyList(),
    val steps: List<AutomatedWorkflowRunStepData> = emptyList(),
    // Back-link to the reusable spec this run was created from — null for runs created before
    // templates existed. Lets a terminal run offer "Run again" without re-describing the goal.
    val templateId: String? = null,
) {
    data class StepCounts(
        val total: Int,
        val pending: Int,
        val running: Int = 0,
        val awaitingConfirmation: Int = 0,
        val done: Int,
        val failed: Int = 0,
        val skipped: Int = 0,
    )
}

data class ProviderInfo(
    val id: String,
    val label: String,
    /** True only when a real, usable key exists on THIS device (local encrypted store). */
    val configured: Boolean,
    /** True when desktop reports this provider as configured but this device has no local
     *  key for it — the key value never syncs automatically, so it's not usable standalone
     *  without an explicit key handoff or manual entry. */
    val configuredOnDesktopOnly: Boolean = false,
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

data class SkillConfig(
    val id: String,
    val name: String,
    val icon: String,
    val description: String,
    val instructions: String,
    val tags: List<String>,
    val tools: SkillTools,
    val mcpServers: List<String>,
    val mcpServerTrust: List<SkillMcpServerTrust>,
    val mcpToolOverrides: List<SkillMcpToolOverride>,
    val knowledge: List<SkillKnowledge>,
    val createdAt: Long?,
    val updatedAt: Long?,
)

data class SkillTools(
    val fileEdit: SkillToolConfig,
    val terminal: SkillToolConfig,
    val webFetch: SkillToolConfig,
)

data class SkillToolConfig(
    val enabled: Boolean,
    val approval: String,
    val instructions: String,
)

data class SkillKnowledge(
    val title: String,
    val content: String,
)

data class SkillMcpServerTrust(
    val serverId: String,
    val trust: String,
)

data class SkillMcpToolOverride(
    val serverId: String,
    val toolName: String,
    val enabled: Boolean,
    val approval: String,
    val instructions: String,
)

data class SkillAgentLink(
    val skillId: String,
    val sortOrder: Int,
)

data class SkillAgentUsage(
    val skillId: String,
    val agentCount: Int,
)

data class ArtifactSummary(
    val id: String,
    val projectId: String?,
    val title: String,
    val kind: String,
    val description: String?,
    val storageRoot: String?,
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

data class ArtifactExportFile(
    val relativePath: String,
    val mediaType: String,
    val contentBase64: String,
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
    val storageRoot: String?,
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

data class PromptVersionDiff(
    val titleChanged: Boolean,
    val descriptionChanged: Boolean,
    val categoryChanged: Boolean,
    val tagsChanged: Boolean,
    val scopeChanged: Boolean,
    val addedLines: List<String>,
    val removedLines: List<String>,
)

data class PromptVersion(
    val id: String,
    val promptId: String,
    val version: Int,
    val title: String,
    val body: String,
    val description: String,
    val category: String,
    val tags: List<String>,
    val variables: List<String>,
    val scope: String,
    val projectId: String?,
    val source: String,
    val createdAt: Long,
    val diff: PromptVersionDiff,
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

data class ProjectSettingsConfig(
    val instructions: String,
    val rootDirectory: String?,
    val variables: List<Map<String, String>> = emptyList(),
    val instructionMode: String,
    val instructionsEnabled: Boolean = true,
    val workflowMode: String = "single-agent",
    val orchestrationEnabled: Boolean,
    val maxDelegationDepth: Int = 5,
    val showTeamActivity: Boolean = true,
    val inScope: List<Map<String, String>> = emptyList(),
    val outOfScope: List<Map<String, String>> = emptyList(),
    val milestones: List<Map<String, String>> = emptyList(),
    val defaultModel: String?,
)

data class AgentGeneratorSpec(
    val name: String,
    val icon: String,
    val systemPrompt: String,
    val temperature: Double,
    val responseFormat: String,
    val agenticMode: Boolean,
    val tools: AgentGeneratorTools,
    val rootDirectory: String?,
    val contextDirectories: List<String>,
    val memory: String?,
)

data class AgentGeneratorTools(
    val fileEdit: Boolean,
    val terminal: Boolean,
    val webFetch: Boolean,
)

data class SkillGeneratorSpec(
    val name: String,
    val icon: String,
    val description: String,
    val instructions: String,
    val tools: SkillGeneratorTools,
    val toolInstructions: Map<String, String> = emptyMap(),
    val approval: Map<String, String> = emptyMap(),
    val mcpServers: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val knowledge: List<SkillKnowledge> = emptyList(),
    val suggestedAgents: List<String> = emptyList(),
)

data class SkillGeneratorTools(
    val fileEdit: Boolean,
    val terminal: Boolean,
    val webFetch: Boolean,
)

data class ArtifactGeneratorSpec(
    val title: String,
    val kind: String,
    val scopeType: String,
    val scopeProjectId: String?,
    val intendedUse: String,
    val audience: String?,
    val outputFiles: List<ArtifactOutputFile>,
    val acceptanceCriteria: List<String>,
    val exportFormats: List<String>,
    val sourceContext: ArtifactSourceContext,
)

data class ArtifactOutputFile(
    val path: String,
    val mediaType: String,
    val role: String,
    val description: String?,
)

data class ArtifactSourceContext(
    val useProjectInstructions: Boolean,
    val useProjectWiki: Boolean,
    val useConversationContext: Boolean,
    val referencedFiles: List<String>,
)
