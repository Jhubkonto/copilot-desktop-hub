package io.nexy.android.ui.home

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class HomeViewModel(
    app: Application,
    private val wsClient: WsClient,
    private val approvalEffects: ApprovalEffects,
) : AndroidViewModel(app) {

    constructor(app: Application) : this(app, WsRepository, AndroidApprovalEffects(app))

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState
    val conversations: StateFlow<List<Conversation>> = WsRepository.conversations
    val agents: StateFlow<List<Agent>> = WsRepository.agents
    val projects: StateFlow<List<Project>> = WsRepository.projects

    private val _pendingApproval = MutableStateFlow<WsEvent.ToolApprovalRequest?>(null)
    val pendingApproval: StateFlow<WsEvent.ToolApprovalRequest?> = _pendingApproval

    private val _isRefreshingConversations = MutableStateFlow(false)
    val isRefreshingConversations: StateFlow<Boolean> = _isRefreshingConversations

    private val _isRefreshingAgents = MutableStateFlow(false)
    val isRefreshingAgents: StateFlow<Boolean> = _isRefreshingAgents

    private val _isRefreshingProjects = MutableStateFlow(false)
    val isRefreshingProjects: StateFlow<Boolean> = _isRefreshingProjects

    private val _newConversationId = MutableStateFlow<String?>(null)
    val newConversationId: StateFlow<String?> = _newConversationId

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _searchResults = MutableStateFlow<List<Conversation>?>(null)
    val searchResults: StateFlow<List<Conversation>?> = _searchResults.asStateFlow()

    init {
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when (event) {
                    is WsEvent.ToolApprovalRequest -> {
                        _pendingApproval.value = event
                        approvalEffects.showApproval(event)
                    }
                    is WsEvent.ConversationList -> _isRefreshingConversations.value = false
                    is WsEvent.AgentList -> _isRefreshingAgents.value = false
                    is WsEvent.ProjectList -> _isRefreshingProjects.value = false
                    is WsEvent.ConversationCreated -> _newConversationId.value = event.id
                    is WsEvent.ConversationSearchResults -> _searchResults.value = event.conversations
                    else -> {}
                }
            }
        }
        refreshConversations()
    }

    fun refreshConversations() {
        _isRefreshingConversations.value = true
        wsClient.send("conversation:list", emptyMap())
    }

    fun requestAgents() {
        _isRefreshingAgents.value = true
        wsClient.send("agent:list", emptyMap())
    }

    fun requestProjects() {
        _isRefreshingProjects.value = true
        wsClient.send("project:list", emptyMap())
    }

    fun approveRequest(requestId: String) {
        wsClient.send("tool:approve", mapOf("requestId" to requestId))
        approvalEffects.vibrateDecision(approved = true)
        _pendingApproval.value = null
        approvalEffects.cancelApproval()
    }

    fun rejectRequest(requestId: String) {
        wsClient.send("tool:reject", mapOf("requestId" to requestId))
        approvalEffects.vibrateDecision(approved = false)
        _pendingApproval.value = null
        approvalEffects.cancelApproval()
    }

    fun clearNewConversation() {
        _newConversationId.value = null
    }

    fun setSearchQuery(q: String) {
        _searchQuery.value = q
        if (q.isBlank()) {
            _searchResults.value = null
        } else {
            WsRepository.searchConversations(q)
        }
    }

    fun renameConversation(id: String, title: String) = WsRepository.renameConversation(id, title)

    fun deleteConversation(id: String) = WsRepository.deleteConversation(id)

    fun disconnect() {
        WsRepository.disconnect()
    }
}
