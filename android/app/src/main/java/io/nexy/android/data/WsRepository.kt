package io.nexy.android.data

import android.app.Application
import android.app.NotificationManager
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
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

object WsRepository : WsClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.IO)

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError

    private val _serverVersion = MutableStateFlow<String?>(null)
    val serverVersion: StateFlow<String?> = _serverVersion

    private val _events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 64)
    override val events: SharedFlow<WsEvent> = _events

    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations

    private val _agents = MutableStateFlow<List<Agent>>(emptyList())
    val agents: StateFlow<List<Agent>> = _agents

    private val _projects = MutableStateFlow<List<Project>>(emptyList())
    val projects: StateFlow<List<Project>> = _projects

    private val _models = MutableStateFlow<List<ModelOption>>(emptyList())
    val models: StateFlow<List<ModelOption>> = _models

    private val _modelSource = MutableStateFlow<ModelListSource?>(null)
    val modelSource: StateFlow<ModelListSource?> = _modelSource

    private val _androidUpdateManifest = MutableStateFlow<AndroidUpdateManifest?>(null)
    val androidUpdateManifest: StateFlow<AndroidUpdateManifest?> = _androidUpdateManifest

    private val _profiles = MutableStateFlow<List<PairedServerProfile>>(emptyList())
    val profiles: StateFlow<List<PairedServerProfile>> = _profiles

    private val _activeProfileId = MutableStateFlow<String?>(null)
    val activeProfileId: StateFlow<String?> = _activeProfileId

    private var ws: WebSocket? = null
    private var currentUrl: String? = null
    private var currentToken: String? = null
    private var currentCertFingerprint: String? = null
    private var reconnectJob: Job? = null
    private var reconnectAttempts = 0
    private val maxReconnects = 5

    private var app: Application? = null
    private var pairedServerStore: PairedServerStore? = null

    private val pendingCommands = mutableListOf<Pair<String, Map<String, Any>>>()

    fun sendOrQueue(command: String, data: Map<String, Any>) {
        if (connectionState.value == ConnectionState.CONNECTED) {
            send(command, data)
        } else {
            synchronized(pendingCommands) { pendingCommands.add(command to data) }
            if (connectionState.value == ConnectionState.DISCONNECTED) {
                connectFromStore()
            }
        }
    }

    fun connectFromStore() {
        pairedServerStore?.load()?.let { connect(it) }
    }

    fun init(application: Application) {
        app = application
        pairedServerStore = runCatching { PairedServerStore(application) }
            .onFailure { _lastError.value = it.message ?: "Unable to open secure pairing storage" }
            .getOrNull()
        refreshProfiles()
        pairedServerStore?.load()?.let { config ->
            refreshProfiles()
            currentUrl = config.connectUrl
            currentToken = config.token
            currentCertFingerprint = config.certFingerprint
            if (!doConnect(config.connectUrl)) {
                pairedServerStore?.clear()
                refreshProfiles()
            }
        }
    }

    fun connect(config: PairedServerConfig) {
        reconnectJob?.cancel()
        ws?.cancel()
        currentUrl = config.connectUrl
        currentToken = config.token
        currentCertFingerprint = config.certFingerprint
        reconnectAttempts = 0
        doConnect(config.connectUrl)
    }

    private fun buildPinnedClient(fingerprint: String): OkHttpClient {
        val trustManager = object : javax.net.ssl.X509TrustManager {
            override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>, authType: String) {
                val cert = chain.firstOrNull()
                    ?: throw java.security.cert.CertificateException("No certificate in chain")
                val digest = java.security.MessageDigest.getInstance("SHA-256").digest(cert.encoded)
                val fp = digest.joinToString("") { "%02x".format(it) }
                if (fp != fingerprint.lowercase())
                    throw java.security.cert.CertificateException("Certificate fingerprint mismatch")
            }
            override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = emptyArray()
        }
        val sslContext = javax.net.ssl.SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf(trustManager), null)
        @Suppress("CustomX509TrustManager")
        return client.newBuilder()
            .sslSocketFactory(sslContext.socketFactory, trustManager)
            .hostnameVerifier { _, _ -> true }
            .build()
    }

    private fun doConnect(wsUrl: String): Boolean {
        _connectionState.value = ConnectionState.CONNECTING
        val request = runCatching { Request.Builder().url(wsUrl).build() }
            .getOrElse {
                _lastError.value = it.message ?: "Invalid WebSocket URL"
                _connectionState.value = ConnectionState.DISCONNECTED
                return false
            }
        val activeClient = currentCertFingerprint?.takeIf { it.isNotBlank() }
            ?.let { buildPinnedClient(it) } ?: client
        ws = activeClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectAttempts = 0
                _connectionState.value = ConnectionState.CONNECTED
                _lastError.value = null
                _serverVersion.value = null
                val endpoint = currentUrl?.substringBefore("?token=")
                val token = currentToken
                if (!endpoint.isNullOrBlank() && !token.isNullOrBlank()) {
                    pairedServerStore?.save(PairedServerConfig(endpoint, token))
                    refreshProfiles()
                }
                synchronized(pendingCommands) {
                    pendingCommands.forEach { (cmd, data) -> send(cmd, data) }
                    pendingCommands.clear()
                }
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
        return true
    }

    private fun scheduleReconnect() {
        val url = currentUrl ?: return
        if (currentToken == null) return
        if (reconnectAttempts >= maxReconnects) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(3_000L)
            reconnectAttempts++
            doConnect(url)
        }
    }

    fun disconnect() {
        reconnectJob?.cancel()
        currentUrl = null
        currentToken = null
        currentCertFingerprint = null
        ws?.close(1000, "User disconnected")
        ws = null
        _connectionState.value = ConnectionState.DISCONNECTED
        _conversations.value = emptyList()
        _agents.value = emptyList()
        _projects.value = emptyList()
        _models.value = emptyList()
        _modelSource.value = null
        _androidUpdateManifest.value = null
        _serverVersion.value = null
    }

    fun forgetServer() {
        disconnect()
        val fallback = pairedServerStore?.removeActive()
        refreshProfiles()
        if (fallback != null) {
            connect(fallback)
        }
    }

    fun forgetProfile(profileId: String) {
        if (profileId == _activeProfileId.value) {
            forgetServer()
            return
        }
        pairedServerStore?.removeProfile(profileId)
        refreshProfiles()
    }

    fun switchProfile(profileId: String) {
        val config = pairedServerStore?.setActive(profileId) ?: return
        refreshProfiles()
        disconnect()
        connect(config)
    }

    fun hasPairedServer(): Boolean = pairedServerStore?.profiles()?.isNotEmpty() == true

    fun pairedServer(): PairedServerConfig? = pairedServerStore?.load()

    private fun refreshProfiles() {
        _profiles.value = pairedServerStore?.profiles().orEmpty()
        _activeProfileId.value = pairedServerStore?.activeProfile()?.id
    }

    override fun send(command: String, data: Map<String, Any>) {
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
                "connected" -> {
                    val version = data?.optString("version") ?: ""
                    _serverVersion.value = version.takeIf { it.isNotBlank() }
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
                    _models.value = list
                    val source = sourceObject?.let {
                        ModelListSource(
                            type = it.optString("type"),
                            label = it.optString("label"),
                            backend = it.nullableString("backend"),
                        )
                    }
                    _modelSource.value = source
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
                    _androidUpdateManifest.value = manifest
                    WsEvent.AndroidUpdateManifestResult(manifest)
                }

                "conversation:model-updated" -> {
                    val conversationId = data?.optString("conversationId") ?: ""
                    val model = data?.nullableString("model")
                    _conversations.value = _conversations.value.map { conversation ->
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

    private fun attachmentsFromJson(attachmentsJson: String?): List<AttachmentMeta> {
        if (attachmentsJson.isNullOrBlank()) return emptyList()
        return runCatching {
            val arr = JSONArray(attachmentsJson)
            (0 until arr.length()).mapNotNull { i ->
                val obj = arr.optJSONObject(i) ?: return@mapNotNull null
                val name = obj.optString("name").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                AttachmentMeta(
                    id = obj.optString("id").ifBlank { name },
                    name = name,
                    type = obj.nullableString("type"),
                    thumbnailDataUrl = obj.nullableString("thumbnailDataUrl"),
                )
            }
        }.getOrDefault(emptyList())
    }

    private fun jsonObjectToMap(obj: JSONObject?): Map<String, Any> {
        if (obj == null) return emptyMap()
        val map = mutableMapOf<String, Any>()
        for (key in obj.keys()) map[key] = obj.get(key)
        return map
    }
}
