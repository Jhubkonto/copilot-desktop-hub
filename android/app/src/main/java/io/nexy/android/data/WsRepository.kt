package io.nexy.android.data

import android.app.Application
import android.app.NotificationManager
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
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

    private val _errorReports = MutableStateFlow<List<ErrorReport>>(emptyList())
    val errorReports: StateFlow<List<ErrorReport>> = _errorReports

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
                parseWsEvent(
                    text = text,
                    scope = scope,
                    events = _events,
                    serverVersion = _serverVersion,
                    conversations = _conversations,
                    projects = _projects,
                    agents = _agents,
                    models = _models,
                    modelSource = _modelSource,
                    androidUpdateManifest = _androidUpdateManifest,
                    errorReports = _errorReports,
                )
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
        _errorReports.value = emptyList()
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

    fun renameConversation(id: String, title: String) { send("conversation:rename", mapOf("id" to id, "title" to title)) }
    fun deleteConversation(id: String) { send("conversation:delete", mapOf("id" to id)) }
    fun searchConversations(query: String) { send("conversation:search", mapOf("query" to query)) }
    fun deleteMessage(id: String) { send("message:delete", mapOf("id" to id)) }
    fun refreshReports() { send("self-heal:get-reports", emptyMap()) }

    fun cancelApprovalNotification() {
        app?.getSystemService(NotificationManager::class.java)
            ?.cancel(ApprovalNotificationManager.NOTIFICATION_ID)
    }
}
