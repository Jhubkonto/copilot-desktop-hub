package io.nexy.android.data

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
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
    models: MutableStateFlow<List<ModelOption>>,
    modelSource: MutableStateFlow<ModelListSource?>,
    androidUpdateManifest: MutableStateFlow<AndroidUpdateManifest?>,
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
                val list = (0 until rows.length()).map { i ->
                    val row = rows.getJSONObject(i)
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

            else -> return
        }
        scope.launch { events.emit(wsEvent) }
    } catch (_: Exception) {}
}
