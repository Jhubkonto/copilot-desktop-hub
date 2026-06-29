package io.nexy.android.data

import android.app.Application
import android.app.NotificationManager
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.ScheduledTask
import io.nexy.android.data.model.ScheduledRun
import io.nexy.android.data.model.ConversationDebrief
import io.nexy.android.data.model.QuizAttempt
import io.nexy.android.data.model.AgentKnowledgeFile
import io.nexy.android.data.model.AgentMcpServerTrust
import io.nexy.android.data.model.AgentMcpToolOverride
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactGeneratorSpec
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpToolInfo
import io.nexy.android.data.model.WikiExtractionCandidate
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.ScheduleGeneratorSpec
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import io.nexy.android.notification.ApprovalNotificationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
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

enum class ConnectionState { DISCONNECTED, CONNECTING, CONNECTED, POLLING }

object WsRepository : WsClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(30_000, TimeUnit.MILLISECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.IO)

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError

    private val _reconnectExhausted = MutableStateFlow(false)
    val reconnectExhausted: StateFlow<Boolean> = _reconnectExhausted


    private val _serverVersion = MutableStateFlow<String?>(null)
    val serverVersion: StateFlow<String?> = _serverVersion

    private val _events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 64)
    override val events: SharedFlow<WsEvent> = _events

    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations

    private val _agents = MutableStateFlow<List<Agent>>(emptyList())
    val agents: StateFlow<List<Agent>> = _agents

    val agentFullConfig = MutableStateFlow<AgentFullConfig?>(null)
    val agentKnowledgeFiles = MutableStateFlow<List<AgentKnowledgeFile>>(emptyList())
    val agentMcpToolOverrides = MutableStateFlow<List<AgentMcpToolOverride>>(emptyList())
    val agentMcpServerTrust = MutableStateFlow<List<AgentMcpServerTrust>>(emptyList())
    val mcpToolList = MutableStateFlow<List<McpToolInfo>>(emptyList())
    val wikiExtractionCandidates = MutableStateFlow<List<WikiExtractionCandidate>>(emptyList())

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

    data class DebugLogEntry(val tag: String, val message: String, val ts: Long)
    private val _debugLog = MutableStateFlow<List<DebugLogEntry>>(emptyList())
    val debugLog: StateFlow<List<DebugLogEntry>> = _debugLog

    private val _providers = MutableStateFlow<List<ProviderInfo>>(emptyList())
    val providers: StateFlow<List<ProviderInfo>> = _providers

    private val _mcpServers = MutableStateFlow<List<McpServerInfo>>(emptyList())
    val mcpServers: StateFlow<List<McpServerInfo>> = _mcpServers

    // One-shot highlight IDs set by config screens when saving a brand-new item
    val pendingHighlightProjectId = MutableStateFlow<String?>(null)
    val pendingHighlightAgentId = MutableStateFlow<String?>(null)

    // Emits requestIds resolved via notification (approve or reject) so HomeViewModel
    // can clear the in-app approval dialog immediately, before the tool finishes.
    val approvalResolvedViaNotification = MutableSharedFlow<String>(extraBufferCapacity = 4)

    private val _skills = MutableStateFlow<List<SkillConfig>>(emptyList())
    val skills: StateFlow<List<SkillConfig>> = _skills

    private val _skillAgentUsage = MutableStateFlow<Map<String, Int>>(emptyMap())
    val skillAgentUsage: StateFlow<Map<String, Int>> = _skillAgentUsage

    private val _artifacts = MutableStateFlow<List<ArtifactSummary>>(emptyList())
    val artifacts: StateFlow<List<ArtifactSummary>> = _artifacts

    private val _wikiEntries = MutableStateFlow<List<WikiEntry>>(emptyList())
    val wikiEntries: StateFlow<List<WikiEntry>> = _wikiEntries

    private val _promptEntries = MutableStateFlow<List<PromptEntry>>(emptyList())
    val promptEntries: StateFlow<List<PromptEntry>> = _promptEntries

    private val _cliStatus = MutableStateFlow<Map<String, CliInstallInfo>>(emptyMap())
    val cliStatus: StateFlow<Map<String, CliInstallInfo>> = _cliStatus

    private val _scheduledTasks = MutableStateFlow<List<ScheduledTask>>(emptyList())
    val scheduledTasks: StateFlow<List<ScheduledTask>> = _scheduledTasks

    private val _scheduledRuns = MutableStateFlow<Map<String, List<ScheduledRun>>>(emptyMap())
    val scheduledRuns: StateFlow<Map<String, List<ScheduledRun>>> = _scheduledRuns

    private val _currentDebrief = MutableStateFlow<ConversationDebrief?>(null)
    val currentDebrief: StateFlow<ConversationDebrief?> = _currentDebrief

    private val _completedConversationIds = MutableStateFlow<Set<String>>(emptySet())
    val completedConversationIds: StateFlow<Set<String>> = _completedConversationIds

    private val _profiles = MutableStateFlow<List<PairedServerProfile>>(emptyList())
    val profiles: StateFlow<List<PairedServerProfile>> = _profiles

    private val _activeProfileId = MutableStateFlow<String?>(null)
    val activeProfileId: StateFlow<String?> = _activeProfileId

    private val _activeConversationIds = MutableStateFlow<Set<String>>(emptySet())
    val activeConversationIds: StateFlow<Set<String>> = _activeConversationIds

    private val _pendingConversationIds = MutableStateFlow<Set<String>>(emptySet())
    val pendingConversationIds: StateFlow<Set<String>> = _pendingConversationIds

    fun markConversationPending(id: String) {
        _pendingConversationIds.value = _pendingConversationIds.value + id
    }

    data class LiveToolCall(
        val toolName: String,
        val serverName: String?,
        val args: String?,
        val result: String?,
        val success: Boolean,
    )

    data class ActiveChatSnapshot(
        val activityLabel: String = "Assistant is thinking",
        val liveThinkingBlocks: List<ThinkingBlock> = emptyList(),
        val completedToolCalls: List<LiveToolCall> = emptyList(),
        val isStreaming: Boolean = false,
        val generationStartedAt: Long = 0L,
    )

    private val _activeChatSnapshots = MutableStateFlow<Map<String, ActiveChatSnapshot>>(emptyMap())
    val activeChatSnapshots: StateFlow<Map<String, ActiveChatSnapshot>> = _activeChatSnapshots

    val activelyViewedConversationId = MutableStateFlow<String?>(null)

    private val _completedWhileAwayIds = MutableStateFlow<Set<String>>(emptySet())
    val completedWhileAwayIds: StateFlow<Set<String>> = _completedWhileAwayIds
    fun clearCompletedAway(id: String) { _completedWhileAwayIds.value = _completedWhileAwayIds.value - id }

    private var ws: WebSocket? = null
    private var currentUrl: String? = null
    private var currentToken: String? = null
    private var currentCertFingerprint: String? = null
    private var reconnectJob: Job? = null
    private var handshakeTimeoutJob: Job? = null
    private var reconnectAttempts = 0

    // Set to true when the desktop sends update:restarting so that a 4001/4002
    // close code from the relaunch does not suppress auto-reconnect.
    private val _intentionalRestartExpected = MutableStateFlow(false)
    val intentionalRestartExpected: StateFlow<Boolean> = _intentionalRestartExpected

    private var app: Application? = null
    private var pairedServerStore: PairedServerStore? = null
    private var networkMonitor: NetworkReconnectMonitor? = null

    private val pendingCommands = mutableListOf<Pair<String, Map<String, Any>>>()

    init {
        scope.launch {
            events.collect { event ->
                when (event) {
                    is WsEvent.ChatActivity -> {
                        val activeStates = setOf("active", "thinking", "tool")
                        val doneStates = setOf("complete", "error")
                        _activeConversationIds.value = when (event.state) {
                            in activeStates -> _activeConversationIds.value + event.conversationId
                            in doneStates -> _activeConversationIds.value - event.conversationId
                            else -> _activeConversationIds.value
                        }
                        // Remove from pending once the desktop has acknowledged the conversation
                        if (_pendingConversationIds.value.contains(event.conversationId)) {
                            _pendingConversationIds.value = _pendingConversationIds.value - event.conversationId
                        }
                        // Track conversations that completed while not being viewed
                        if (event.state == "complete" && activelyViewedConversationId.value != event.conversationId) {
                            _completedWhileAwayIds.value = _completedWhileAwayIds.value + event.conversationId
                        }
                        // Maintain in-flight snapshot for re-entry restoration
                        if (event.state in doneStates) {
                            _activeChatSnapshots.value = _activeChatSnapshots.value - event.conversationId
                        } else {
                            val existing = _activeChatSnapshots.value[event.conversationId]
                            val startedAt = if (existing != null) existing.generationStartedAt else System.currentTimeMillis()
                            _activeChatSnapshots.value = _activeChatSnapshots.value + (event.conversationId to
                                (existing ?: ActiveChatSnapshot()).copy(
                                    activityLabel = event.label.ifBlank { "Assistant is thinking" },
                                    generationStartedAt = startedAt,
                                ))
                        }
                    }
                    is WsEvent.ChatThinkingDelta -> {
                        val snapshots = _activeChatSnapshots.value
                        val existing = snapshots[event.conversationId] ?: ActiveChatSnapshot()
                        val blocks = existing.liveThinkingBlocks.toMutableList()
                        val idx = blocks.indexOfFirst { it.blockId == event.blockId }
                        if (idx >= 0) {
                            blocks[idx] = blocks[idx].copy(content = blocks[idx].content + event.chunk)
                        } else {
                            blocks.add(ThinkingBlock(blockId = event.blockId, content = event.chunk, done = false))
                        }
                        _activeChatSnapshots.value = snapshots + (event.conversationId to existing.copy(liveThinkingBlocks = blocks))
                    }
                    is WsEvent.ChatThinkingEnd -> {
                        val snapshots = _activeChatSnapshots.value
                        val existing = snapshots[event.conversationId] ?: return@collect
                        val blocks = existing.liveThinkingBlocks.map {
                            if (it.blockId == event.blockId) it.copy(done = true) else it
                        }
                        _activeChatSnapshots.value = snapshots + (event.conversationId to existing.copy(liveThinkingBlocks = blocks))
                    }
                    is WsEvent.ChatToolCallEvent -> {
                        val snapshots = _activeChatSnapshots.value
                        val existing = snapshots[event.conversationId] ?: ActiveChatSnapshot()
                        val tc = LiveToolCall(
                            toolName = event.toolName,
                            serverName = event.serverName,
                            args = event.args,
                            result = event.result,
                            success = event.success,
                        )
                        _activeChatSnapshots.value = snapshots + (event.conversationId to
                            existing.copy(completedToolCalls = existing.completedToolCalls + tc))
                    }
                    is WsEvent.ChatStreamChunk -> {
                        val snapshots = _activeChatSnapshots.value
                        val existing = snapshots[event.conversationId] ?: ActiveChatSnapshot()
                        if (!existing.isStreaming) {
                            _activeChatSnapshots.value = snapshots + (event.conversationId to existing.copy(isStreaming = true))
                        }
                    }
                    is WsEvent.ChatStreamEnd -> {
                        _activeConversationIds.value = _activeConversationIds.value - event.conversationId
                        _pendingConversationIds.value = _pendingConversationIds.value - event.conversationId
                        if (activelyViewedConversationId.value != event.conversationId) {
                            _completedWhileAwayIds.value = _completedWhileAwayIds.value + event.conversationId
                        }
                        _activeChatSnapshots.value = _activeChatSnapshots.value - event.conversationId
                    }
                    is WsEvent.ConversationList -> {
                        val knownIds = _conversations.value.map { it.id }.toSet()
                        _pendingConversationIds.value = _pendingConversationIds.value - knownIds
                        val completedIds = _conversations.value.filter { it.completed_at != null }.map { it.id }.toSet()
                        _completedConversationIds.value = completedIds
                    }
                    is WsEvent.ConversationCreated -> {
                        val knownIds = _conversations.value.map { it.id }.toSet()
                        _pendingConversationIds.value = _pendingConversationIds.value - knownIds
                    }
                    is WsEvent.UpdateRestarting -> {
                        _intentionalRestartExpected.value = true
                    }
                    is WsEvent.Connected -> {
                        // Desktop came back online — clear the restart-expected flag
                        _intentionalRestartExpected.value = false
                    }
                    else -> {}
                }
            }
        }
    }

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
            if (runCatching { Request.Builder().url(config.connectUrl).build() }.isFailure) {
                pairedServerStore?.clear()
                refreshProfiles()
            } else {
                doConnectWithFallbacks(listOf(config.connectUrl))
            }
        }
        networkMonitor = NetworkReconnectMonitor(application).also { it.start() }
    }

    fun connect(config: PairedServerConfig) {
        reconnectJob?.cancel()
        handshakeTimeoutJob?.cancel()
        ws?.cancel()
        currentUrl = config.connectUrl
        currentToken = config.token
        currentCertFingerprint = config.certFingerprint
        reconnectAttempts = 0
        _reconnectExhausted.value = false
        val allUrls = listOf(config.connectUrl) + config.fallbackConnectUrls()
        doConnectWithFallbacks(allUrls)
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

    // Race all candidate URLs in parallel; the first to open wins and the others are cancelled.
    // Falls back to the single-URL path when there is only one candidate.
    private fun doConnectWithFallbacks(urls: List<String>) {
        if (urls.size <= 1) {
            doConnect(urls.firstOrNull() ?: return)
            return
        }
        _connectionState.value = ConnectionState.CONNECTING
        val raceScope = CoroutineScope(Dispatchers.IO)
        val winner = java.util.concurrent.atomic.AtomicBoolean(false)
        // Track losing WebSockets so we ignore their subsequent callbacks.
        val losers = mutableListOf<WebSocket>()
        val loserLock = Any()
        // Count failures so we only scheduleReconnect once after all candidates fail.
        val failCount = java.util.concurrent.atomic.AtomicInteger(0)
        val candidateCount = urls.size

        for (wsUrl in urls) {
            val request = runCatching { Request.Builder().url(wsUrl).build() }.getOrNull() ?: run {
                if (failCount.incrementAndGet() == candidateCount && !winner.get()) {
                    _connectionState.value = ConnectionState.DISCONNECTED
                    scheduleReconnect()
                }
                continue
            }
            val fp = currentCertFingerprint
            val activeClient = fp?.takeIf { it.isNotBlank() }?.let { buildPinnedClient(it) } ?: client
            activeClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (!winner.compareAndSet(false, true)) {
                        // Another URL won the race — close this connection immediately.
                        synchronized(loserLock) { losers.add(webSocket) }
                        webSocket.cancel()
                        return
                    }
                    raceScope.cancel()
                    // Update currentUrl to the winning URL so reconnects reuse it.
                    currentUrl = wsUrl
                    onWsOpen(webSocket)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    synchronized(loserLock) { if (losers.contains(webSocket)) return }
                    onWsMessage(text)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    synchronized(loserLock) { if (losers.contains(webSocket)) return }
                    _lastError.value = t.message
                    if (!winner.get() && failCount.incrementAndGet() == candidateCount) {
                        _connectionState.value = ConnectionState.DISCONNECTED
                        scheduleReconnect()
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    synchronized(loserLock) { if (losers.contains(webSocket)) return }
                    if (!winner.get()) return
                    _connectionState.value = ConnectionState.DISCONNECTED
                    val intentional = _intentionalRestartExpected.compareAndSet(expect = true, update = false)
                    if ((code != 4001 && code != 4002) || intentional) scheduleReconnect()
                }
            })
        }
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
            override fun onOpen(webSocket: WebSocket, response: Response) = onWsOpen(webSocket)
            override fun onMessage(webSocket: WebSocket, text: String) = onWsMessage(text)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _lastError.value = t.message
                _connectionState.value = ConnectionState.DISCONNECTED
                scheduleReconnect()
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _connectionState.value = ConnectionState.DISCONNECTED
                val intentional = _intentionalRestartExpected.compareAndSet(expect = true, update = false)
                if ((code != 4001 && code != 4002) || intentional) scheduleReconnect()
            }
        })
        return true
    }

    private fun onWsOpen(webSocket: WebSocket) {
        ws = webSocket
        reconnectAttempts = 0
        _reconnectExhausted.value = false
        _connectionState.value = ConnectionState.CONNECTED
        _lastError.value = null
        _serverVersion.value = null
        val endpoint = currentUrl?.substringBefore("?token=")
        val token = currentToken
        if (!endpoint.isNullOrBlank() && !token.isNullOrBlank()) {
            pairedServerStore?.save(PairedServerConfig(endpoint, token, currentCertFingerprint))
            refreshProfiles()
        }
        synchronized(pendingCommands) {
            pendingCommands.forEach { (cmd, data) -> send(cmd, data) }
            pendingCommands.clear()
        }
        // If the desktop doesn't send the "connected" event within 15s, treat it as a failure.
        handshakeTimeoutJob?.cancel()
        handshakeTimeoutJob = scope.launch {
            var elapsed = 0
            while (_serverVersion.value == null && elapsed < 15_000) {
                delay(500L)
                elapsed += 500
            }
            if (_serverVersion.value == null) {
                _lastError.value = "Desktop did not respond — check that Nexy is open and on the same network."
                webSocket.cancel()
                _connectionState.value = ConnectionState.DISCONNECTED
                scheduleReconnect()
            }
        }
    }

    private fun onWsMessage(text: String) {
        parseWsEvent(
            text = text,
            scope = scope,
            events = _events,
            serverVersion = _serverVersion,
            conversations = _conversations,
            projects = _projects,
            agents = _agents,
            agentFullConfig = agentFullConfig,
            models = _models,
            modelSource = _modelSource,
            androidUpdateManifest = _androidUpdateManifest,
            errorReports = _errorReports,
            providers = _providers,
            mcpServers = _mcpServers,
            skills = _skills,
            skillAgentUsage = _skillAgentUsage,
            artifacts = _artifacts,
            wikiEntries = _wikiEntries,
            promptEntries = _promptEntries,
            cliStatus = _cliStatus,
            scheduledTasks = _scheduledTasks,
            scheduledRuns = _scheduledRuns,
            currentDebrief = _currentDebrief,
            completedConversationIds = _completedConversationIds,
            pairedServerStore = pairedServerStore,
        )
    }

    private fun scheduleReconnect() {
        val url = currentUrl ?: return
        if (currentToken == null) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val delayMs = reconnectDelayMs(reconnectAttempts)
            val isPolling = reconnectAttempts >= BACKOFF_DELAYS.size
            if (isPolling) {
                _connectionState.value = ConnectionState.POLLING
            }
            delay(delayMs)
            reconnectAttempts++

            // In slow-polling mode try mDNS first; if we find the service and
            // the token matches, use that URL — it may have a different IP.
            if (isPolling) {
                val appCtx = app
                val token = currentToken
                if (appCtx != null && !token.isNullOrBlank()) {
                    val mdns = MdnsDiscovery(appCtx)
                    mdns.startDiscovery()
                    delay(3_000L)
                    val hit = mdns.discovered.value.firstOrNull { it.token == token }
                    mdns.stopDiscovery()
                    if (hit != null) {
                        val mdnsUrl = "wss://${hit.host}:${hit.port}?token=${hit.token}"
                        doConnect(mdnsUrl)
                        return@launch
                    }
                }
            }

            doConnect(url)
        }
    }

    // Called by NetworkReconnectMonitor when a new network interface becomes available
    // (e.g. WireGuard VPN comes up, Wi-Fi switches). If we're not already connected,
    // cancel any pending retry and attempt immediately.
    fun onNetworkAvailable() {
        if (currentUrl == null || currentToken == null) return
        val state = _connectionState.value
        if (state == ConnectionState.CONNECTED) return
        // Reset backoff so the retry is immediate (1 s) rather than waiting 60 s.
        reconnectAttempts = 0
        _reconnectExhausted.value = false
        reconnectJob?.cancel()
        ws?.cancel()
        _connectionState.value = ConnectionState.DISCONNECTED
        scheduleReconnect()
    }

    private val BACKOFF_DELAYS = longArrayOf(1_000, 2_000, 4_000, 8_000, 16_000, 30_000)
    private const val POLLING_DELAY_MS = 60_000L

    private fun reconnectDelayMs(attempt: Int): Long =
        if (attempt < BACKOFF_DELAYS.size) BACKOFF_DELAYS[attempt] else POLLING_DELAY_MS

    fun disconnect() {
        reconnectJob?.cancel()
        handshakeTimeoutJob?.cancel()
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
        _providers.value = emptyList()
        _mcpServers.value = emptyList()
        _skills.value = emptyList()
        _skillAgentUsage.value = emptyMap()
        _artifacts.value = emptyList()
        _wikiEntries.value = emptyList()
        _promptEntries.value = emptyList()
        _cliStatus.value = emptyMap()
        _scheduledTasks.value = emptyList()
        _scheduledRuns.value = emptyMap()
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

    fun wakeDesktop() {
        val profile = pairedServerStore?.activeProfile() ?: return
        val mac = profile.macAddress ?: return
        val broadcast = profile.broadcastAddress ?: return
        scope.launch {
            runCatching { WakeOnLanHelper.sendMagicPacket(mac, broadcast) }
            reconnectAttempts = 0
            _reconnectExhausted.value = false
            _lastError.value = null
            connect(profile.toConfig())
        }
    }

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

    fun sendLog(tag: String, message: String) {
        runCatching { android.util.Log.d("NexyDebug[$tag]", message) }
        val entry = DebugLogEntry(tag = tag, message = message, ts = System.currentTimeMillis())
        val current = _debugLog.value
        _debugLog.value = if (current.size >= 500) current.drop(1) + entry else current + entry
        send("android:log", mapOf("tag" to tag, "message" to message, "ts" to entry.ts))
    }

    fun appendDebugLog(tag: String, message: String) {
        runCatching { android.util.Log.d("NexyDebug[$tag]", message) }
        val entry = DebugLogEntry(tag = tag, message = message, ts = System.currentTimeMillis())
        val current = _debugLog.value
        _debugLog.value = if (current.size >= 500) current.drop(1) + entry else current + entry
    }

    fun clearDebugLog() { _debugLog.value = emptyList() }

    fun listConversations() { send("conversation:list", emptyMap()) }
    fun renameConversation(id: String, title: String) { send("conversation:rename", mapOf("id" to id, "title" to title)) }
    fun deleteConversation(id: String) { send("conversation:delete", mapOf("id" to id)) }
    fun clearConversationSnapshot(conversationId: String) {
        _activeChatSnapshots.value = _activeChatSnapshots.value - conversationId
    }
    /** For testing only: seed repository state as if a ChatActivity event had been received. */
    fun seedActiveConversationForTest(conversationId: String, snapshot: ActiveChatSnapshot) {
        _activeConversationIds.value = _activeConversationIds.value + conversationId
        _activeChatSnapshots.value = _activeChatSnapshots.value + (conversationId to snapshot)
    }
    fun clearConversationActiveState(conversationId: String) {
        _activeConversationIds.value = _activeConversationIds.value - conversationId
        _pendingConversationIds.value = _pendingConversationIds.value - conversationId
        _activeChatSnapshots.value = _activeChatSnapshots.value - conversationId
    }
    fun searchConversations(query: String) { send("conversation:search", mapOf("query" to query)) }
    fun setPinnedConversation(id: String, pinned: Boolean) {
        // Optimistic update so the pin icon and sort order reflect immediately,
        // before the desktop echoes conversation:pinned back.
        _conversations.value = _conversations.value.map { if (it.id == id) it.copy(pinned = pinned) else it }
        send("conversation:set-pinned", mapOf("id" to id, "pinned" to pinned))
    }
    fun updateConversationContext(conversationId: String, projectId: String?, agentId: String?) {
        val m = mutableMapOf<String, Any>("conversationId" to conversationId)
        if (projectId != null) m["projectId"] = projectId else m["projectId"] = ""
        if (agentId != null) m["agentId"] = agentId else m["agentId"] = ""
        send("conversation:update-context", m)
    }
    fun insertMessage(conversationId: String, role: String, content: String) {
        send("conversation:insert-message", mapOf("conversationId" to conversationId, "role" to role, "content" to content))
    }
    fun deleteMessagesAfter(conversationId: String, timestamp: Long) {
        send("message:delete-after", mapOf("conversationId" to conversationId, "timestamp" to timestamp))
    }
    fun getCompressionPreview(conversationId: String) { send("conversation:compression-preview", mapOf("conversationId" to conversationId)) }
    fun prepareCompressionSummary(conversationId: String) { send("conversation:prepare-compression-summary", mapOf("conversationId" to conversationId)) }
    fun saveCompressionSummary(conversationId: String, draft: Map<String, Any>) {
        send("conversation:save-compression-summary", mapOf("conversationId" to conversationId) + draft)
    }
    fun deleteMessage(id: String) { send("message:delete", mapOf("id" to id)) }
    fun refreshReports() {
        sendLog("RemoteEdit", "refreshReports: sending self-heal:get-reports")
        send("self-heal:get-reports", emptyMap())
    }
    fun createRemoteEditReport(title: String, description: String) {
        sendLog("RemoteEdit", "createRemoteEditReport: title=$title")
        send("error-report:request-capture", mapOf("title" to title, "description" to description, "includeLog" to true))
    }
    fun startRemoteEditInvestigation(reportId: String) {
        sendLog("RemoteEdit", "startRemoteEditInvestigation: reportId=$reportId")
        send("self-heal:start-investigation", mapOf("reportId" to reportId))
    }
    fun startRemoteEditFix(reportId: String) {
        sendLog("RemoteEdit", "startRemoteEditFix: reportId=$reportId")
        send("self-heal:start-fix", mapOf("reportId" to reportId))
    }
    fun listStagedFiles(reportId: String) {
        send("self-heal:list-staged-files", mapOf("reportId" to reportId))
    }
    fun getStagedDiff(reportId: String, relativePath: String) {
        send("self-heal:get-staged-diff", mapOf("reportId" to reportId, "relativePath" to relativePath))
    }
    fun remoteEditGitCommit(reportId: String, message: String) {
        send("self-heal:git-commit", mapOf("reportId" to reportId, "message" to message))
    }
    fun createProject(name: String, color: String) { send("project:create", mapOf("name" to name, "color" to color)) }
    fun renameProject(id: String, name: String) { send("project:rename", mapOf("id" to id, "name" to name)) }
    fun deleteProject(id: String) { send("project:delete", mapOf("id" to id)) }
    fun createAgent(name: String, icon: String) { send("agent:create", mapOf("name" to name, "icon" to icon)) }
    fun updateAgent(id: String, name: String, icon: String) { send("agent:update", mapOf("id" to id, "name" to name, "icon" to icon)) }
    fun deleteAgent(id: String) { send("agent:delete", mapOf("id" to id)) }
    fun requestAgentFull(id: String) { send("agent:get-full", mapOf("id" to id)) }
    fun getProviders() { send("provider:get-configured", emptyMap()) }
    fun setProviderKey(provider: String, key: String) { send("provider:set-key", mapOf("provider" to provider, "key" to key)) }
    fun removeProviderKey(provider: String) { send("provider:remove-key", mapOf("provider" to provider)) }
    fun getCliStatus() { send("app:cli-status", emptyMap()) }
    fun getSetting(key: String) { send("app:get-setting", mapOf("key" to key)) }
    fun setSetting(key: String, value: String) { send("app:set-setting", mapOf("key" to key, "value" to value)) }
    fun getMcpServers() { send("mcp:list", emptyMap()) }
    private fun skillPayload(
        name: String,
        icon: String,
        description: String,
        instructions: String,
        tags: List<String>,
        tools: Map<String, Any>,
        mcpServers: List<String>,
        mcpServerTrust: List<Map<String, String>>,
        mcpToolOverrides: List<Map<String, Any>>,
        knowledge: List<Map<String, String>>,
    ): Map<String, Any> =
        mapOf(
            "name" to name,
            "icon" to icon,
            "description" to description,
            "instructions" to instructions,
            "tags" to tags,
            "tools" to tools,
            "mcpServers" to mcpServers,
            "mcpServerTrust" to mcpServerTrust,
            "mcpToolOverrides" to mcpToolOverrides,
            "knowledge" to knowledge,
        )
    fun listSkills() { send("skill:list", emptyMap()) }
    fun getSkill(id: String) { send("skill:get", mapOf("id" to id)) }
    fun createSkill(
        name: String,
        icon: String,
        description: String,
        instructions: String,
        tags: List<String>,
        tools: Map<String, Any>,
        mcpServers: List<String>,
        mcpServerTrust: List<Map<String, String>>,
        mcpToolOverrides: List<Map<String, Any>>,
        knowledge: List<Map<String, String>>,
    ) {
        send("skill:create", skillPayload(name, icon, description, instructions, tags, tools, mcpServers, mcpServerTrust, mcpToolOverrides, knowledge))
    }
    fun updateSkill(
        id: String,
        name: String,
        icon: String,
        description: String,
        instructions: String,
        tags: List<String>,
        tools: Map<String, Any>,
        mcpServers: List<String>,
        mcpServerTrust: List<Map<String, String>>,
        mcpToolOverrides: List<Map<String, Any>>,
        knowledge: List<Map<String, String>>,
    ) {
        val data = skillPayload(name, icon, description, instructions, tags, tools, mcpServers, mcpServerTrust, mcpToolOverrides, knowledge).toMutableMap()
        data["id"] = id
        send("skill:update", data)
    }
    fun deleteSkill(id: String) { send("skill:delete", mapOf("id" to id)) }
    fun duplicateSkill(id: String) { send("skill:duplicate", mapOf("id" to id)) }
    fun exportSkill(id: String) { send("skill:export", mapOf("id" to id)) }
    fun importSkill(skill: Map<String, Any>) { send("skill:import", mapOf("skill" to skill)) }
    fun getSkillAgentLinks(agentId: String) { send("skill:get-agent-links", mapOf("agentId" to agentId)) }
    fun attachSkillToAgent(agentId: String, skillId: String, attach: Boolean) {
        send("skill:attach-to-agent", mapOf("agentId" to agentId, "skillId" to skillId, "attach" to attach))
    }
    fun reorderSkillsForAgent(agentId: String, skillIds: List<String>) {
        send("skill:reorder-for-agent", mapOf("agentId" to agentId, "skillIds" to skillIds))
    }
    fun getSkillAgentUsage() { send("skill:get-agent-usage", emptyMap()) }
    fun listArtifacts(projectId: String? = null) {
        send("artifact:list", if (projectId != null) mapOf("projectId" to projectId) else emptyMap())
    }
    fun getArtifact(id: String) { send("artifact:get", mapOf("id" to id)) }
    fun listArtifactVersions(artifactId: String) { send("artifact:list-versions", mapOf("artifactId" to artifactId)) }
    fun deleteArtifact(id: String) { send("artifact:delete", mapOf("id" to id)) }
    fun exportArtifact(versionId: String) { send("artifact:export", mapOf("versionId" to versionId)) }

    fun getProjectConfig(id: String) { send("project:get-config", mapOf("id" to id)) }
    fun updateProjectConfig(id: String, config: ProjectSettingsConfig) {
        send("project:update-config", buildProjectConfigPayload(id, config))
    }

    fun listProjectAgents(projectId: String) { send("project:list-agents", mapOf("id" to projectId)) }
    fun addProjectAgent(projectId: String, agentId: String) { send("project:add-agent", mapOf("id" to projectId, "agentId" to agentId)) }
    fun removeProjectAgent(projectId: String, agentId: String) { send("project:remove-agent", mapOf("id" to projectId, "agentId" to agentId)) }
    fun setPrimaryProjectAgent(projectId: String, agentId: String) { send("project:set-primary-agent", mapOf("id" to projectId, "agentId" to agentId)) }
    fun reorderProjectAgents(projectId: String, agentIds: List<String>) {
        send("project:reorder-agents", mapOf("id" to projectId, "agentIds" to agentIds))
    }
    fun listProjectAuditSessions(projectId: String) { send("project-audit:list-sessions", mapOf("projectId" to projectId)) }
    fun listProjectAuditFiles(sessionId: String) { send("project-audit:list-files", mapOf("sessionId" to sessionId)) }
    fun getProjectAuditDiff(sessionId: String, relativePath: String) {
        send("project-audit:get-diff", mapOf("sessionId" to sessionId, "relativePath" to relativePath))
    }

    fun listWikiEntries(projectId: String) { send("wiki:list", mapOf("projectId" to projectId)) }
    fun createWikiEntry(projectId: String, title: String, body: String, tags: List<String>) {
        send("wiki:create", mapOf("projectId" to projectId, "title" to title, "body" to body, "tags" to tags))
    }
    fun updateWikiEntry(id: String, title: String, body: String, tags: List<String>) {
        send("wiki:update", mapOf("id" to id, "title" to title, "body" to body, "tags" to tags))
    }
    fun deleteWikiEntry(id: String) { send("wiki:delete", mapOf("id" to id)) }

    fun listPrompts(projectId: String? = null) {
        send("prompt:list", if (projectId != null) mapOf("projectId" to projectId) else emptyMap())
    }
    fun createPrompt(title: String, body: String, description: String, category: String, tags: List<String>, scope: String, projectId: String?) {
        val data = mutableMapOf<String, Any>("title" to title, "body" to body, "description" to description, "category" to category, "tags" to tags, "scope" to scope)
        if (projectId != null) data["projectId"] = projectId
        send("prompt:create", data)
    }
    fun updatePrompt(id: String, title: String, body: String, description: String, category: String, tags: List<String>) {
        send("prompt:update", mapOf("id" to id, "title" to title, "body" to body, "description" to description, "category" to category, "tags" to tags))
    }
    fun listPromptVersions(promptId: String) { send("prompt:list-versions", mapOf("promptId" to promptId)) }
    fun rollbackPrompt(promptId: String, version: Int) {
        send("prompt:rollback", mapOf("promptId" to promptId, "version" to version))
    }
    fun deletePrompt(id: String) { send("prompt:delete", mapOf("id" to id)) }

    fun startProjectGeneratorChat(sessionId: String, messages: List<Map<String, String>>) {
        send("project-generator:start", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun sendProjectGeneratorMessage(sessionId: String, messages: List<Map<String, String>>) {
        send("project-generator:message", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun confirmProjectSpec(sessionId: String, spec: io.nexy.android.data.model.ProjectGeneratorSpec) {
        val agentsList = spec.agents.map { a ->
            val m = mutableMapOf<String, Any>(
                "role" to a.role,
                "description" to a.description,
                "isLeader" to a.isLeader,
            )
            a.existingAgentId?.let { m["existingAgentId"] = it }
            if (a.existingAgentId == null) {
                val newAgent = a.newAgent
                m["newAgent"] = mapOf(
                    "name" to (newAgent?.name ?: a.role),
                    "icon" to (newAgent?.icon ?: ""),
                    "systemPrompt" to (newAgent?.systemPrompt ?: ""),
                    "temperature" to (newAgent?.temperature ?: 0.7),
                    "responseFormat" to (newAgent?.responseFormat ?: "default"),
                    "tools" to mapOf(
                        "fileEdit" to (newAgent?.tools?.fileEdit ?: false),
                        "terminal" to (newAgent?.tools?.terminal ?: false),
                        "webFetch" to (newAgent?.tools?.webFetch ?: false),
                    ),
                )
            }
            m
        }
        val specPayload = mutableMapOf<String, Any>(
            "name" to spec.name,
            "color" to spec.color,
            "instructions" to spec.instructions,
            "variables" to spec.variables,
            "inScope" to spec.inScope,
            "outOfScope" to spec.outOfScope,
            "milestones" to spec.milestones,
            "orchestrationEnabled" to spec.orchestrationEnabled,
            "agents" to agentsList,
        )
        spec.rootDirectory?.let { specPayload["rootDirectory"] = it }
        spec.instructionMode?.let { specPayload["instructionMode"] = it }
        spec.defaultModel?.let { specPayload["defaultModel"] = it }
        send("project-generator:confirm", mapOf(
            "sessionId" to sessionId,
            "spec" to specPayload,
        ))
    }
    fun cancelProjectGenerator(sessionId: String) { send("project-generator:cancel", mapOf("sessionId" to sessionId)) }

    fun startSkillGeneratorChat(sessionId: String, messages: List<Map<String, String>>) {
        send("skill-generator:start", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun sendSkillGeneratorMessage(sessionId: String, messages: List<Map<String, String>>) {
        send("skill-generator:message", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun confirmSkillSpec(sessionId: String, spec: io.nexy.android.data.model.SkillGeneratorSpec) {
        val specPayload = mutableMapOf<String, Any>(
            "name" to spec.name,
            "icon" to spec.icon,
            "description" to spec.description,
            "instructions" to spec.instructions,
            "tools" to mapOf("fileEdit" to spec.tools.fileEdit, "terminal" to spec.tools.terminal, "webFetch" to spec.tools.webFetch),
            "toolInstructions" to spec.toolInstructions,
            "approval" to spec.approval,
            "mcpServers" to spec.mcpServers,
            "tags" to spec.tags,
            "knowledge" to spec.knowledge.map { mapOf("title" to it.title, "content" to it.content) },
            "suggestedAgents" to spec.suggestedAgents,
        )
        send("skill-generator:confirm", mapOf("sessionId" to sessionId, "spec" to specPayload))
    }
    fun cancelSkillGenerator(sessionId: String) { send("skill-generator:cancel", mapOf("sessionId" to sessionId)) }

    fun startArtifactGeneratorChat(sessionId: String, messages: List<Map<String, String>>) {
        send("artifact-generator:start", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun sendArtifactGeneratorMessage(sessionId: String, messages: List<Map<String, String>>) {
        send("artifact-generator:message", mapOf("sessionId" to sessionId, "messages" to messages))
    }
    fun generateArtifact(sessionId: String, spec: ArtifactGeneratorSpec) {
        send("artifact-generator:generate", mapOf("sessionId" to sessionId, "spec" to spec.toPayload()))
    }
    fun cancelArtifactGenerator(sessionId: String) { send("artifact-generator:cancel", mapOf("sessionId" to sessionId)) }

    fun getAzureEndpoint() { send("provider:get-azure-endpoint", emptyMap()) }
    fun setAzureEndpoint(endpoint: String) { send("provider:set-azure-endpoint", mapOf("endpoint" to endpoint)) }
    fun testProviderKey(provider: String, key: String, endpoint: String? = null) {
        val data = mutableMapOf<String, Any>("provider" to provider, "key" to key)
        if (endpoint != null) data["endpoint"] = endpoint
        send("provider:test-key", data)
    }

    fun exportConversationPack(conversationId: String, format: String = "json") {
        send("conversation:export-pack", mapOf("conversationId" to conversationId, "format" to format))
    }
    fun forkConversation(conversationId: String, cutoffTimestamp: Long? = null) {
        val data = mutableMapOf<String, Any>("conversationId" to conversationId)
        if (cutoffTimestamp != null) data["cutoffTimestamp"] = cutoffTimestamp
        send("conversation:fork", data)
    }
    fun importConversationJson(json: String) { send("conversation:import-json", mapOf("json" to json)) }

    fun listKnowledgeFiles(agentId: String) { send("agent:list-knowledge-files", mapOf("agentId" to agentId)) }
    fun addKnowledgeFile(agentId: String, filePath: String, injectMode: String = "always") {
        send("agent:add-knowledge-file", mapOf("agentId" to agentId, "filePath" to filePath, "injectMode" to injectMode))
    }
    fun removeKnowledgeFile(agentId: String, id: String) {
        send("agent:remove-knowledge-file", mapOf("agentId" to agentId, "id" to id))
    }
    fun readKnowledgeFile(agentId: String, filePath: String) {
        send("agent:read-knowledge-file", mapOf("agentId" to agentId, "filePath" to filePath))
    }
    fun writeKnowledgeFile(agentId: String, filePath: String, content: String) {
        send("agent:write-knowledge-file", mapOf("agentId" to agentId, "filePath" to filePath, "content" to content))
    }
    fun getMcpToolOverrides(agentId: String) { send("agent:get-mcp-tool-overrides", mapOf("agentId" to agentId)) }
    fun setMcpToolOverride(agentId: String, serverId: String, toolName: String, enabled: Boolean, approval: String, instructions: String) {
        send("agent:set-mcp-tool-override", mapOf(
            "agentId" to agentId,
            "serverId" to serverId,
            "toolName" to toolName,
            "enabled" to enabled,
            "approval" to approval,
            "instructions" to instructions,
        ))
    }
    fun getMcpServerTrust(agentId: String) { send("agent:get-mcp-server-trust", mapOf("agentId" to agentId)) }
    fun setMcpServerTrust(agentId: String, serverId: String, trust: String) {
        send("agent:set-mcp-server-trust", mapOf("agentId" to agentId, "serverId" to serverId, "trust" to trust))
    }

    fun addMcpServer(name: String, command: String, args: List<String> = emptyList(), env: Map<String, String> = emptyMap(), cwd: String? = null, enabled: Boolean = true) {
        val payload = mutableMapOf<String, Any>("name" to name, "command" to command, "args" to args, "env" to env, "enabled" to enabled)
        if (cwd != null) payload["cwd"] = cwd
        send("mcp:add", payload)
    }
    fun updateMcpServer(id: String, name: String? = null, command: String? = null, args: List<String>? = null, env: Map<String, String>? = null, cwd: String? = null, enabled: Boolean? = null) {
        val payload = mutableMapOf<String, Any>("id" to id)
        if (name != null) payload["name"] = name
        if (command != null) payload["command"] = command
        if (args != null) payload["args"] = args
        if (env != null) payload["env"] = env
        if (cwd != null) payload["cwd"] = cwd
        if (enabled != null) payload["enabled"] = enabled
        send("mcp:update", payload)
    }
    fun removeMcpServer(id: String) { send("mcp:remove", mapOf("id" to id)) }
    fun restartMcpServer(id: String) { send("mcp:restart", mapOf("id" to id)) }
    fun getMcpServerStatus(id: String) { send("mcp:get-status", mapOf("id" to id)) }
    fun listMcpTools(serverIds: List<String>? = null) {
        val payload: Map<String, Any> = if (serverIds != null) mapOf("serverIds" to serverIds) else emptyMap()
        send("mcp:list-tools", payload)
    }
    fun listMcpToolsForAgent(agentId: String) { send("mcp:list-tools-for-agent", mapOf("agentId" to agentId)) }
    fun extractWikiFromConversation(conversationId: String, projectId: String) {
        send("wiki:extract-from-conversation", mapOf("conversationId" to conversationId, "projectId" to projectId))
    }

    val buildRecords = MutableStateFlow<List<io.nexy.android.data.model.BuildRecord>>(emptyList())

    fun getBuildRecords(platform: String? = null, limit: Int = 20) {
        val payload = mutableMapOf<String, Any>("limit" to limit)
        if (platform != null) payload["platform"] = platform
        send("build:get-records", payload)
    }
    fun getBuildWorkspaceInfo() { send("build:get-workspace-info", emptyMap()) }
    fun runBuildPreflight() { send("build:run-preflight", emptyMap()) }
    fun startDesktopBuild(command: String) { send("build:start-from-mobile", mapOf("command" to command)) }
    fun cancelDesktopBuild(buildId: String) { send("build:cancel-from-mobile", mapOf("buildId" to buildId)) }
    fun startUpdateFromArtifact() { send("build:update-from-artifact", emptyMap()) }
    fun getAndroidWorkspaceInfo() { send("android:get-workspace-info", emptyMap()) }
    fun validateAndroidSigning() { send("android:validate-signing", emptyMap()) }
    fun publishAndroidUpdate() { send("android:publish-update", emptyMap()) }
    fun restoreAndroidVersion(versionCode: Int) { send("android:restore-version", mapOf("versionCode" to versionCode)) }

    fun cancelApprovalNotification() {
        app?.getSystemService(NotificationManager::class.java)
            ?.cancel(ApprovalNotificationManager.NOTIFICATION_ID)
    }

    // ─── Scheduler ─────────────────────────────────────────────────────────────

    fun schedulerList() { send("scheduler:list", emptyMap()) }
    fun schedulerGet(taskId: String) { send("scheduler:get", mapOf("id" to taskId)) }
    fun schedulerCreate(input: Map<String, Any?>) { send("scheduler:create", input.filterValues { it != null }.mapValues { it.value!! }) }
    fun schedulerUpdate(taskId: String, input: Map<String, Any?>) { send("scheduler:update", mapOf("id" to taskId, "input" to input.filterValues { it != null }.mapValues { it.value!! })) }
    fun schedulerDelete(taskId: String) { send("scheduler:delete", mapOf("id" to taskId)) }
    fun schedulerSetEnabled(taskId: String, enabled: Boolean) { send("scheduler:set-enabled", mapOf("id" to taskId, "enabled" to enabled)) }
    fun schedulerRunNow(taskId: String) { send("scheduler:run-now", mapOf("id" to taskId)) }
    fun schedulerListRuns(taskId: String, limit: Int = 50) { send("scheduler:list-runs", mapOf("taskId" to taskId, "limit" to limit)) }
    fun schedulerGeneratorStart(sessionId: String, messages: List<Map<String, String>>, modelId: String? = null) {
        val data = mutableMapOf<String, Any>("sessionId" to sessionId, "messages" to messages)
        if (modelId != null) data["model"] = modelId
        send("scheduler-generator:start", data)
    }
    fun schedulerGeneratorMessage(sessionId: String, messages: List<Map<String, String>>, modelId: String? = null) {
        val data = mutableMapOf<String, Any>("sessionId" to sessionId, "messages" to messages)
        if (modelId != null) data["model"] = modelId
        send("scheduler-generator:message", data)
    }
    fun schedulerGeneratorConfirm(sessionId: String, spec: ScheduleGeneratorSpec) {
        send("scheduler-generator:confirm", mapOf("sessionId" to sessionId, "spec" to spec.toPayload()))
    }
    fun schedulerGeneratorCancel(sessionId: String) { send("scheduler-generator:cancel", mapOf("sessionId" to sessionId)) }
    fun schedulerGeneratorGetModel(sessionId: String) { send("scheduler-generator:get-model", mapOf("sessionId" to sessionId)) }
    fun schedulerGeneratorSetModel(sessionId: String, modelId: String) {
        send("scheduler-generator:set-model", mapOf("sessionId" to sessionId, "modelId" to modelId))
    }

    // ─── Debrief ────────────────────────────────────────────────────────────────

    fun generateDebrief(conversationId: String, projectId: String? = null) {
        send("conversation:generate-debrief", buildMap {
            put("conversationId", conversationId)
            if (projectId != null) put("projectId", projectId)
        })
    }
    fun getDebrief(conversationId: String) { send("conversation:get-debrief", mapOf("conversationId" to conversationId)) }
    fun markConversationComplete(conversationId: String) { send("conversation:mark-complete", mapOf("conversationId" to conversationId)) }
    fun markConversationIncomplete(conversationId: String) { send("conversation:mark-incomplete", mapOf("conversationId" to conversationId)) }

    // ─── Quiz ────────────────────────────────────────────────────────────────────

    fun generateQuiz(conversationId: String) { send("conversation:generate-quiz", mapOf("conversationId" to conversationId)) }
    fun saveQuizAttempt(conversationId: String, score: Int, total: Int) {
        send("conversation:save-quiz-attempt", mapOf("conversationId" to conversationId, "score" to score, "total" to total))
    }
    fun listQuizAttempts(conversationId: String) { send("conversation:list-quiz-attempts", mapOf("conversationId" to conversationId)) }
}

fun ScheduleGeneratorSpec.toPayload(): Map<String, Any> {
    val payload = mutableMapOf<String, Any>(
        "name" to name,
        "prompt" to prompt,
        "scheduleType" to scheduleType,
        "localTime" to localTime,
        "timezone" to timezone,
        "notificationPref" to notificationPref,
    )
    weekday?.let { payload["weekday"] = it }
    monthDay?.let { payload["monthDay"] = it }
    agentId?.let { payload["agentId"] = it }
    projectId?.let { payload["projectId"] = it }
    return payload
}
