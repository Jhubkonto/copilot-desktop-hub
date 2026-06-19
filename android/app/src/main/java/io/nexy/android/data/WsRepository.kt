package io.nexy.android.data

import android.app.Application
import android.app.NotificationManager
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.AgentFullConfig
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ArtifactSummary
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.ErrorReport
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.SkillConfig
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

    private val _providers = MutableStateFlow<List<ProviderInfo>>(emptyList())
    val providers: StateFlow<List<ProviderInfo>> = _providers

    private val _mcpServers = MutableStateFlow<List<McpServerInfo>>(emptyList())
    val mcpServers: StateFlow<List<McpServerInfo>> = _mcpServers

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

    private val _profiles = MutableStateFlow<List<PairedServerProfile>>(emptyList())
    val profiles: StateFlow<List<PairedServerProfile>> = _profiles

    private val _activeProfileId = MutableStateFlow<String?>(null)
    val activeProfileId: StateFlow<String?> = _activeProfileId

    private var ws: WebSocket? = null
    private var currentUrl: String? = null
    private var currentToken: String? = null
    private var currentCertFingerprint: String? = null
    private var reconnectJob: Job? = null
    private var handshakeTimeoutJob: Job? = null
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
        handshakeTimeoutJob?.cancel()
        ws?.cancel()
        currentUrl = config.connectUrl
        currentToken = config.token
        currentCertFingerprint = config.certFingerprint
        reconnectAttempts = 0
        _reconnectExhausted.value = false
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
                _reconnectExhausted.value = false
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
                // If the desktop doesn't send the "connected" event within 15s, treat it as a failure.
                handshakeTimeoutJob?.cancel()
                handshakeTimeoutJob = scope.launch {
                    // Wait up to 15s for serverVersion to be set (happens on "connected" event).
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

            override fun onMessage(webSocket: WebSocket, text: String) {
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
        if (reconnectAttempts >= maxReconnects) {
            _reconnectExhausted.value = true
            return
        }
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(3_000L)
            reconnectAttempts++
            doConnect(url)
        }
    }

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
    fun setPinnedConversation(id: String, pinned: Boolean) { send("conversation:set-pinned", mapOf("id" to id, "pinned" to pinned)) }
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
    fun refreshReports() { send("self-heal:get-reports", emptyMap()) }
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
    fun exportArtifact(versionId: String) { send("artifact:export", mapOf("versionId" to versionId)) }

    fun getProjectConfig(id: String) { send("project:get-config", mapOf("id" to id)) }
    fun updateProjectConfig(id: String, instructions: String, rootDirectory: String?, instructionMode: String, orchestrationEnabled: Boolean, defaultModel: String?) {
        val data = mutableMapOf<String, Any>(
            "id" to id,
            "instructions" to instructions,
            "instructionMode" to instructionMode,
            "orchestrationEnabled" to orchestrationEnabled,
        )
        rootDirectory?.let { data["rootDirectory"] = it }
        defaultModel?.let { data["defaultModel"] = it }
        send("project:update-config", data)
    }

    fun listProjectAgents(projectId: String) { send("project:list-agents", mapOf("id" to projectId)) }
    fun addProjectAgent(projectId: String, agentId: String) { send("project:add-agent", mapOf("id" to projectId, "agentId" to agentId)) }
    fun removeProjectAgent(projectId: String, agentId: String) { send("project:remove-agent", mapOf("id" to projectId, "agentId" to agentId)) }
    fun setPrimaryProjectAgent(projectId: String, agentId: String) { send("project:set-primary-agent", mapOf("id" to projectId, "agentId" to agentId)) }

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
    fun forkConversation(conversationId: String) { send("conversation:fork", mapOf("conversationId" to conversationId)) }
    fun importConversationJson(json: String) { send("conversation:import-json", mapOf("json" to json)) }

    fun cancelApprovalNotification() {
        app?.getSystemService(NotificationManager::class.java)
            ?.cancel(ApprovalNotificationManager.NOTIFICATION_ID)
    }
}
