package io.nexy.android.ui.home

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.WsEvent
import io.nexy.android.notification.ApprovalNotificationManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class HomeViewModel(app: Application) : AndroidViewModel(app) {

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState
    val conversations: StateFlow<List<Conversation>> = WsRepository.conversations
    val agents: StateFlow<List<Agent>> = WsRepository.agents
    val projects: StateFlow<List<Project>> = WsRepository.projects

    private val _pendingApproval = MutableStateFlow<WsEvent.ToolApprovalRequest?>(null)
    val pendingApproval: StateFlow<WsEvent.ToolApprovalRequest?> = _pendingApproval

    private val _newConversationId = MutableStateFlow<String?>(null)
    val newConversationId: StateFlow<String?> = _newConversationId

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.ToolApprovalRequest -> {
                        _pendingApproval.value = event
                        ApprovalNotificationManager.show(getApplication(), event.requestId, event.toolName)
                    }
                    is WsEvent.ConversationCreated -> _newConversationId.value = event.id
                    else -> {}
                }
            }
        }
        refreshConversations()
    }

    fun refreshConversations() {
        WsRepository.send("conversation:list")
    }

    fun requestAgents() {
        WsRepository.send("agent:list")
    }

    fun requestProjects() {
        WsRepository.send("project:list")
    }

    fun createConversation(agentId: String? = null, projectId: String? = null) {
        val data = buildMap<String, Any> {
            if (agentId != null) put("agentId", agentId)
            if (projectId != null) put("projectId", projectId)
        }
        WsRepository.send("conversation:create", data)
    }

    fun clearNewConversation() {
        _newConversationId.value = null
    }

    fun approveRequest(requestId: String) {
        WsRepository.send("tool:approve", mapOf("requestId" to requestId))
        _pendingApproval.value = null
        WsRepository.cancelApprovalNotification()
    }

    fun rejectRequest(requestId: String) {
        WsRepository.send("tool:reject", mapOf("requestId" to requestId))
        _pendingApproval.value = null
        WsRepository.cancelApprovalNotification()
    }

    fun disconnect() {
        WsRepository.disconnect()
    }
}
