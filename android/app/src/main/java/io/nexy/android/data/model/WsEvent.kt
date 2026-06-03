package io.nexy.android.data.model

sealed class WsEvent {
    data class Connected(val version: String) : WsEvent()
    data class ToolApprovalRequest(
        val requestId: String,
        val toolName: String,
        val args: Map<String, Any>,
    ) : WsEvent()
    data class ChatStreamChunk(val conversationId: String, val text: String) : WsEvent()
    data class ChatStreamEnd(val conversationId: String) : WsEvent()
    data class ConversationList(val conversations: List<Conversation>) : WsEvent()
    data class ConversationMessages(
        val conversationId: String,
        val messages: List<HistoryMessage>,
    ) : WsEvent()
    data class AgentList(val agents: List<Agent>) : WsEvent()
    data class ProjectList(val projects: List<Project>) : WsEvent()
    data class ConversationCreated(
        val id: String,
        val agentId: String?,
        val projectId: String?,
        val title: String,
    ) : WsEvent()
}

data class HistoryMessage(
    val id: String,
    val role: String,
    val content: String,
    val timestamp: Long,
)
