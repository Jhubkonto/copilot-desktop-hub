package io.nexy.android.data

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.WsEvent
import io.nexy.android.notification.ApprovalNotificationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

enum class ConnectionState { DISCONNECTED, CONNECTING, CONNECTED }

object WsRepository {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.IO)

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError

    private val _events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<WsEvent> = _events

    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations

    private val _agents = MutableStateFlow<List<Agent>>(emptyList())
    val agents: StateFlow<List<Agent>> = _agents

    private val _projects = MutableStateFlow<List<Project>>(emptyList())
    val projects: StateFlow<List<Project>> = _projects

    private var ws: WebSocket? = null
    private var currentUrl: String? = null
    private var currentToken: String? = null
    private var reconnectJob: Job? = null
    private var reconnectAttempts = 0
    private val maxReconnects = 5

    private var app: Application? = null

    fun init(application: Application) {
        app = application
        val prefs = application.getSharedPreferences("nexy_prefs", Context.MODE_PRIVATE)
        val savedUrl = prefs.getString("last_ws_url", null)
        if (!savedUrl.isNullOrBlank()) {
            val uri = android.net.Uri.parse(savedUrl)
            val token = uri.getQueryParameter("token") ?: return
            currentUrl = savedUrl
            currentToken = token
            doConnect(savedUrl, token)
        }
    }

    fun connect(wsUrl: String, token: String) {
        reconnectJob?.cancel()
        ws?.cancel()
        currentUrl = wsUrl
        currentToken = token
        reconnectAttempts = 0
        doConnect(wsUrl, token)
    }

    private fun doConnect(wsUrl: String, token: String) {
        _connectionState.value = ConnectionState.CONNECTING
        val request = Request.Builder().url(wsUrl).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectAttempts = 0
                _connectionState.value = ConnectionState.CONNECTED
                _lastError.value = null
                app?.getSharedPreferences("nexy_prefs", Context.MODE_PRIVATE)
                    ?.edit()?.putString("last_ws_url", currentUrl)?.apply()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                parseEvent(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _lastError.value = t.message
                _connectionState.value = ConnectionState.DISCONNECTED
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _connectionState.value = ConnectionState.DISCONNECTED
                if (code != 4001 && code != 4002) scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        val url = currentUrl ?: return
        val token = currentToken ?: return
        if (reconnectAttempts >= maxReconnects) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(3_000L)
            reconnectAttempts++
            doConnect(url, token)
        }
    }

    fun disconnect() {
        reconnectJob?.cancel()
        currentUrl = null
        currentToken = null
        ws?.close(1000, "User disconnected")
        ws = null
        _connectionState.value = ConnectionState.DISCONNECTED
        _conversations.value = emptyList()
        _agents.value = emptyList()
        _projects.value = emptyList()
    }

    fun forgetServer() {
        app?.getSharedPreferences("nexy_prefs", Context.MODE_PRIVATE)
            ?.edit()?.remove("last_ws_url")?.apply()
        disconnect()
    }

    fun send(command: String, data: Map<String, Any> = emptyMap()) {
        val token = currentToken ?: return
        val obj = JSONObject()
        obj.put("token", token)
        obj.put("command", command)
        obj.put("data", mapToJson(data))
        ws?.send(obj.toString())
    }

    private fun mapToJson(map: Map<String, Any>): JSONObject {
        val obj = JSONObject()
        for ((k, v) in map) obj.put(k, toJsonValue(v))
        return obj
    }

    private fun listToJson(list: List<*>): JSONArray {
        val arr = JSONArray()
        for (v in list) arr.put(if (v != null) toJsonValue(v) else JSONObject.NULL)
        return arr
    }

    @Suppress("UNCHECKED_CAST")
    private fun toJsonValue(v: Any): Any = when (v) {
        is Map<*, *> -> mapToJson(v as Map<String, Any>)
        is List<*> -> listToJson(v)
        else -> v
    }

    fun cancelApprovalNotification() {
        app?.getSystemService(NotificationManager::class.java)
            ?.cancel(ApprovalNotificationManager.NOTIFICATION_ID)
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseEvent(text: String) {
        try {
            val obj = JSONObject(text)
            val event = obj.optString("event")
            val data = obj.optJSONObject("data")

            val wsEvent: WsEvent = when (event) {
                "connected" -> WsEvent.Connected(data?.optString("version") ?: "")

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
                            agent_name = row.nullableString("agent_name"),
                            agent_icon = row.nullableString("agent_icon"),
                            project_id = row.nullableString("project_id"),
                            project_name = row.nullableString("project_name"),
                            last_message = row.nullableString("last_message"),
                        )
                    }
                    _conversations.value = list
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
                    _projects.value = list
                    WsEvent.ProjectList(list)
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
                        )
                    }
                    WsEvent.ConversationMessages(conversationId, messages)
                }

                "agent:list" -> {
                    val agentsArray = data?.optJSONArray("agents") ?: JSONArray()
                    val list = (0 until agentsArray.length()).map { i ->
                        val a = agentsArray.getJSONObject(i)
                        Agent(id = a.optString("id"), name = a.optString("name"), icon = a.optString("icon", ""))
                    }
                    _agents.value = list
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
            scope.launch { _events.emit(wsEvent) }
        } catch (_: Exception) {}
    }

    // org.json returns the string "null" for JSON null values via optString — use this instead
    private fun JSONObject.nullableString(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

    private fun jsonObjectToMap(obj: JSONObject?): Map<String, Any> {
        if (obj == null) return emptyMap()
        val map = mutableMapOf<String, Any>()
        for (key in obj.keys()) map[key] = obj.get(key)
        return map
    }
}
