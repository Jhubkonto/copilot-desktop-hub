package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentContextRules
import io.nexy.android.data.model.AgentCustomCommand
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AgentKnowledgeFile
import io.nexy.android.data.model.AgentMcpServerTrust
import io.nexy.android.data.model.AgentMcpToolOverride
import io.nexy.android.data.model.AgentTools
import io.nexy.android.data.model.ToolConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.AgentGeneratorSpec
import io.nexy.android.data.model.AgentGeneratorTools
import io.nexy.android.data.model.ArtifactGeneratorSpec
import io.nexy.android.data.model.ArtifactOutputFile
import io.nexy.android.data.model.ArtifactSourceContext
import io.nexy.android.data.model.ScheduleGeneratorSpec
import io.nexy.android.data.model.SkillGeneratorSpec
import io.nexy.android.data.model.SkillGeneratorTools
import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.ArtifactDetail2
import io.nexy.android.data.model.ProjectGeneratorSpec
import io.nexy.android.data.model.ProjectGeneratorAgentSpec
import io.nexy.android.data.model.ProjectGeneratorAgentTools
import io.nexy.android.data.model.ProjectGeneratorNewAgent
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.ArtifactExportFile
import io.nexy.android.data.model.ArtifactVersionFile
import io.nexy.android.data.model.ArtifactVersionSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.ConversationExportPackData
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.PromptVersion
import io.nexy.android.data.model.PromptVersionDiff
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.CompressionSections
import io.nexy.android.data.model.ContextInspectorAttachmentSnapshot
import io.nexy.android.data.model.ContextInspectorRefSnapshot
import io.nexy.android.data.model.ContextInspectorSnapshot
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpServerWithStatus
import io.nexy.android.data.model.McpToolInfo
import io.nexy.android.data.model.WikiExtractionCandidate
import io.nexy.android.data.model.BuildRecord
import io.nexy.android.data.model.PreflightCheck
import io.nexy.android.data.model.AndroidPublishManifest
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.ProjectAuditDiff
import io.nexy.android.data.model.ProjectAuditFile
import io.nexy.android.data.model.ProjectAuditSession
import io.nexy.android.data.model.ProjectAgentEntry
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.SkillAgentLink
import io.nexy.android.data.model.SkillAgentUsage
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.SkillKnowledge
import io.nexy.android.data.model.SkillMcpServerTrust
import io.nexy.android.data.model.SkillMcpToolOverride
import io.nexy.android.data.model.SkillToolConfig
import io.nexy.android.data.model.ScheduledTask
import io.nexy.android.data.model.ScheduledRun
import io.nexy.android.data.model.SkillTools
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.model.ConversationDebrief
import io.nexy.android.data.model.QuizQuestion
import io.nexy.android.data.model.QuizAttempt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@Suppress("UNCHECKED_CAST")
fun parseWsEvent(
    text: String,
    scope: CoroutineScope,
    events: MutableSharedFlow<WsEvent>,
    serverVersion: MutableStateFlow<String?>,
    conversations: MutableStateFlow<List<Conversation>>,
    projects: MutableStateFlow<List<Project>>,
    agents: MutableStateFlow<List<Agent>>,
    agentFullConfig: MutableStateFlow<AgentFullConfig?>,
    models: MutableStateFlow<List<ModelOption>>,
    modelSource: MutableStateFlow<ModelListSource?>,
    androidUpdateManifest: MutableStateFlow<AndroidUpdateManifest?>,
    errorReports: MutableStateFlow<List<ErrorReport>>,
    providers: MutableStateFlow<List<ProviderInfo>>,
    mcpServers: MutableStateFlow<List<McpServerInfo>>,
    skills: MutableStateFlow<List<SkillConfig>>,
    skillAgentUsage: MutableStateFlow<Map<String, Int>>,
    artifacts: MutableStateFlow<List<ArtifactSummary>>,
    wikiEntries: MutableStateFlow<List<WikiEntry>>,
    promptEntries: MutableStateFlow<List<PromptEntry>>,
    pairedServerStore: PairedServerStore? = null,
    cliStatus: MutableStateFlow<Map<String, CliInstallInfo>>,
    scheduledTasks: MutableStateFlow<List<ScheduledTask>>,
    scheduledRuns: MutableStateFlow<Map<String, List<ScheduledRun>>>,
    currentDebrief: MutableStateFlow<ConversationDebrief?>,
    completedConversationIds: MutableStateFlow<Set<String>>,
) {
    try {
        val obj = JSONObject(text)
        val event = obj.optString("event")
        val data = obj.optJSONObject("data")

        val wsEvent: WsEvent = when (event) {
            "connected" -> {
                val version = data?.optString("version") ?: ""
                serverVersion.value = version.takeIf { it.isNotBlank() }
                val macAddress = data?.optString("macAddress")?.takeIf { it.isNotBlank() }
                val broadcastAddress = data?.optString("broadcastAddress")?.takeIf { it.isNotBlank() }
                val mDnsName = data?.optString("mDnsName")?.takeIf { it.isNotBlank() }
                if (macAddress != null || broadcastAddress != null) {
                    pairedServerStore?.updateActiveProfileWolInfo(macAddress, broadcastAddress)
                }
                if (mDnsName != null) {
                    pairedServerStore?.updateActiveProfileMdnsName(mDnsName)
                }
                WsEvent.Connected(version, macAddress, broadcastAddress, mDnsName)
            }

            "tool:approval-request" -> WsEvent.ToolApprovalRequest(
                requestId = data?.optString("requestId") ?: "",
                toolName = data?.optString("toolName") ?: "",
                args = jsonObjectToMap(data?.optJSONObject("args")),
            )

            "chat:tool-call-event" -> WsEvent.ChatToolCallEvent(
                conversationId = data?.optString("conversationId") ?: "",
                toolName = data?.optString("toolName") ?: "Tool call",
                serverName = data?.nullableString("serverName"),
                args = data?.optJSONObject("args")?.toString(),
                result = data?.optString("result") ?: "",
                success = data?.optBoolean("success", true) ?: true,
            )

            "chat:stream-chunk" -> WsEvent.ChatStreamChunk(
                conversationId = data?.optString("conversationId") ?: "",
                text = data?.optString("chunk") ?: "",
            )

            "chat:stream-end" -> WsEvent.ChatStreamEnd(
                conversationId = data?.optString("conversationId") ?: "",
            )

            "chat:thinking-delta" -> WsEvent.ChatThinkingDelta(
                conversationId = data?.optString("conversationId") ?: "",
                blockId = data?.optString("blockId") ?: "",
                chunk = data?.optString("chunk") ?: "",
            )

            "chat:thinking-end" -> WsEvent.ChatThinkingEnd(
                conversationId = data?.optString("conversationId") ?: "",
                blockId = data?.optString("blockId") ?: "",
            )

            "chat:activity" -> WsEvent.ChatActivity(
                conversationId = data?.optString("conversationId") ?: "",
                state = data?.optString("state") ?: "thinking",
                label = data?.optString("label") ?: "Assistant is thinking",
                toolName = data?.nullableString("toolName"),
                serverName = data?.nullableString("serverName"),
            )

            "chat:turn-event" -> WsEvent.ChatTurnEvent(
                conversationId = data?.optString("conversationId") ?: "",
                turnId = data?.optString("turnId") ?: "",
                sequence = data?.optLong("sequence", 0L) ?: 0L,
                type = data?.optString("type") ?: "",
                timestamp = data?.optLong("timestamp", 0L) ?: 0L,
                payloadJson = data?.toString() ?: "{}",
            )

            "chat:team-activity" -> WsEvent.ChatTeamActivity(
                conversationId = data?.optString("conversationId") ?: "",
                stepId = data?.optString("stepId") ?: "",
                agentName = data?.optString("agentName") ?: "Agent",
                agentIcon = data?.optString("agentIcon") ?: "",
                task = data?.optString("task") ?: "",
                status = data?.optString("status") ?: "",
                result = data?.nullableString("result"),
                durationMs = data?.takeIf { it.has("durationMs") }?.optLong("durationMs"),
            )

            "conversation:list" -> {
                val rows = when {
                    data != null && data.has("rows") -> data.optJSONArray("rows") ?: JSONArray()
                    data != null && data.has("id") -> JSONArray().put(data)
                    else -> obj.optJSONArray("data") ?: JSONArray()
                }
                val list = parseConversationArray(rows)
                conversations.value = list
                WsEvent.ConversationList(list)
            }

            "project:list" -> {
                val projectsArray = data?.optJSONArray("projects") ?: JSONArray()
                val list = (0 until projectsArray.length()).map { i ->
                    val p = projectsArray.getJSONObject(i)
                    val iconsRaw = p.nullableString("agent_icons")
                    val agentIcons = iconsRaw?.split(",")?.filter { it.isNotBlank() } ?: emptyList()
                    Project(
                        id = p.optString("id"),
                        name = p.optString("name"),
                        color = p.optString("color", "blue"),
                        chatCount = p.optInt("chat_count", 0),
                        agentIcons = agentIcons,
                    )
                }
                projects.value = list
                WsEvent.ProjectList(list)
            }

            "model:list" -> {
                val modelsArray = data?.optJSONArray("models") ?: JSONArray()
                val sourceObject = data?.optJSONObject("source")
                val list = (0 until modelsArray.length()).map { i ->
                    val model = modelsArray.getJSONObject(i)
                    ModelOption(
                        id = model.optString("id"),
                        label = model.optString("label"),
                        vendor = model.nullableString("vendor"),
                    )
                }
                models.value = list
                val source = sourceObject?.let {
                    ModelListSource(
                        type = it.optString("type"),
                        label = it.optString("label"),
                        backend = it.nullableString("backend"),
                    )
                }
                modelSource.value = source
                WsEvent.ModelList(list, source)
            }

            "android:log" -> {
                val tag = data?.optString("tag") ?: "Desktop"
                val message = data?.optString("message") ?: ""
                WsRepository.appendDebugLog(tag, message)
                return
            }

            "android:update-manifest" -> {
                val manifest = data?.let {
                    AndroidUpdateManifest(
                        versionCode = it.optInt("versionCode", 0),
                        versionName = it.optString("versionName"),
                        commitSha = it.nullableString("commitSha"),
                        changelog = it.optString("changelog"),
                        checksum = it.optString("checksum"),
                        artifactUrl = it.optString("artifactUrl"),
                        publishedAt = it.optLong("publishedAt", 0L),
                    )
                }
                androidUpdateManifest.value = manifest
                WsEvent.AndroidUpdateManifestResult(manifest)
            }

            "error-report:captured" -> WsEvent.ErrorReportCaptured(
                reportId = data?.optString("reportId") ?: "",
            )

            "error-report:error" -> WsEvent.ErrorReportError(
                message = data?.optString("message") ?: "Unable to capture report",
            )

            "self-heal:investigation-activity" -> WsEvent.RemoteEditInvestigationActivity(
                reportId = data?.optString("reportId") ?: "",
                label = data?.optString("label") ?: "",
                type = data?.optString("type") ?: "status",
            )

            "self-heal:investigation-chunk" -> WsEvent.RemoteEditInvestigationChunk(
                reportId = data?.optString("reportId") ?: "",
                chunk = data?.optString("chunk") ?: "",
            )

            "self-heal:investigation-done" -> WsEvent.RemoteEditInvestigationDone(
                reportId = data?.optString("reportId") ?: "",
                status = data?.optString("status") ?: "",
                error = data?.nullableString("error"),
            )

            "self-heal:verification-event" -> WsEvent.RemoteEditVerificationEvent(
                reportId = data?.optString("reportId") ?: "",
                runId = data?.optString("runId") ?: "",
                command = data?.nullableString("command"),
                status = data?.optString("status") ?: "",
                label = data?.optString("label") ?: "",
                line = data?.nullableString("line"),
            )

            "self-heal:verification-done" -> WsEvent.RemoteEditVerificationDone(
                reportId = data?.optString("reportId") ?: "",
                runId = data?.optString("runId") ?: "",
                status = data?.optString("status") ?: "",
                error = data?.nullableString("error"),
            )

            "self-heal:git-event" -> WsEvent.RemoteEditGitEvent(
                reportId = data?.optString("reportId") ?: "",
                type = data?.optString("type") ?: "",
                label = data?.optString("label") ?: "",
                commitSha = data?.nullableString("commitSha"),
                error = data?.nullableString("error"),
            )

            "self-heal:recovery-event" -> WsEvent.RemoteEditRecoveryEvent(
                reportId = data?.optString("reportId") ?: "",
                recoveryId = data?.nullableString("recoveryId"),
                type = data?.optString("type") ?: "",
                label = data?.optString("label") ?: "",
                status = data?.nullableString("status"),
                error = data?.nullableString("error"),
            )

            "self-heal:fix-done" -> {
                val filesArr = data?.optJSONArray("stagedFiles")
                val files = if (filesArr != null) {
                    (0 until filesArr.length()).map { i ->
                        val f = filesArr.optJSONObject(i)
                        f?.optString("relativePath") ?: filesArr.optString(i) ?: ""
                    }.filter { it.isNotEmpty() }
                } else emptyList()
                WsEvent.RemoteEditFixDone(
                    reportId = data?.optString("reportId") ?: "",
                    status = data?.optString("status") ?: "",
                    stagedFiles = files,
                    error = data?.nullableString("error"),
                )
            }

            "self-heal:staged-files" -> {
                val filesArr = data?.optJSONArray("stagedFiles")
                val files = if (filesArr != null) {
                    (0 until filesArr.length()).map { i ->
                        val f = filesArr.optJSONObject(i)
                        f?.optString("relativePath") ?: filesArr.optString(i) ?: ""
                    }.filter { it.isNotEmpty() }
                } else emptyList()
                WsEvent.RemoteEditStagedFiles(
                    reportId = data?.optString("reportId") ?: "",
                    fixStatus = data?.optString("fixStatus") ?: "",
                    stagedFiles = files,
                )
            }

            "self-heal:staged-diff" -> WsEvent.RemoteEditStagedDiff(
                reportId = data?.optString("reportId") ?: "",
                relativePath = data?.optString("relativePath") ?: "",
                hunksJson = data?.optJSONArray("hunks")?.toString(),
            )

            "self-heal:git-commit-result" -> WsEvent.RemoteEditGitCommitResult(
                reportId = data?.optString("reportId") ?: "",
                sha = data?.nullableString("sha"),
                error = data?.nullableString("error"),
            )

            "conversation:model-updated" -> {
                val conversationId = data?.optString("conversationId") ?: ""
                val model = data?.nullableString("model")
                conversations.value = conversations.value.map { conversation ->
                    if (conversation.id == conversationId) conversation.copy(model = model) else conversation
                }
                WsEvent.ConversationModelUpdated(conversationId, model)
            }

            "conversation:messages" -> {
                val conversationId = data?.optString("conversationId") ?: ""
                val messagesArray = data?.optJSONArray("messages") ?: JSONArray()
                val messages = (0 until messagesArray.length()).map { i ->
                    val m = messagesArray.getJSONObject(i)
                    HistoryMessage(
                        id = m.optString("id"),
                        role = m.optString("role"),
                        content = m.optString("content"),
                        timestamp = m.optLong("timestamp"),
                        attachments = attachmentsFromJson(m.nullableString("attachments")),
                        thinkingBlocks = parseThinkingBlocks(m.nullableString("thinking_blocks")),
                    )
                }
                WsEvent.ConversationMessages(conversationId, messages)
            }

            "chat:cost" -> WsEvent.ChatCost(
                conversationId = data?.optString("conversationId") ?: "",
                inputTokens = data?.optInt("inputTokens", 0) ?: 0,
                outputTokens = data?.optInt("outputTokens", 0) ?: 0,
                totalCostUsd = data?.optDouble("totalCostUsd", 0.0) ?: 0.0,
            )

            "agent:list" -> {
                val agentsArray = data?.optJSONArray("agents") ?: JSONArray()
                val list = (0 until agentsArray.length()).map { i ->
                    val a = agentsArray.getJSONObject(i)
                    Agent(
                        id = a.optString("id"),
                        name = a.optString("name"),
                        icon = a.optString("icon", ""),
                        backend = a.nullableString("backend"),
                        cliModel = a.nullableString("cli_model"),
                    )
                }
                agents.value = list
                WsEvent.AgentList(list)
            }

            "conversation:created" -> WsEvent.ConversationCreated(
                id = data?.optString("id") ?: "",
                agentId = data?.nullableString("agentId"),
                projectId = data?.nullableString("projectId"),
                title = data?.optString("title") ?: "New Chat",
            )

            "conversation:renamed" -> {
                val id = data?.optString("id") ?: ""
                val title = data?.optString("title") ?: ""
                conversations.value = conversations.value.map { if (it.id == id) it.copy(title = title) else it }
                WsEvent.ConversationRenamed(id, title)
            }

            "conversation:deleted" -> {
                val id = data?.optString("id") ?: ""
                conversations.value = conversations.value.filter { it.id != id }
                WsEvent.ConversationDeleted(id)
            }

            "conversation:search-results" -> WsEvent.ConversationSearchResults(
                conversations = parseConversationArray(data?.optJSONArray("conversations") ?: JSONArray())
            )

            "message:deleted" -> WsEvent.MessageDeleted(id = data?.optString("id") ?: "")

            "conversation:pinned" -> {
                val id = data?.optString("id") ?: ""
                val pinned = data?.optBoolean("pinned", false) ?: false
                conversations.value = conversations.value.map { if (it.id == id) it.copy(pinned = pinned) else it }
                WsEvent.ConversationPinned(id, pinned)
            }

            "conversation:context-updated" -> WsEvent.ConversationContextUpdated(
                conversationId = data?.optString("conversationId") ?: "",
                projectId = data?.nullableString("projectId"),
                agentId = data?.nullableString("agentId"),
            )

            "message:inserted" -> {
                val msg = data?.optJSONObject("message")
                WsEvent.MessageInserted(
                    conversationId = data?.optString("conversationId") ?: "",
                    messageId = msg?.optString("id") ?: "",
                    role = msg?.optString("role") ?: "user",
                    content = msg?.optString("content") ?: "",
                    timestamp = msg?.optLong("timestamp") ?: 0L,
                )
            }

            "message:deleted-after" -> WsEvent.MessagesDeletedAfter(
                conversationId = data?.optString("conversationId") ?: "",
                timestamp = data?.optLong("timestamp") ?: 0L,
            )

            "conversation:compression-preview" -> WsEvent.CompressionPreview(
                conversationId = data?.optString("conversation_id") ?: "",
                hasSummary = data?.optBoolean("has_summary", false) ?: false,
                summarizedMessageCount = data?.optInt("summarized_message_count") ?: 0,
                retainedMessageCount = data?.optInt("retained_message_count") ?: 0,
                estimatedTokensBefore = data?.optInt("estimated_tokens_before") ?: 0,
                targetBudget = data?.optInt("target_budget") ?: 0,
                strategy = data?.nullableString("strategy"),
                updatedAt = if (data?.isNull("updated_at") == false) data.optLong("updated_at") else null,
            )

            "conversation:compression-draft" -> {
                val s = data?.optJSONObject("sections")
                fun strList(key: String) = s?.optJSONArray(key)?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
                WsEvent.CompressionDraft(
                    conversationId = data?.optString("conversation_id") ?: "",
                    summarizedMessageCount = data?.optInt("summarized_message_count") ?: 0,
                    retainedMessageCount = data?.optInt("retained_message_count") ?: 0,
                    estimatedTokensBefore = data?.optInt("estimated_tokens_before") ?: 0,
                    targetBudget = data?.optInt("target_budget") ?: 0,
                    strategy = data?.optString("strategy") ?: "manual-structured-summary-plus-recent-turns",
                    sections = CompressionSections(
                        goals = strList("goals"),
                        decisions = strList("decisions"),
                        constraints = strList("constraints"),
                        filesTouched = strList("filesTouched"),
                        commandsRun = strList("commandsRun"),
                        openQuestions = strList("openQuestions"),
                        nextActions = strList("nextActions"),
                        recentContextNotes = strList("recentContextNotes"),
                    ),
                )
            }

            "conversation:compression-saved" -> WsEvent.CompressionSaved(
                conversationId = data?.optString("conversation_id") ?: "",
                hasSummary = data?.optBoolean("has_summary", false) ?: false,
                summarizedMessageCount = data?.optInt("summarized_message_count") ?: 0,
                retainedMessageCount = data?.optInt("retained_message_count") ?: 0,
            )

            "conversation:compression-error" -> WsEvent.CompressionError(data?.optString("message") ?: "Compression failed")

            "context:inspector-snapshot" -> {
                val snapshot = if (data == null) null else {
                    val refsArray = data.optJSONArray("contextRefs") ?: JSONArray()
                    val refs = (0 until refsArray.length()).map { i ->
                        val r = refsArray.getJSONObject(i)
                        ContextInspectorRefSnapshot(
                            token = r.optString("token"),
                            key = r.optString("key"),
                            estimatedTokens = r.optInt("estimatedTokens"),
                        )
                    }
                    val attachmentsArray = data.optJSONArray("attachments") ?: JSONArray()
                    val attachments = (0 until attachmentsArray.length()).map { i ->
                        val a = attachmentsArray.getJSONObject(i)
                        ContextInspectorAttachmentSnapshot(
                            name = a.optString("name"),
                            size = a.optLong("size"),
                            estimatedTokens = a.optInt("estimatedTokens"),
                        )
                    }
                    ContextInspectorSnapshot(
                        conversationId = data.nullableString("conversationId"),
                        model = data.optString("model"),
                        systemPrompt = data.optString("systemPrompt"),
                        systemPromptTokens = data.optInt("systemPromptTokens"),
                        contextRefs = refs,
                        attachments = attachments,
                        imageCount = data.optInt("imageCount"),
                        historyMessageCount = data.optInt("historyMessageCount"),
                        currentInputTokens = data.optInt("currentInputTokens"),
                        totalTokens = data.optInt("totalTokens"),
                        maxTokens = data.optInt("maxTokens", 16000),
                    )
                }
                WsEvent.InspectorSnapshot(snapshot)
            }

            "context:inspector-snapshot-error" -> WsEvent.InspectorSnapshotError(data?.optString("message") ?: "Unable to load context inspector")

            "self-heal:reports" -> {
                val reportsArray = data?.optJSONArray("reports") ?: JSONArray()
                val list = (0 until reportsArray.length()).map { i ->
                    val r = reportsArray.getJSONObject(i)
                    ErrorReport(
                        id = r.optString("id"),
                        title = r.optString("title"),
                        description = r.optString("description"),
                        status = r.optString("status", "open"),
                        fixStatus = r.optString("fix_status", "none"),
                        investigationRootCause = r.nullableString("investigation_root_cause"),
                        investigationMarkdown = r.nullableString("investigation_markdown"),
                        createdAt = r.optLong("created_at", 0L),
                    )
                }
                WsRepository.sendLog("RemoteEdit", "self-heal:reports received: ${list.size} reports; ids=${list.take(5).map { it.id }}")
                errorReports.value = list
                WsEvent.RemoteEditReports(list)
            }

            "project:created" -> {
                val p = data?.optJSONObject("project") ?: return
                val project = Project(
                    id = p.optString("id"),
                    name = p.optString("name"),
                    color = p.optString("color", "blue"),
                    chatCount = 0,
                    agentIcons = emptyList(),
                )
                projects.value = projects.value + project
                WsEvent.ProjectCreated(project)
            }

            "project:renamed" -> {
                val id = data?.optString("id") ?: ""
                val name = data?.optString("name") ?: ""
                projects.value = projects.value.map { if (it.id == id) it.copy(name = name) else it }
                WsEvent.ProjectRenamed(id, name)
            }

            "project:deleted" -> {
                val id = data?.optString("id") ?: ""
                projects.value = projects.value.filter { it.id != id }
                WsEvent.ProjectDeleted(id)
            }

            "agent:created" -> {
                val a = data?.optJSONObject("agent") ?: return
                val agent = Agent(
                    id = a.optString("id"),
                    name = a.optString("name"),
                    icon = a.optString("icon", ""),
                )
                agents.value = agents.value + agent
                WsEvent.AgentCreated(agent)
            }

            "agent:updated" -> {
                val a = data?.optJSONObject("agent") ?: return
                val id = a.optString("id")
                val updated = Agent(id = id, name = a.optString("name"), icon = a.optString("icon", ""))
                agents.value = agents.value.map { if (it.id == id) updated else it }
                WsEvent.AgentUpdated(updated)
            }

            "agent:deleted" -> {
                val id = data?.optString("id") ?: ""
                agents.value = agents.value.filter { it.id != id }
                WsEvent.AgentDeleted(id)
            }

            "agent:full" -> {
                val a = data?.optJSONObject("agent") ?: return
                val mcpServersArr = a.optJSONArray("mcpServers")
                val mcpServersList = if (mcpServersArr != null) (0 until mcpServersArr.length()).map { mcpServersArr.optString(it) } else emptyList()
                val ctxDirsArr = a.optJSONArray("contextDirectories")
                val contextDirectories = if (ctxDirsArr != null) (0 until ctxDirsArr.length()).map { ctxDirsArr.optString(it) } else emptyList()
                val ctxFilesArr = a.optJSONArray("contextFiles")
                val contextFiles = if (ctxFilesArr != null) (0 until ctxFilesArr.length()).map { ctxFilesArr.optString(it) } else emptyList()
                val contextRules = a.optJSONObject("contextRules")?.let { r ->
                    val globsArr = r.optJSONArray("ignoredGlobs")
                    AgentContextRules(
                        ignoredGlobs = if (globsArr != null) (0 until globsArr.length()).map { globsArr.optString(it) } else emptyList(),
                        autoInjectWorkspace = r.optBoolean("autoInjectWorkspace", true),
                        autoInjectGit = r.optBoolean("autoInjectGit", true),
                    )
                }
                val cmdsArr = a.optJSONArray("customCommands")
                val customCommands = if (cmdsArr != null) {
                    (0 until cmdsArr.length()).mapNotNull { i ->
                        val c = cmdsArr.optJSONObject(i) ?: return@mapNotNull null
                        AgentCustomCommand(
                            name = c.optString("name", ""),
                            description = c.optString("description", ""),
                            prompt = c.optString("prompt", ""),
                        )
                    }
                } else emptyList()
                val config = AgentFullConfig(
                    id = a.optString("id"),
                    name = a.optString("name"),
                    icon = a.optString("icon", ""),
                    systemPrompt = a.optString("systemPrompt", ""),
                    backend = a.nullableString("backend"),
                    cliModel = a.nullableString("cliModel"),
                    temperature = a.optDouble("temperature", 0.7).toFloat(),
                    maxTokens = a.optInt("maxTokens", 8192),
                    responseFormat = a.optString("responseFormat", "default"),
                    agenticMode = a.optBoolean("agenticMode", false),
                    fullAutoApprove = a.optBoolean("fullAutoApprove", false),
                    memory = a.optString("memory", ""),
                    tools = parseAgentTools(a.optJSONObject("tools")),
                    mcpServers = mcpServersList,
                    thinkingEffort = a.nullableString("thinkingEffort"),
                    rootDirectory = a.nullableString("rootDirectory"),
                    contextDirectories = contextDirectories,
                    contextFiles = contextFiles,
                    contextRules = contextRules,
                    customCommands = customCommands,
                )
                agentFullConfig.value = config
                WsEvent.AgentFull(config)
            }

            "provider:list" -> {
                val arr = data?.optJSONArray("providers") ?: return
                val list = (0 until arr.length()).map { i ->
                    val p = arr.getJSONObject(i)
                    ProviderInfo(
                        id = p.optString("id"),
                        label = p.optString("label"),
                        configured = p.optBoolean("configured", false),
                    )
                }
                providers.value = list
                WsEvent.ProviderList(list)
            }

            "provider:key-set" -> {
                val provider = data?.optString("provider") ?: ""
                providers.value = providers.value.map {
                    if (it.id == provider) it.copy(configured = true) else it
                }
                WsEvent.ProviderKeySet(provider)
            }

            "provider:key-removed" -> {
                val provider = data?.optString("provider") ?: ""
                providers.value = providers.value.map {
                    if (it.id == provider) it.copy(configured = false) else it
                }
                WsEvent.ProviderKeyRemoved(provider)
            }

            "app:cli-status" -> {
                val clisObj = data?.optJSONObject("clis") ?: return
                val map = mutableMapOf<String, CliInstallInfo>()
                clisObj.keys().forEach { key ->
                    val c = clisObj.optJSONObject(key) ?: return@forEach
                    map[key] = CliInstallInfo(
                        installed = c.optBoolean("installed", false),
                        version = c.nullableString("version"),
                        path = c.nullableString("path"),
                    )
                }
                cliStatus.value = map
                WsEvent.CliStatus(map)
            }

            "app:setting-set" -> {
                val key = data?.optString("key") ?: ""
                val value = data?.optString("value") ?: ""
                WsEvent.SettingSet(key, value)
            }

            "app:setting-value" -> {
                val key = data?.optString("key") ?: ""
                val value = data?.nullableString("value")
                WsEvent.SettingValue(key, value)
            }

            "mcp:list" -> {
                val arr = data?.optJSONArray("servers") ?: return
                val list = (0 until arr.length()).map { i ->
                    val s = arr.getJSONObject(i)
                    McpServerInfo(
                        id = s.optString("id"),
                        name = s.optString("name"),
                        command = s.optString("command"),
                        enabled = s.optBoolean("enabled", false),
                    )
                }
                mcpServers.value = list
                WsEvent.McpList(list)
            }

            "mcp:server-added" -> {
                val s = data?.optJSONObject("server") ?: return
                val server = parseMcpServerWithStatus(s)
                mcpServers.value = mcpServers.value + McpServerInfo(id = server.id, name = server.name, command = server.command, enabled = server.enabled)
                WsEvent.McpServerAdded(server)
            }

            "mcp:server-updated" -> {
                val s = data?.optJSONObject("server") ?: return
                val server = parseMcpServerWithStatus(s)
                mcpServers.value = mcpServers.value.map { if (it.id == server.id) McpServerInfo(id = server.id, name = server.name, command = server.command, enabled = server.enabled) else it }
                WsEvent.McpServerUpdated(server)
            }

            "mcp:server-removed" -> {
                val id = data?.optString("id") ?: ""
                mcpServers.value = mcpServers.value.filter { it.id != id }
                WsEvent.McpServerRemoved(id)
            }

            "mcp:server-status" -> {
                val id = data?.optString("id") ?: ""
                val status = data?.optString("status") ?: "disconnected"
                val error = data?.nullableString("error")
                val toolCount = data?.optInt("toolCount", 0) ?: 0
                WsEvent.McpServerStatus(id, status, error, toolCount)
            }

            "mcp:tools" -> {
                val agentId = data?.nullableString("agentId")
                val arr = data?.optJSONArray("tools") ?: JSONArray()
                val tools = (0 until arr.length()).map { i ->
                    val t = arr.getJSONObject(i)
                    McpToolInfo(
                        name = t.optString("name"),
                        description = t.nullableString("description"),
                        serverId = t.optString("serverId"),
                        serverName = t.optString("serverName"),
                    )
                }
                WsEvent.McpToolList(agentId, tools)
            }

            "wiki:extraction-candidates" -> {
                val conversationId = data?.optString("conversationId") ?: ""
                val arr = data?.optJSONArray("candidates") ?: JSONArray()
                val candidates = (0 until arr.length()).map { i ->
                    val c = arr.getJSONObject(i)
                    WikiExtractionCandidate(
                        title = c.optString("title"),
                        body = c.optString("body"),
                        tags = run { val ta = c.optJSONArray("tags"); if (ta != null) (0 until ta.length()).map { ta.optString(it) } else emptyList() },
                    )
                }
                WsEvent.WikiExtractionCandidates(conversationId, candidates)
            }

            "wiki:extraction-error" -> {
                WsEvent.WikiExtractionError(data?.optString("message") ?: "Extraction failed")
            }

            "skill:list" -> {
                val arr = data?.optJSONArray("skills") ?: JSONArray()
                val list = (0 until arr.length()).map { i -> parseSkillConfig(arr.getJSONObject(i)) }
                skills.value = list
                WsEvent.SkillList(list)
            }

            "skill:detail" -> WsEvent.SkillDetail(
                skill = data?.optJSONObject("skill")?.let { parseSkillConfig(it) }
            )

            "skill:created" -> {
                val skill = parseSkillConfig(data?.optJSONObject("skill") ?: return)
                skills.value = skills.value + skill
                WsEvent.SkillCreated(skill)
            }

            "skill:updated" -> {
                val skill = parseSkillConfig(data?.optJSONObject("skill") ?: return)
                skills.value = skills.value.map { if (it.id == skill.id) skill else it }
                WsEvent.SkillUpdated(skill)
            }

            "skill:deleted" -> {
                val id = data?.optString("id") ?: ""
                skills.value = skills.value.filter { it.id != id }
                WsEvent.SkillDeleted(id)
            }

            "skill:duplicated" -> WsEvent.SkillDuplicated(
                skill = data?.optJSONObject("skill")?.let { parseSkillConfig(it) }
            )

            "skill:exported" -> WsEvent.SkillExported(
                skill = data?.optJSONObject("skill")?.let { parseSkillConfig(it) }
            )

            "skill:agent-links" -> {
                val agentId = data?.optString("agentId") ?: ""
                val arr = data?.optJSONArray("links") ?: JSONArray()
                val links = (0 until arr.length()).map { i ->
                    val link = arr.getJSONObject(i)
                    SkillAgentLink(
                        skillId = link.optString("skill_id"),
                        sortOrder = link.optInt("sort_order", 0),
                    )
                }
                WsEvent.SkillAgentLinks(agentId, links)
            }

            "skill:agent-usage" -> {
                val arr = data?.optJSONArray("usage") ?: JSONArray()
                val usage = (0 until arr.length()).map { i ->
                    val row = arr.getJSONObject(i)
                    SkillAgentUsage(
                        skillId = row.optString("skill_id"),
                        agentCount = row.optInt("agent_count", 0),
                    )
                }
                skillAgentUsage.value = usage.associate { it.skillId to it.agentCount }
                WsEvent.SkillAgentUsageList(usage = usage)
            }

            "artifact:list" -> {
                val arr = data?.optJSONArray("artifacts") ?: return
                val list = (0 until arr.length()).map { i ->
                    val a = arr.getJSONObject(i)
                    ArtifactSummary(
                        id = a.optString("id"),
                        projectId = a.nullableString("projectId"),
                        title = a.optString("title"),
                        kind = a.optString("kind"),
                        description = a.nullableString("description"),
                        storageRoot = a.nullableString("storageRoot"),
                        status = a.optString("status"),
                        currentVersionId = a.nullableString("currentVersionId"),
                        createdAt = a.optLong("createdAt", 0L),
                        updatedAt = a.optLong("updatedAt", 0L),
                    )
                }
                artifacts.value = list
                WsEvent.ArtifactList(list)
            }

            "artifact:detail" -> {
                val a = data?.optJSONObject("artifact")
                if (a == null) {
                    WsEvent.ArtifactDetail(null)
                } else {
                    val cvObj = a.optJSONObject("currentVersion")
                    val currentVersion = cvObj?.let {
                        val filesArr = it.optJSONArray("files") ?: org.json.JSONArray()
                        ArtifactVersionSummary(
                            id = it.optString("id"),
                            artifactId = it.optString("artifactId"),
                            versionNumber = it.optInt("versionNumber", 1),
                            title = it.optString("title"),
                            notes = it.nullableString("notes"),
                            createdAt = it.optLong("createdAt", 0L),
                            files = (0 until filesArr.length()).map { fi ->
                                val f = filesArr.getJSONObject(fi)
                                ArtifactVersionFile(
                                    id = f.optString("id"),
                                    relativePath = f.optString("relativePath"),
                                    mediaType = f.optString("mediaType"),
                                    role = f.optString("role"),
                                )
                            },
                        )
                    }
                    WsEvent.ArtifactDetail(
                        ArtifactDetail2(
                            id = a.optString("id"),
                            projectId = a.nullableString("projectId"),
                            title = a.optString("title"),
                            kind = a.optString("kind"),
                            description = a.nullableString("description"),
                            storageRoot = a.nullableString("storageRoot"),
                            status = a.optString("status"),
                            currentVersionId = a.nullableString("currentVersionId"),
                            createdAt = a.optLong("createdAt", 0L),
                            updatedAt = a.optLong("updatedAt", 0L),
                            currentVersion = currentVersion,
                        )
                    )
                }
            }

            "artifact:versions" -> {
                val artifactId = data?.optString("artifactId") ?: ""
                val arr = data?.optJSONArray("versions") ?: org.json.JSONArray()
                WsEvent.ArtifactVersions(
                    artifactId = artifactId,
                    versions = (0 until arr.length()).map { i -> parseArtifactVersion(arr.getJSONObject(i)) },
                )
            }

            "artifact:deleted" -> WsEvent.ArtifactDeleted(
                id = data?.optString("id") ?: "",
                deleted = data?.optBoolean("deleted", false) ?: false,
            )

            "chat:active-turn-snapshot" -> {
                val snapshot = data?.optJSONObject("snapshot")
                if (snapshot == null) {
                    WsEvent.ChatActiveTurnSnapshot(
                        conversationId = data?.optString("conversationId") ?: "",
                        turnId = "",
                        latestSequence = 0L,
                        assistantText = "",
                        status = "completed",
                    )
                } else {
                    WsEvent.ChatActiveTurnSnapshot(
                        conversationId = snapshot.optString("conversationId"),
                        turnId = snapshot.optString("turnId"),
                        latestSequence = snapshot.optLong("latestSequence"),
                        assistantText = snapshot.optString("assistantText"),
                        status = snapshot.optString("status", "active"),
                    )
                }
            }

            "artifact:promoted" -> WsEvent.ArtifactPromoted(
                artifactId = data?.optString("artifactId") ?: "",
                versionId = data?.optString("versionId") ?: "",
                title = data?.optString("title") ?: "",
                messageId = data?.nullableString("messageId"),
            )

            "artifact:promote-error" -> WsEvent.ArtifactPromoteError(
                message = data?.optString("message") ?: "Artifact promotion failed",
                messageId = data?.nullableString("messageId"),
            )

            "artifact:export-pack" -> {
                val versionId = data?.optString("versionId") ?: ""
                val arr = data?.optJSONArray("files") ?: org.json.JSONArray()
                val files = (0 until arr.length()).map { i ->
                    val f = arr.getJSONObject(i)
                    ArtifactExportFile(
                        relativePath = f.optString("relativePath"),
                        mediaType = f.optString("mediaType"),
                        contentBase64 = f.optString("contentBase64"),
                    )
                }
                WsEvent.ArtifactExportPack(versionId, files)
            }

            "artifact:export-error" -> {
                WsEvent.ArtifactExportError(data?.optString("message") ?: "Export failed")
            }

            "wiki:list" -> {
                val arr = data?.optJSONArray("entries") ?: return
                val list = (0 until arr.length()).map { i -> parseWikiEntry(arr.getJSONObject(i)) }
                wikiEntries.value = list
                WsEvent.WikiList(list)
            }

            "wiki:entry-created" -> {
                val entry = parseWikiEntry(data?.optJSONObject("entry") ?: return)
                wikiEntries.value = wikiEntries.value + entry
                WsEvent.WikiEntryCreated(entry)
            }

            "wiki:entry-updated" -> {
                val entry = parseWikiEntry(data?.optJSONObject("entry") ?: return)
                wikiEntries.value = wikiEntries.value.map { if (it.id == entry.id) entry else it }
                WsEvent.WikiEntryUpdated(entry)
            }

            "wiki:entry-deleted" -> {
                val id = data?.optString("id") ?: ""
                wikiEntries.value = wikiEntries.value.filter { it.id != id }
                WsEvent.WikiEntryDeleted(id)
            }

            "prompt:list" -> {
                val arr = data?.optJSONArray("entries") ?: return
                val list = (0 until arr.length()).map { i -> parsePromptEntry(arr.getJSONObject(i)) }
                promptEntries.value = list
                WsEvent.PromptList(list)
            }

            "prompt:versions" -> {
                val promptId = data?.optString("promptId") ?: ""
                val arr = data?.optJSONArray("versions") ?: JSONArray()
                val versions = (0 until arr.length()).map { i -> parsePromptVersion(arr.getJSONObject(i)) }
                WsEvent.PromptVersions(promptId, versions)
            }

            "prompt:entry-created" -> {
                val entry = parsePromptEntry(data?.optJSONObject("entry") ?: return)
                promptEntries.value = promptEntries.value + entry
                WsEvent.PromptEntryCreated(entry)
            }

            "prompt:entry-updated" -> {
                val entry = parsePromptEntry(data?.optJSONObject("entry") ?: return)
                promptEntries.value = promptEntries.value.map { if (it.id == entry.id) entry else it }
                WsEvent.PromptEntryUpdated(entry)
            }

            "prompt:entry-deleted" -> {
                val id = data?.optString("id") ?: ""
                promptEntries.value = promptEntries.value.filter { it.id != id }
                WsEvent.PromptEntryDeleted(id)
            }

            "prompt:error" -> WsEvent.PromptError(
                message = data?.optString("message") ?: "Prompt operation failed"
            )

            "conversation:export-pack" -> {
                val p = data?.optJSONObject("pack") ?: return
                WsEvent.ConversationExportPackResult(
                    ConversationExportPackData(
                        format = p.optString("format"),
                        conversationId = p.optString("conversation_id"),
                        fileName = p.optString("file_name"),
                        mimeType = p.optString("mime_type"),
                        content = p.optString("content"),
                    )
                )
            }

            "conversation:export-error" -> WsEvent.ConversationExportError(
                message = data?.optString("message") ?: "Export failed"
            )

            "conversation:forked" -> WsEvent.ConversationForked(
                conversationId = data?.optString("conversationId") ?: "",
                title = data?.optString("title") ?: "",
                messageCount = data?.optInt("messageCount", 0) ?: 0,
            )

            "conversation:fork-error" -> WsEvent.ConversationForkError(
                message = data?.optString("message") ?: "Fork failed"
            )

            "conversation:imported" -> WsEvent.ConversationImported(
                conversationId = data?.optString("conversationId") ?: "",
                title = data?.optString("title") ?: "",
                messageCount = data?.optInt("messageCount", 0) ?: 0,
            )

            "conversation:import-error" -> WsEvent.ConversationImportError(
                message = data?.optString("message") ?: "Import failed"
            )

            "project-generator:token" -> WsEvent.ProjectGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "project-generator:turn-complete" -> WsEvent.ProjectGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "project-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseProjectGeneratorSpec(specData) ?: return
                WsEvent.ProjectGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "project-generator:created" -> WsEvent.ProjectGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                projectId = data?.optString("projectId") ?: "",
                name = data?.optString("name") ?: "",
            )

            "project-generator:error" -> WsEvent.ProjectGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "project-generator:cancelled" -> WsEvent.ProjectGeneratorCancelled(data?.nullableString("sessionId"))

            "project:config-updated" -> WsEvent.ProjectConfigUpdated(id = data?.optString("id") ?: "")

            "project:config" -> {
                val c = data?.optJSONObject("config") ?: JSONObject()
                fun strMap(obj: JSONObject): Map<String, String> {
                    val m = mutableMapOf<String, String>()
                    obj.keys().forEach { key ->
                        if (!obj.isNull(key)) m[key] = obj.optString(key)
                    }
                    return m
                }
                fun objList(key: String): List<Map<String, String>> {
                    val arr = c.optJSONArray(key) ?: return emptyList()
                    return (0 until arr.length()).map { strMap(arr.optJSONObject(it) ?: JSONObject()) }
                }
                WsEvent.ProjectConfig(
                    id = data?.optString("id") ?: "",
                    config = ProjectSettingsConfig(
                        instructions = c.optString("instructions", ""),
                        rootDirectory = c.nullableString("rootDirectory"),
                        variables = objList("variables"),
                        instructionMode = c.optString("instructionMode", "prepend"),
                        instructionsEnabled = c.optBoolean("instructionsEnabled", true),
                        orchestrationEnabled = c.optBoolean("orchestrationEnabled", false),
                        maxDelegationDepth = c.optInt("maxDelegationDepth", 5).coerceIn(1, 10),
                        showTeamActivity = c.optBoolean("showTeamActivity", true),
                        inScope = objList("inScope"),
                        outOfScope = objList("outOfScope"),
                        milestones = objList("milestones"),
                        defaultModel = c.nullableString("defaultModel"),
                    ),
                )
            }

            "project:agents" -> {
                val id = data?.optString("id") ?: ""
                val arr = data?.optJSONArray("agents") ?: JSONArray()
                val agents = (0 until arr.length()).map { i ->
                    val a = arr.optJSONObject(i) ?: JSONObject()
                    ProjectAgentEntry(
                        agentId = a.optString("agentId"),
                        agentName = a.optString("agentName"),
                        agentIcon = a.optString("agentIcon"),
                        isPrimary = a.optBoolean("isPrimary", false),
                        sortOrder = a.optInt("sortOrder", 0),
                    )
                }
                WsEvent.ProjectAgents(id = id, agents = agents)
            }

            "project-audit:sessions" -> {
                val projectId = data?.nullableString("projectId")
                val arr = data?.optJSONArray("sessions") ?: JSONArray()
                val sessions = (0 until arr.length()).map { i ->
                    val item = arr.optJSONObject(i) ?: JSONObject()
                    ProjectAuditSession(
                        id = item.optString("id"),
                        projectId = item.optString("projectId"),
                        conversationId = item.nullableString("conversationId"),
                        agentId = item.nullableString("agentId"),
                        title = item.optString("title"),
                        source = item.optString("source"),
                        createdAt = item.optLong("createdAt", 0L),
                        updatedAt = item.optLong("updatedAt", 0L),
                        fileCount = item.optInt("fileCount", 0),
                    )
                }
                WsEvent.ProjectAuditSessions(projectId = projectId, sessions = sessions)
            }

            "project-audit:files" -> {
                val sessionId = data?.optString("sessionId") ?: ""
                val arr = data?.optJSONArray("files") ?: JSONArray()
                val files = (0 until arr.length()).map { i ->
                    val item = arr.optJSONObject(i) ?: JSONObject()
                    ProjectAuditFile(
                        sessionId = item.optString("sessionId"),
                        relativePath = item.optString("relativePath"),
                        status = item.optString("status"),
                        lastOperation = item.optString("lastOperation"),
                        firstTouchedAt = item.optLong("firstTouchedAt", 0L),
                        lastTouchedAt = item.optLong("lastTouchedAt", 0L),
                        diffAvailable = item.optBoolean("diffAvailable", false),
                    )
                }
                WsEvent.ProjectAuditFiles(sessionId = sessionId, files = files)
            }

            "project-audit:diff" -> {
                val sessionId = data?.optString("sessionId") ?: ""
                val diffObj = data?.optJSONObject("diff")
                WsEvent.ProjectAuditDiffLoaded(
                    sessionId = sessionId,
                    diff = diffObj?.let {
                        ProjectAuditDiff(
                            relativePath = it.optString("relativePath"),
                            hunksJson = it.optJSONArray("hunks")?.toString(),
                        )
                    },
                )
            }

            "project-generator:model" -> WsEvent.ProjectGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "skill-generator:model" -> WsEvent.SkillGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "artifact-generator:model" -> WsEvent.ArtifactGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "agent-generator:model" -> WsEvent.AgentGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "agent-generator:token" -> WsEvent.AgentGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "agent-generator:turn-complete" -> WsEvent.AgentGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "agent-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseAgentGeneratorSpec(specData) ?: return
                WsEvent.AgentGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "agent-generator:created" -> WsEvent.AgentGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                agentId = data?.optString("agentId") ?: "",
                name = data?.optString("name") ?: "",
            )

            "agent-generator:error" -> WsEvent.AgentGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "agent-generator:cancelled" -> WsEvent.AgentGeneratorCancelled(data?.nullableString("sessionId"))

            "artifact-generator:token" -> WsEvent.ArtifactGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "artifact-generator:turn-complete" -> WsEvent.ArtifactGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "artifact-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseArtifactGeneratorSpec(specData) ?: return
                WsEvent.ArtifactGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "artifact-generator:created" -> WsEvent.ArtifactGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                artifactId = data?.optString("artifactId") ?: "",
                title = data?.optString("title") ?: "",
            )

            "artifact-generator:error" -> WsEvent.ArtifactGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "artifact-generator:cancelled" -> WsEvent.ArtifactGeneratorCancelled(data?.nullableString("sessionId"))

            "artifact:moved-to-project" -> WsEvent.ArtifactMovedToProject(
                artifactId = data?.optString("artifactId") ?: "",
                projectId = data?.nullableString("projectId"),
            )

            "skill-generator:token" -> WsEvent.SkillGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "skill-generator:turn-complete" -> WsEvent.SkillGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "skill-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseSkillGeneratorSpec(specData) ?: return
                WsEvent.SkillGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "skill-generator:created" -> WsEvent.SkillGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                skillId = data?.optString("skillId") ?: "",
                name = data?.optString("name") ?: "",
            )

            "skill-generator:error" -> WsEvent.SkillGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "skill-generator:cancelled" -> WsEvent.SkillGeneratorCancelled(data?.nullableString("sessionId"))

            "scheduler-generator:model" -> WsEvent.SchedulerGeneratorModel(
                sessionId = data?.nullableString("sessionId"),
                modelId = data?.optString("modelId") ?: "",
            )

            "scheduler-generator:token" -> WsEvent.SchedulerGeneratorToken(
                sessionId = data?.nullableString("sessionId"),
                chunk = data?.optString("chunk") ?: "",
            )

            "scheduler-generator:turn-complete" -> WsEvent.SchedulerGeneratorTurnComplete(
                sessionId = data?.nullableString("sessionId"),
                content = data?.optString("content") ?: "",
                hasSpec = data?.optBoolean("hasSpec", false) ?: false,
            )

            "scheduler-generator:spec-ready" -> {
                val specData = data?.optJSONObject("spec") ?: data
                val spec = parseScheduleGeneratorSpec(specData) ?: return
                WsEvent.SchedulerGeneratorSpecReady(data?.nullableString("sessionId"), spec)
            }

            "scheduler-generator:created" -> WsEvent.SchedulerGeneratorCreated(
                sessionId = data?.nullableString("sessionId"),
                taskId = data?.optString("taskId") ?: "",
                name = data?.optString("name") ?: "",
            )

            "scheduler-generator:error" -> WsEvent.SchedulerGeneratorError(
                sessionId = data?.nullableString("sessionId"),
                message = data?.optString("message") ?: "Unknown error",
            )

            "scheduler-generator:cancelled" -> WsEvent.SchedulerGeneratorCancelled(data?.nullableString("sessionId"))

            "provider:azure-endpoint" -> WsEvent.ProviderAzureEndpoint(
                endpoint = data?.optString("endpoint") ?: "",
            )

            "provider:azure-endpoint-set" -> WsEvent.ProviderAzureEndpointSet(
                endpoint = data?.optString("endpoint") ?: "",
            )

            "provider:test-result" -> WsEvent.ProviderTestResult(
                provider = data?.optString("provider") ?: "",
                valid = data?.optBoolean("valid", false) ?: false,
                error = data?.nullableString("error"),
            )

            "agent:knowledge-files" -> {
                val agentId = data?.optString("agentId") ?: ""
                val arr = data?.optJSONArray("files") ?: JSONArray()
                val files = (0 until arr.length()).mapNotNull { i ->
                    val f = arr.optJSONObject(i) ?: return@mapNotNull null
                    AgentKnowledgeFile(
                        id = f.optString("id"),
                        agentId = f.optString("agent_id"),
                        filePath = f.optString("file_path"),
                        injectMode = f.optString("inject_mode", "always"),
                        sortOrder = f.optInt("sort_order", 0),
                        createdAt = f.optLong("created_at", 0L),
                        updatedAt = f.optLong("updated_at", 0L),
                    )
                }
                WsEvent.AgentKnowledgeFiles(agentId, files)
            }

            "agent:knowledge-file-added" -> {
                val agentId = data?.optString("agentId") ?: ""
                val f = data?.optJSONObject("file")
                if (f != null) {
                    WsEvent.AgentKnowledgeFileAdded(
                        agentId = agentId,
                        file = AgentKnowledgeFile(
                            id = f.optString("id"),
                            agentId = f.optString("agent_id"),
                            filePath = f.optString("file_path"),
                            injectMode = f.optString("inject_mode", "always"),
                            sortOrder = f.optInt("sort_order", 0),
                            createdAt = f.optLong("created_at", 0L),
                            updatedAt = f.optLong("updated_at", 0L),
                        ),
                    )
                } else return
            }

            "agent:knowledge-file-removed" -> {
                val agentId = data?.optString("agentId") ?: ""
                val id = data?.optString("id") ?: ""
                WsEvent.AgentKnowledgeFileRemoved(agentId, id)
            }

            "agent:knowledge-file-content" -> {
                val agentId = data?.optString("agentId") ?: ""
                val filePath = data?.optString("filePath") ?: ""
                val content = data?.optString("content") ?: ""
                WsEvent.AgentKnowledgeFileContent(agentId, filePath, content)
            }

            "agent:knowledge-file-saved" -> {
                val agentId = data?.optString("agentId") ?: ""
                val filePath = data?.optString("filePath") ?: ""
                WsEvent.AgentKnowledgeFileSaved(agentId, filePath)
            }

            "agent:knowledge-file-error" -> {
                WsEvent.AgentKnowledgeFileError(data?.optString("message") ?: "Unknown error")
            }

            "agent:mcp-tool-overrides" -> {
                val agentId = data?.optString("agentId") ?: ""
                val arr = data?.optJSONArray("overrides") ?: JSONArray()
                val overrides = (0 until arr.length()).mapNotNull { i ->
                    val o = arr.optJSONObject(i) ?: return@mapNotNull null
                    AgentMcpToolOverride(
                        agentId = agentId,
                        serverId = o.optString("server_id"),
                        toolName = o.optString("tool_name"),
                        enabled = o.optInt("enabled", 1) != 0,
                        approval = o.optString("approval", "always-ask"),
                        instructions = o.optString("instructions", ""),
                    )
                }
                WsEvent.AgentMcpToolOverrides(agentId, overrides)
            }

            "agent:mcp-server-trust" -> {
                val agentId = data?.optString("agentId") ?: ""
                val arr = data?.optJSONArray("trust") ?: JSONArray()
                val trust = (0 until arr.length()).mapNotNull { i ->
                    val t = arr.optJSONObject(i) ?: return@mapNotNull null
                    AgentMcpServerTrust(
                        serverId = t.optString("server_id"),
                        trust = t.optString("trust", "auto"),
                    )
                }
                WsEvent.AgentMcpServerTrustList(agentId, trust)
            }

            "build:records" -> {
                val arr = data?.optJSONArray("records") ?: JSONArray()
                val list = (0 until arr.length()).map { i ->
                    val r = arr.getJSONObject(i)
                    val pathsArr = r.optJSONArray("artifactPaths") ?: JSONArray()
                    BuildRecord(
                        id = r.optString("id"),
                        workspacePath = r.optString("workspacePath"),
                        commitSha = r.nullableString("commitSha"),
                        branch = r.nullableString("branch"),
                        version = r.nullableString("version"),
                        versionCode = if (r.isNull("versionCode")) null else r.optInt("versionCode"),
                        platform = r.optString("platform"),
                        command = r.optString("command"),
                        status = r.optString("status"),
                        exitCode = if (r.isNull("exitCode")) null else r.optInt("exitCode"),
                        artifactPaths = (0 until pathsArr.length()).map { pathsArr.optString(it) },
                        logTail = r.optString("logTail", ""),
                        startedAt = r.optLong("startedAt", 0L),
                        finishedAt = if (r.isNull("finishedAt")) null else r.optLong("finishedAt"),
                    )
                }
                WsEvent.BuildRecords(list)
            }

            "build:workspace-info" -> WsEvent.BuildWorkspaceInfo(
                path = data?.optString("path") ?: "",
                branch = data?.nullableString("branch"),
                commitSha = data?.nullableString("commitSha"),
                dirty = data?.optBoolean("dirty", false) ?: false,
                version = data?.nullableString("version"),
                isGitRepo = data?.optBoolean("isGitRepo", false) ?: false,
            )

            "build:preflight-result" -> {
                val arr = data?.optJSONArray("checks") ?: JSONArray()
                WsEvent.BuildPreflightResult((0 until arr.length()).map { i ->
                    val c = arr.getJSONObject(i)
                    PreflightCheck(label = c.optString("label"), status = c.optString("status"), detail = c.optString("detail"))
                })
            }

            "build:started" -> WsEvent.BuildStarted(
                buildId = data?.optString("buildId") ?: "",
                command = data?.optString("command") ?: "",
            )

            "build:log-chunk" -> WsEvent.BuildLogChunk(
                buildId = data?.optString("buildId") ?: "",
                line = data?.optString("line") ?: "",
                stream = data?.optString("stream") ?: "stdout",
                replace = data?.optBoolean("replace", false) ?: false,
            )

            "build:command-done" -> WsEvent.BuildCommandDone(
                buildId = data?.nullableString("buildId"),
                status = data?.optString("status") ?: "failed",
                exitCode = if (data?.isNull("exitCode") != false) null else data.optInt("exitCode"),
                error = data?.nullableString("error"),
            )

            "build:cancelled" -> WsEvent.BuildCancelled(
                buildId = data?.optString("buildId") ?: "",
                cancelled = data?.optBoolean("cancelled", false) ?: false,
            )

            "update:restarting" -> WsEvent.UpdateRestarting(
                eta = data?.optInt("eta") ?: 10,
                version = data?.nullableString("version"),
                error = data?.nullableString("error"),
            )

            "android:workspace-info" -> WsEvent.AndroidWorkspaceInfo(
                path = data?.optString("path") ?: "",
                branch = data?.nullableString("branch"),
                commitSha = data?.nullableString("commitSha"),
                dirty = data?.optBoolean("dirty", false) ?: false,
                versionCode = if (data?.isNull("versionCode") != false) null else data.optInt("versionCode"),
                versionName = data?.nullableString("versionName"),
                isGitRepo = data?.optBoolean("isGitRepo", false) ?: false,
            )

            "android:signing-validation" -> {
                val arr = data?.optJSONArray("checks") ?: JSONArray()
                WsEvent.AndroidSigningValidation(
                    valid = data?.optBoolean("valid", false) ?: false,
                    checks = (0 until arr.length()).map { i ->
                        val c = arr.getJSONObject(i)
                        PreflightCheck(label = c.optString("label"), status = c.optString("status"), detail = c.optString("detail"))
                    }
                )
            }

            "android:publish-result" -> WsEvent.AndroidPublishResult(
                published = data?.optBoolean("published", false) ?: false,
                error = data?.nullableString("error"),
                manifest = data?.optJSONObject("manifest")?.let { parseAndroidPublishManifest(it) },
            )

            "android:restore-result" -> WsEvent.AndroidRestoreResult(
                restored = data?.optBoolean("restored", false) ?: false,
                error = data?.nullableString("error"),
                manifest = data?.optJSONObject("manifest")?.let { parseAndroidPublishManifest(it) },
            )

            // ── Scheduler ──────────────────────────────────────────────────
            "scheduler:list" -> {
                val arr = data?.optJSONArray("tasks") ?: return
                val tasks = (0 until arr.length()).map { parseScheduledTask(arr.getJSONObject(it)) }
                scheduledTasks.value = tasks
                WsEvent.SchedulerTaskList(tasks)
            }

            "scheduler:get" -> {
                val taskObj = data?.optJSONObject("task") ?: return
                val task = parseScheduledTask(taskObj)
                scheduledTasks.value = scheduledTasks.value
                    .map { if (it.id == task.id) task else it }
                    .let { list -> if (list.none { it.id == task.id }) list + task else list }
                WsEvent.SchedulerTaskUpdated(task)
            }

            "scheduler:task-updated" -> {
                val taskObj = data?.optJSONObject("task") ?: return
                val task = parseScheduledTask(taskObj)
                scheduledTasks.value = scheduledTasks.value
                    .map { if (it.id == task.id) task else it }
                    .let { list -> if (list.none { it.id == task.id }) list + task else list }
                WsEvent.SchedulerTaskUpdated(task)
            }

            "scheduler:task-deleted" -> {
                val taskId = data?.optString("taskId") ?: return
                scheduledTasks.value = scheduledTasks.value.filter { it.id != taskId }
                scheduledRuns.value = scheduledRuns.value - taskId
                WsEvent.SchedulerTaskDeleted(taskId)
            }

            "scheduler:run-updated" -> {
                val runObj = data?.optJSONObject("run") ?: return
                val run = parseScheduledRun(runObj)
                scheduledRuns.value = scheduledRuns.value.toMutableMap().apply {
                    val existing = getOrDefault(run.taskId, emptyList())
                    val updated = existing.map { if (it.id == run.id) run else it }
                    put(run.taskId, if (updated.none { it.id == run.id }) listOf(run) + updated else updated)
                }
                WsEvent.SchedulerRunUpdated(run)
            }

            "scheduler:runs" -> {
                val taskId = data?.optString("taskId") ?: return
                val arr = data.optJSONArray("runs") ?: return
                val runs = (0 until arr.length()).map { parseScheduledRun(arr.getJSONObject(it)) }
                scheduledRuns.value = scheduledRuns.value.toMutableMap().apply { put(taskId, runs) }
                WsEvent.SchedulerRunList(taskId, runs)
            }

            "scheduler:run-error" -> {
                val taskId = data?.optString("taskId") ?: return
                val errorMsg = data.optString("error")
                WsEvent.SchedulerRunError(taskId, errorMsg)
            }

            "debrief:ready" -> {
                val debriefObj = data?.optJSONObject("debrief") ?: return
                val debrief = parseConversationDebrief(debriefObj)
                currentDebrief.value = debrief
                WsEvent.DebriefReady(debrief)
            }

            "debrief:loaded" -> {
                val debriefObj = data?.optJSONObject("debrief")
                val debrief = debriefObj?.let { parseConversationDebrief(it) }
                currentDebrief.value = debrief
                WsEvent.DebriefLoaded(debrief)
            }

            "debrief:error" -> WsEvent.DebriefError(data?.optString("message") ?: "Unknown error")

            "debrief:conversation-completed" -> {
                val conversationId = data?.optString("conversationId") ?: return
                val completedAt = data.optLong("completedAt", 0L)
                completedConversationIds.value = completedConversationIds.value + conversationId
                WsEvent.DebriefConversationCompleted(conversationId, completedAt)
            }

            "debrief:conversation-incompleted" -> {
                val conversationId = data?.optString("conversationId") ?: return
                completedConversationIds.value = completedConversationIds.value - conversationId
                WsEvent.DebriefConversationIncompleted(conversationId)
            }

            "quiz:ready" -> {
                val arr = data?.optJSONArray("questions") ?: return
                val questions = (0 until arr.length()).map { parseQuizQuestion(arr.getJSONObject(it)) }
                WsEvent.QuizReady(questions)
            }

            "quiz:error" -> WsEvent.QuizError(data?.optString("message") ?: "Unknown error")

            "quiz:attempt-saved" -> {
                val attemptObj = data?.optJSONObject("attempt") ?: return
                WsEvent.QuizAttemptSaved(parseQuizAttempt(attemptObj))
            }

            "quiz:attempts-listed" -> {
                val conversationId = data?.optString("conversationId") ?: return
                val arr = data.optJSONArray("attempts") ?: return
                val attempts = (0 until arr.length()).map { parseQuizAttempt(arr.getJSONObject(it)) }
                WsEvent.QuizAttemptsListed(conversationId, attempts)
            }

            else -> return
        }
        scope.launch { events.emit(wsEvent) }
    } catch (_: Exception) {}
}

private fun parseAndroidPublishManifest(m: JSONObject) = AndroidPublishManifest(
    versionCode = m.optInt("versionCode", 0),
    versionName = m.optString("versionName", ""),
    commitSha = m.nullableString("commitSha"),
    changelog = m.optString("changelog", ""),
    checksum = m.optString("checksum", ""),
    artifactUrl = m.optString("artifactUrl", ""),
    publishedAt = m.optLong("publishedAt", 0L),
)

private fun parseMcpServerWithStatus(s: JSONObject): McpServerWithStatus {
    val argsArr = s.optJSONArray("args")
    val args = if (argsArr != null) (0 until argsArr.length()).map { argsArr.optString(it) } else emptyList()
    return McpServerWithStatus(
        id = s.optString("id"),
        name = s.optString("name"),
        command = s.optString("command"),
        args = args,
        enabled = s.optBoolean("enabled", false),
        status = s.optString("status", "disconnected"),
        error = s.nullableString("error"),
        toolCount = s.optInt("toolCount", 0),
    )
}

private fun parseWikiEntry(obj: JSONObject): WikiEntry {
    fun strList(key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return WikiEntry(
        id = obj.optString("id"),
        projectId = obj.optString("projectId"),
        title = obj.optString("title"),
        body = obj.optString("body"),
        tags = strList("tags"),
        sourceConversationId = obj.nullableString("sourceConversationId"),
        createdAt = obj.optLong("createdAt", 0L),
        updatedAt = obj.optLong("updatedAt", 0L),
    )
}

private fun parseArtifactVersion(obj: JSONObject): ArtifactVersionSummary {
    val filesArr = obj.optJSONArray("files") ?: JSONArray()
    return ArtifactVersionSummary(
        id = obj.optString("id"),
        artifactId = obj.optString("artifactId"),
        versionNumber = obj.optInt("versionNumber", 1),
        title = obj.optString("title"),
        notes = obj.nullableString("notes"),
        createdAt = obj.optLong("createdAt", 0L),
        files = (0 until filesArr.length()).map { i ->
            val f = filesArr.getJSONObject(i)
            ArtifactVersionFile(
                id = f.optString("id"),
                relativePath = f.optString("relativePath"),
                mediaType = f.optString("mediaType"),
                role = f.optString("role"),
            )
        },
    )
}

private fun parseSkillConfig(obj: JSONObject): SkillConfig {
    fun strList(key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    fun parseTool(tool: JSONObject?) = SkillToolConfig(
        enabled = tool?.optBoolean("enabled", false) ?: false,
        approval = tool?.optString("approval", "always-ask") ?: "always-ask",
        instructions = tool?.optString("instructions", "") ?: "",
    )
    val toolsObj = obj.optJSONObject("tools")
    val knowledgeArr = obj.optJSONArray("knowledge") ?: JSONArray()
    val trustArr = obj.optJSONArray("mcpServerTrust") ?: JSONArray()
    val overridesArr = obj.optJSONArray("mcpToolOverrides") ?: JSONArray()
    return SkillConfig(
        id = obj.optString("id"),
        name = obj.optString("name", "New Skill"),
        icon = obj.optString("icon", "*"),
        description = obj.optString("description", ""),
        instructions = obj.optString("instructions", ""),
        tags = strList("tags"),
        tools = SkillTools(
            fileEdit = parseTool(toolsObj?.optJSONObject("fileEdit")),
            terminal = parseTool(toolsObj?.optJSONObject("terminal")),
            webFetch = parseTool(toolsObj?.optJSONObject("webFetch")),
        ),
        mcpServers = strList("mcpServers"),
        mcpServerTrust = (0 until trustArr.length()).map { i ->
            val item = trustArr.optJSONObject(i) ?: JSONObject()
            SkillMcpServerTrust(
                serverId = item.optString("serverId"),
                trust = item.optString("trust", "always-ask"),
            )
        },
        mcpToolOverrides = (0 until overridesArr.length()).map { i ->
            val item = overridesArr.optJSONObject(i) ?: JSONObject()
            SkillMcpToolOverride(
                serverId = item.optString("serverId"),
                toolName = item.optString("toolName"),
                enabled = item.optBoolean("enabled", true),
                approval = item.optString("approval", "always-ask"),
                instructions = item.optString("instructions", ""),
            )
        },
        knowledge = (0 until knowledgeArr.length()).map { i ->
            val item = knowledgeArr.optJSONObject(i) ?: JSONObject()
            SkillKnowledge(
                title = item.optString("title"),
                content = item.optString("content"),
            )
        },
        createdAt = if (obj.has("created_at")) obj.optLong("created_at") else null,
        updatedAt = if (obj.has("updated_at")) obj.optLong("updated_at") else null,
    )
}

private fun parsePromptEntry(obj: JSONObject): PromptEntry {
    fun strList(key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return PromptEntry(
        id = obj.optString("id"),
        title = obj.optString("title"),
        body = obj.optString("body"),
        description = obj.optString("description"),
        category = obj.optString("category"),
        tags = strList("tags"),
        scope = obj.optString("scope", "global"),
        projectId = obj.nullableString("projectId"),
        createdAt = obj.optLong("createdAt", 0L),
        updatedAt = obj.optLong("updatedAt", 0L),
    )
}

private fun parsePromptVersion(obj: JSONObject): PromptVersion {
    fun strList(key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    val diff = obj.optJSONObject("diff") ?: JSONObject()
    fun diffLines(key: String): List<String> {
        val arr = diff.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return PromptVersion(
        id = obj.optString("id"),
        promptId = obj.optString("promptId"),
        version = obj.optInt("version", 1),
        title = obj.optString("title"),
        body = obj.optString("body"),
        description = obj.optString("description"),
        category = obj.optString("category"),
        tags = strList("tags"),
        variables = strList("variables"),
        scope = obj.optString("scope", "global"),
        projectId = obj.nullableString("projectId"),
        source = obj.optString("source"),
        createdAt = obj.optLong("createdAt", 0L),
        diff = PromptVersionDiff(
            titleChanged = diff.optBoolean("titleChanged", false),
            descriptionChanged = diff.optBoolean("descriptionChanged", false),
            categoryChanged = diff.optBoolean("categoryChanged", false),
            tagsChanged = diff.optBoolean("tagsChanged", false),
            scopeChanged = diff.optBoolean("scopeChanged", false),
            addedLines = diffLines("addedLines"),
            removedLines = diffLines("removedLines"),
        ),
    )
}

private fun parseProjectGeneratorSpec(data: org.json.JSONObject?): ProjectGeneratorSpec? {
    val d = data ?: return null
    fun strMap(obj: JSONObject): Map<String, String> {
        val m = mutableMapOf<String, String>()
        obj.keys().forEach { k -> m[k] = obj.optString(k) }
        return m
    }
    fun objList(key: String): List<Map<String, String>> {
        val arr = d.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { strMap(arr.optJSONObject(it) ?: JSONObject()) }
    }
    val agentsArr = d.optJSONArray("agents") ?: JSONArray()
    val agents = (0 until agentsArr.length()).map { i ->
        val a = agentsArr.getJSONObject(i)
        val na = a.optJSONObject("newAgent")
        val tools = na?.optJSONObject("tools")
        ProjectGeneratorAgentSpec(
            role = a.optString("role"),
            description = a.optString("description"),
            existingAgentId = a.nullableString("existingAgentId"),
            isLeader = a.optBoolean("isLeader", false),
            newAgent = na?.let {
                ProjectGeneratorNewAgent(
                    name = it.optString("name"),
                    icon = it.optString("icon"),
                    systemPrompt = it.optString("systemPrompt"),
                    temperature = it.optDouble("temperature", 0.7),
                    responseFormat = it.optString("responseFormat", "default"),
                    tools = ProjectGeneratorAgentTools(
                        fileEdit = tools?.optBoolean("fileEdit", false) ?: false,
                        terminal = tools?.optBoolean("terminal", false) ?: false,
                        webFetch = tools?.optBoolean("webFetch", false) ?: false,
                    ),
                )
            },
        )
    }
    return ProjectGeneratorSpec(
        name = d.optString("name", "New Project"),
        color = d.optString("color", "blue"),
        instructions = d.optString("instructions", ""),
        rootDirectory = d.nullableString("rootDirectory"),
        instructionMode = d.nullableString("instructionMode"),
        variables = objList("variables"),
        inScope = objList("inScope"),
        outOfScope = objList("outOfScope"),
        milestones = objList("milestones"),
        orchestrationEnabled = d.optBoolean("orchestrationEnabled", true),
        defaultModel = d.nullableString("defaultModel"),
        agents = agents,
    )
}

private fun parseAgentTools(obj: JSONObject?): AgentTools {
    fun parseToolConfig(tool: JSONObject?, defaultEnabled: Boolean, defaultApproval: String) = ToolConfig(
        enabled = tool?.optBoolean("enabled", defaultEnabled) ?: defaultEnabled,
        approval = tool?.optString("approval", defaultApproval) ?: defaultApproval,
        instructions = tool?.optString("instructions", "") ?: "",
    )
    return AgentTools(
        fileEdit = parseToolConfig(obj?.optJSONObject("fileEdit"), defaultEnabled = true, defaultApproval = "always-ask"),
        terminal = parseToolConfig(obj?.optJSONObject("terminal"), defaultEnabled = false, defaultApproval = "always-ask"),
        webFetch = parseToolConfig(obj?.optJSONObject("webFetch"), defaultEnabled = true, defaultApproval = "never-ask"),
    )
}

private fun parseAgentGeneratorSpec(data: JSONObject?): AgentGeneratorSpec? {
    val d = data ?: return null
    val toolsObj = d.optJSONObject("tools")
    val ctxArr = d.optJSONArray("contextDirectories")
    val contextDirectories = if (ctxArr != null) (0 until ctxArr.length()).map { ctxArr.optString(it) } else emptyList()
    return AgentGeneratorSpec(
        name = d.optString("name", ""),
        icon = d.optString("icon", ""),
        systemPrompt = d.optString("systemPrompt", ""),
        temperature = d.optDouble("temperature", 0.7),
        responseFormat = d.optString("responseFormat", "default"),
        agenticMode = d.optBoolean("agenticMode", false),
        tools = AgentGeneratorTools(
            fileEdit = toolsObj?.optBoolean("fileEdit", true) ?: true,
            terminal = toolsObj?.optBoolean("terminal", false) ?: false,
            webFetch = toolsObj?.optBoolean("webFetch", true) ?: true,
        ),
        rootDirectory = d.nullableString("rootDirectory"),
        contextDirectories = contextDirectories,
        memory = d.nullableString("memory"),
    )
}

private fun parseSkillGeneratorSpec(data: JSONObject?): SkillGeneratorSpec? {
    val d = data ?: return null
    val toolsObj = d.optJSONObject("tools")
    val toolInstrObj = d.optJSONObject("toolInstructions")
    val approvalObj = d.optJSONObject("approval")
    val toolInstructions = mutableMapOf<String, String>()
    val approval = mutableMapOf<String, String>()
    listOf("fileEdit", "terminal", "webFetch").forEach { key ->
        toolInstrObj?.nullableString(key)?.let { toolInstructions[key] = it }
        approvalObj?.nullableString(key)?.let { approval[key] = it }
    }
    fun strList(key: String): List<String> {
        val arr = d.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    val knowledgeArr = d.optJSONArray("knowledge")
    val knowledge = if (knowledgeArr != null) {
        (0 until knowledgeArr.length()).mapNotNull { i ->
            val k = knowledgeArr.optJSONObject(i) ?: return@mapNotNull null
            SkillKnowledge(title = k.optString("title"), content = k.optString("content"))
        }
    } else emptyList()
    return SkillGeneratorSpec(
        name = d.optString("name", ""),
        icon = d.optString("icon", ""),
        description = d.optString("description", ""),
        instructions = d.optString("instructions", ""),
        tools = SkillGeneratorTools(
            fileEdit = toolsObj?.optBoolean("fileEdit", false) ?: false,
            terminal = toolsObj?.optBoolean("terminal", false) ?: false,
            webFetch = toolsObj?.optBoolean("webFetch", false) ?: false,
        ),
        toolInstructions = toolInstructions,
        approval = approval,
        mcpServers = strList("mcpServers"),
        tags = strList("tags"),
        knowledge = knowledge,
        suggestedAgents = strList("suggestedAgents"),
    )
}

private fun parseScheduleGeneratorSpec(data: JSONObject?): ScheduleGeneratorSpec? {
    val d = data ?: return null
    return ScheduleGeneratorSpec(
        name = d.optString("name", ""),
        prompt = d.optString("prompt", ""),
        scheduleType = d.optString("scheduleType", "daily"),
        localTime = d.optString("localTime", "09:00"),
        weekday = if (d.has("weekday") && !d.isNull("weekday")) d.optInt("weekday") else null,
        monthDay = if (d.has("monthDay") && !d.isNull("monthDay")) d.optInt("monthDay") else null,
        timezone = d.optString("timezone", "UTC"),
        agentId = d.nullableString("agentId"),
        projectId = d.nullableString("projectId"),
        notificationPref = d.optString("notificationPref", "always"),
    )
}

private fun parseArtifactGeneratorSpec(data: JSONObject?): ArtifactGeneratorSpec? {
    val d = data ?: return null
    fun strList(key: String): List<String> {
        val arr = d.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    val scopeObj = d.optJSONObject("scope")
    val filesArr = d.optJSONArray("outputFiles") ?: JSONArray()
    val outputFiles = (0 until filesArr.length()).map { i ->
        val f = filesArr.optJSONObject(i) ?: JSONObject()
        ArtifactOutputFile(
            path = f.optString("path", "output.md"),
            mediaType = f.optString("mediaType", "text/plain"),
            role = f.optString("role", "primary"),
            description = f.nullableString("description"),
        )
    }
    val srcObj = d.optJSONObject("sourceContext")
    fun srcStrList(key: String): List<String> {
        val arr = srcObj?.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return ArtifactGeneratorSpec(
        title = d.optString("title", "New Artifact"),
        kind = d.optString("kind", "document"),
        scopeType = scopeObj?.optString("type") ?: "global",
        scopeProjectId = scopeObj?.nullableString("projectId"),
        intendedUse = d.optString("intendedUse", ""),
        audience = d.nullableString("audience"),
        outputFiles = outputFiles,
        acceptanceCriteria = strList("acceptanceCriteria"),
        exportFormats = strList("exportFormats"),
        sourceContext = ArtifactSourceContext(
            useProjectInstructions = srcObj?.optBoolean("useProjectInstructions", false) ?: false,
            useProjectWiki = srcObj?.optBoolean("useProjectWiki", false) ?: false,
            useConversationContext = srcObj?.optBoolean("useConversationContext", false) ?: false,
            referencedFiles = srcStrList("referencedFiles"),
        ),
    )
}

private fun parseThinkingBlocks(json: String?): List<ThinkingBlock> {
    if (json.isNullOrBlank()) return emptyList()
    return try {
        val arr = JSONArray(json)
        (0 until arr.length()).mapNotNull { i ->
            val obj = arr.optJSONObject(i) ?: return@mapNotNull null
            ThinkingBlock(
                blockId = obj.optString("blockId"),
                content = obj.optString("content"),
                done = obj.optBoolean("done", true),
            )
        }
    } catch (_: Exception) { emptyList() }
}

private fun parseConversationArray(arr: JSONArray): List<Conversation> =
    (0 until arr.length()).map { i ->
        val row = arr.getJSONObject(i)
        Conversation(
            id = row.optString("id"),
            title = row.optString("title"),
            created_at = row.optString("created_at"),
            updated_at = row.optString("updated_at"),
            agent_id = row.nullableString("agent_id"),
            agent_name = row.nullableString("agent_name"),
            agent_icon = row.nullableString("agent_icon"),
            project_id = row.nullableString("project_id"),
            project_name = row.nullableString("project_name"),
            model = row.nullableString("model"),
            last_message = row.nullableString("last_message"),
            pinned = row.optInt("pinned", 0) != 0,
            completed_at = if (row.has("completed_at") && !row.isNull("completed_at")) row.optLong("completed_at") else null,
        )
    }

private fun parseConversationDebrief(obj: JSONObject): ConversationDebrief {
    val toolsArr = obj.optJSONArray("commandsTools")
    val commandsTools = if (toolsArr != null) (0 until toolsArr.length()).map { toolsArr.optString(it) } else emptyList()
    return ConversationDebrief(
        id = obj.optString("id"),
        conversationId = obj.optString("conversationId"),
        projectId = obj.nullableString("projectId"),
        summary = obj.optString("summary"),
        commandsTools = commandsTools,
        reproductionGuide = obj.optString("reproductionGuide"),
        mentalModel = obj.optString("mentalModel"),
        generatedAt = obj.optLong("generatedAt", 0L),
        createdAt = obj.optLong("createdAt", 0L),
    )
}

private fun parseQuizQuestion(obj: JSONObject): QuizQuestion {
    val optArr = obj.optJSONArray("options")
    val options = if (optArr != null) (0 until optArr.length()).map { optArr.optString(it) } else emptyList()
    return QuizQuestion(
        id = obj.optString("id"),
        question = obj.optString("question"),
        options = options,
        correctIndex = obj.optInt("correctIndex", 0),
        explanation = obj.optString("explanation"),
        category = obj.optString("category"),
    )
}

private fun parseQuizAttempt(obj: JSONObject) = QuizAttempt(
    id = obj.optString("id"),
    conversationId = obj.optString("conversationId"),
    score = obj.optInt("score", 0),
    total = obj.optInt("total", 0),
    attemptedAt = obj.optLong("attemptedAt", 0L),
)

private fun parseScheduledTask(obj: JSONObject) = ScheduledTask(
    id = obj.optString("id"),
    name = obj.optString("name"),
    prompt = obj.optString("prompt"),
    enabled = obj.optBoolean("enabled", true),
    agentId = obj.nullableString("agentId"),
    projectId = obj.nullableString("projectId"),
    model = obj.nullableString("model"),
    conversationId = obj.nullableString("conversationId"),
    scheduleType = obj.optString("scheduleType", "daily"),
    localTime = obj.optString("localTime", "09:00"),
    weekday = if (obj.has("weekday") && !obj.isNull("weekday")) obj.optInt("weekday") else null,
    monthDay = if (obj.has("monthDay") && !obj.isNull("monthDay")) obj.optInt("monthDay") else null,
    timezone = obj.optString("timezone", "UTC"),
    notificationPref = obj.optString("notificationPref", "failures_only"),
    nextRunAt = if (obj.has("nextRunAt") && !obj.isNull("nextRunAt")) obj.optLong("nextRunAt") else null,
    lastRunAt = if (obj.has("lastRunAt") && !obj.isNull("lastRunAt")) obj.optLong("lastRunAt") else null,
    createdAt = obj.optLong("createdAt"),
    updatedAt = obj.optLong("updatedAt"),
)

private fun parseScheduledRun(obj: JSONObject) = ScheduledRun(
    id = obj.optString("id"),
    taskId = obj.optString("taskId"),
    scheduledAt = if (obj.has("scheduledAt") && !obj.isNull("scheduledAt")) obj.optLong("scheduledAt") else null,
    startedAt = if (obj.has("startedAt") && !obj.isNull("startedAt")) obj.optLong("startedAt") else null,
    finishedAt = if (obj.has("finishedAt") && !obj.isNull("finishedAt")) obj.optLong("finishedAt") else null,
    status = obj.optString("status", "pending"),
    error = obj.nullableString("error"),
    conversationId = obj.nullableString("conversationId"),
    messageId = obj.nullableString("messageId"),
    triggerSource = obj.optString("triggerSource", "scheduled"),
    createdAt = obj.optLong("createdAt"),
)
