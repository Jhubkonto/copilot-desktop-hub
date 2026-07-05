package io.nexy.android.data.repository

import io.nexy.android.data.local.ConflictEntity
import io.nexy.android.data.local.OutboxEntity
import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.Project
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.ThinkingBlock
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

enum class InternetState {
    UNKNOWN,
    AVAILABLE,
    UNAVAILABLE,
}

enum class DataFreshness {
    CURRENT,
    STALE,
    LOCAL_ONLY,
}

enum class ExecutionTarget {
    ANDROID,
    DESKTOP,
    UNAVAILABLE,
}

data class CapabilityState(
    val desktopConnected: Boolean = false,
    val internetState: InternetState = InternetState.UNKNOWN,
    val freshness: DataFreshness = DataFreshness.LOCAL_ONLY,
    val pendingChanges: Int = 0,
    val failedChanges: Int = 0,
    val conflicts: Int = 0,
    val lastSuccessfulSyncAt: Long? = null,
) {
    fun target(requiresDesktop: Boolean, requiresInternet: Boolean): ExecutionTarget = when {
        requiresDesktop && desktopConnected -> ExecutionTarget.DESKTOP
        requiresDesktop -> ExecutionTarget.UNAVAILABLE
        requiresInternet && internetState == InternetState.UNAVAILABLE -> ExecutionTarget.UNAVAILABLE
        else -> ExecutionTarget.ANDROID
    }
}

interface ConversationRepository {
    val conversations: StateFlow<List<Conversation>>
    suspend fun createConversation(title: String, agentId: String? = null, projectId: String? = null): Conversation
    suspend fun renameConversation(id: String, title: String)
    suspend fun setConversationPinned(id: String, pinned: Boolean)
    suspend fun archiveConversation(id: String)
    suspend fun deleteConversation(id: String)
    suspend fun searchConversations(query: String): List<Conversation>
}

interface MessageRepository {
    fun observe(conversationId: String): Flow<List<HistoryMessage>>
    suspend fun list(conversationId: String): List<HistoryMessage>
    suspend fun insertMessage(
        conversationId: String,
        role: String,
        content: String,
        timestamp: Long = System.currentTimeMillis(),
        partial: Boolean = false,
        attachments: List<AttachmentMeta> = emptyList(),
        thinkingBlocks: List<ThinkingBlock> = emptyList(),
    ): HistoryMessage
    suspend fun updateMessageContent(id: String, content: String, partial: Boolean = false, sendFailed: Boolean = false)
    suspend fun deleteMessage(id: String)
    suspend fun deleteMessagesAfter(conversationId: String, timestamp: Long)
}

interface AgentRepository {
    val agents: StateFlow<List<Agent>>
    suspend fun createAgent(name: String, icon: String): Agent
    suspend fun updateAgent(id: String, name: String, icon: String)
    suspend fun deleteAgent(id: String)
}

interface ProjectRepository {
    val projects: StateFlow<List<Project>>
    suspend fun createProject(name: String, color: String): Project
    suspend fun renameProject(id: String, name: String)
    suspend fun deleteProject(id: String)
}

interface SyncRepository {
    val outbox: StateFlow<List<OutboxEntity>>
    val conflicts: StateFlow<List<ConflictEntity>>
    val capabilities: StateFlow<CapabilityState>
    suspend fun pendingBatch(limit: Int = 100): List<OutboxEntity>
    suspend fun acknowledge(operationIds: List<String>)
    suspend fun markFailed(operationId: String, error: String)
    suspend fun resolveConflict(conflictId: String, resolution: String)
}
