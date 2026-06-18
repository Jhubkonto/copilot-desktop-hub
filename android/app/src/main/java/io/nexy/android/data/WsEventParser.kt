package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AgentTools
import io.nexy.android.data.model.ToolConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactDetail2
import io.nexy.android.data.model.ProjectGeneratorSpec
import io.nexy.android.data.model.ProjectGeneratorAgentSpec
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.ArtifactVersionFile
import io.nexy.android.data.model.ArtifactVersionSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.ConversationExportPackData
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.FeatureGeneratorRun
import io.nexy.android.data.model.FeatureSpec
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.WsEvent
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
    featureGeneratorRuns: MutableStateFlow<List<FeatureGeneratorRun>>,
    artifacts: MutableStateFlow<List<ArtifactSummary>>,
    wikiEntries: MutableStateFlow<List<WikiEntry>>,
    promptEntries: MutableStateFlow<List<PromptEntry>>,
    cliStatus: MutableStateFlow<Map<String, CliInstallInfo>>,
) {
    try {
        val obj = JSONObject(text)
        val event = obj.optString("event")
        val data = obj.optJSONObject("data")

        val wsEvent: WsEvent = when (event) {
            "connected" -> {
                val version = data?.optString("version") ?: ""
                serverVersion.value = version.takeIf { it.isNotBlank() }
                WsEvent.Connected(version)
            }

            "tool:approval-request" -> WsEvent.ToolApprovalRequest(
                requestId = data?.optString("requestId") ?: "",
                toolName = data?.optString("toolName") ?: "",
                args = jsonObjectToMap(data?.optJSONObject("args")),
            )

            "chat:stream-chunk" -> WsEvent.ChatStreamChunk(
                conversationId = data?.optString("conversationId") ?: "",
                text = data?.optString("chunk") ?: "",
            )

            "chat:stream-end" -> WsEvent.ChatStreamEnd(
                conversationId = data?.optString("conversationId") ?: "",
            )

            "chat:activity" -> WsEvent.ChatActivity(
                conversationId = data?.optString("conversationId") ?: "",
                state = data?.optString("state") ?: "thinking",
                label = data?.optString("label") ?: "Assistant is thinking",
                toolName = data?.nullableString("toolName"),
                serverName = data?.nullableString("serverName"),
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

            "self-heal:investigation-activity" -> WsEvent.SelfHealInvestigationActivity(
                reportId = data?.optString("reportId") ?: "",
                label = data?.optString("label") ?: "",
                type = data?.optString("type") ?: "status",
            )

            "self-heal:investigation-chunk" -> WsEvent.SelfHealInvestigationChunk(
                reportId = data?.optString("reportId") ?: "",
                chunk = data?.optString("chunk") ?: "",
            )

            "self-heal:investigation-done" -> WsEvent.SelfHealInvestigationDone(
                reportId = data?.optString("reportId") ?: "",
                status = data?.optString("status") ?: "",
                error = data?.nullableString("error"),
            )

            "self-heal:verification-event" -> WsEvent.SelfHealVerificationEvent(
                reportId = data?.optString("reportId") ?: "",
                runId = data?.optString("runId") ?: "",
                command = data?.nullableString("command"),
                status = data?.optString("status") ?: "",
                label = data?.optString("label") ?: "",
                line = data?.nullableString("line"),
            )

            "self-heal:verification-done" -> WsEvent.SelfHealVerificationDone(
                reportId = data?.optString("reportId") ?: "",
                runId = data?.optString("runId") ?: "",
                status = data?.optString("status") ?: "",
                error = data?.nullableString("error"),
            )

            "self-heal:git-event" -> WsEvent.SelfHealGitEvent(
                reportId = data?.optString("reportId") ?: "",
                type = data?.optString("type") ?: "",
                label = data?.optString("label") ?: "",
                commitSha = data?.nullableString("commitSha"),
                error = data?.nullableString("error"),
            )

            "self-heal:recovery-event" -> WsEvent.SelfHealRecoveryEvent(
                reportId = data?.optString("reportId") ?: "",
                recoveryId = data?.nullableString("recoveryId"),
                type = data?.optString("type") ?: "",
                label = data?.optString("label") ?: "",
                status = data?.nullableString("status"),
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
                    )
                }
                WsEvent.ConversationMessages(conversationId, messages)
            }

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
                errorReports.value = list
                WsEvent.SelfHealReports(list)
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
                    memory = a.optString("memory", ""),
                    tools = parseAgentTools(a.optJSONObject("tools")),
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

            "feature-generator:run-created" -> {
                val runId = data?.optString("runId") ?: ""
                WsEvent.FeatureGeneratorRunCreated(runId)
            }

            "feature-generator:token" -> {
                val chunk = data?.optString("chunk") ?: ""
                WsEvent.FeatureGeneratorToken(chunk)
            }

            "feature-generator:chat-turn-done" -> WsEvent.FeatureGeneratorChatTurnDone()

            "feature-generator:spec-ready" -> {
                val spec = parseFeatureSpec(data) ?: return
                WsEvent.FeatureGeneratorSpecReady(spec)
            }

            "feature-generator:plan-ready" -> {
                val runId = data?.optString("runId") ?: ""
                val plan = data?.optString("plan") ?: ""
                featureGeneratorRuns.value = featureGeneratorRuns.value.map {
                    if (it.id == runId) it.copy(planMarkdown = plan, status = "plan-ready") else it
                }
                WsEvent.FeatureGeneratorPlanReady(runId, plan)
            }

            "feature-generator:diff-ready" -> {
                val runId = data?.optString("runId") ?: ""
                featureGeneratorRuns.value = featureGeneratorRuns.value.map {
                    if (it.id == runId) it.copy(status = "diff-ready") else it
                }
                WsEvent.FeatureGeneratorDiffReady(runId)
            }

            "feature-generator:diff-list" -> {
                val runId = data?.optString("runId") ?: ""
                val filesArr = data?.optJSONArray("files") ?: return
                val files = (0 until filesArr.length()).map { filesArr.getString(it) }
                WsEvent.FeatureGeneratorDiffList(runId, files)
            }

            "feature-generator:applied" -> {
                val runId = data?.optString("runId") ?: ""
                val filesArr = data?.optJSONArray("appliedFiles") ?: return
                val applied = (0 until filesArr.length()).map { filesArr.getString(it) }
                featureGeneratorRuns.value = featureGeneratorRuns.value.map {
                    if (it.id == runId) it.copy(status = "applied") else it
                }
                WsEvent.FeatureGeneratorApplied(runId, applied)
            }

            "feature-generator:committed" -> {
                val runId = data?.optString("runId") ?: ""
                val commitSha = data?.optString("commitSha") ?: ""
                featureGeneratorRuns.value = featureGeneratorRuns.value.map {
                    if (it.id == runId) it.copy(status = "committed", commitSha = commitSha) else it
                }
                WsEvent.FeatureGeneratorCommitted(runId, commitSha)
            }

            "feature-generator:runs" -> {
                val arr = data?.optJSONArray("runs") ?: return
                val runs = (0 until arr.length()).map { i ->
                    val r = arr.getJSONObject(i)
                    FeatureGeneratorRun(
                        id = r.optString("id"),
                        title = r.optString("title"),
                        status = r.optString("status"),
                        specJson = r.nullableString("specJson"),
                        planMarkdown = r.nullableString("planMarkdown"),
                        stagedFilesJson = r.nullableString("stagedFilesJson"),
                        appliedFilesJson = r.nullableString("appliedFilesJson"),
                        commitSha = r.nullableString("commitSha"),
                        createdAt = r.optLong("createdAt", 0L),
                        updatedAt = r.optLong("updatedAt", 0L),
                    )
                }
                featureGeneratorRuns.value = runs
                WsEvent.FeatureGeneratorRuns(runs)
            }

            "feature-generator:error" -> {
                val runId = data?.nullableString("runId")
                val message = data?.optString("message") ?: "Unknown error"
                WsEvent.FeatureGeneratorError(runId, message)
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
                            status = a.optString("status"),
                            currentVersionId = a.nullableString("currentVersionId"),
                            createdAt = a.optLong("createdAt", 0L),
                            updatedAt = a.optLong("updatedAt", 0L),
                            currentVersion = currentVersion,
                        )
                    )
                }
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
                chunk = data?.optString("chunk") ?: "",
            )

            "project-generator:spec-ready" -> {
                val spec = parseProjectGeneratorSpec(data) ?: return
                WsEvent.ProjectGeneratorSpecReady(spec)
            }

            "project-generator:created" -> WsEvent.ProjectGeneratorCreated(
                projectId = data?.optString("projectId") ?: "",
                name = data?.optString("name") ?: "",
            )

            "project-generator:error" -> WsEvent.ProjectGeneratorError(
                message = data?.optString("message") ?: "Unknown error",
            )

            "project-generator:cancelled" -> WsEvent.ProjectGeneratorCancelled()

            else -> return
        }
        scope.launch { events.emit(wsEvent) }
    } catch (_: Exception) {}
}

private fun parseFeatureSpec(data: org.json.JSONObject?): FeatureSpec? {
    val d = data ?: return null
    val title = d.optString("title").takeIf { it.isNotBlank() } ?: return null
    fun strList(key: String): List<String> {
        val arr = d.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }
    return FeatureSpec(
        title = title,
        type = d.optString("type", "feature"),
        userStory = d.optString("userStory"),
        acceptanceCriteria = strList("acceptanceCriteria"),
        constraints = strList("constraints"),
        outOfScope = strList("outOfScope"),
        risks = strList("risks"),
        likelyAffectedFiles = strList("likelyAffectedFiles"),
        verificationPlan = strList("verificationPlan"),
        autonomy = d.optString("autonomy", "staged-diffs"),
        targetAreas = strList("targetAreas"),
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
        ProjectGeneratorAgentSpec(
            role = a.optString("role"),
            description = a.optString("description"),
            existingAgentId = a.nullableString("existingAgentId"),
            isLeader = a.optBoolean("isLeader", false),
            newAgentName = na?.nullableString("name"),
            newAgentIcon = na?.nullableString("icon"),
            newAgentSystemPrompt = na?.nullableString("systemPrompt"),
        )
    }
    return ProjectGeneratorSpec(
        name = d.optString("name", "New Project"),
        color = d.optString("color", "blue"),
        instructions = d.optString("instructions", ""),
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
    )
    return AgentTools(
        fileEdit = parseToolConfig(obj?.optJSONObject("fileEdit"), defaultEnabled = true, defaultApproval = "always-ask"),
        terminal = parseToolConfig(obj?.optJSONObject("terminal"), defaultEnabled = false, defaultApproval = "always-ask"),
        webFetch = parseToolConfig(obj?.optJSONObject("webFetch"), defaultEnabled = true, defaultApproval = "never-ask"),
    )
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
        )
    }
