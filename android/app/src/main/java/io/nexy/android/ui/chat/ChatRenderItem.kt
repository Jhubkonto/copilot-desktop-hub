package io.nexy.android.ui.chat

import io.nexy.android.data.model.ThinkingBlock

sealed class ChatRenderItem {
    abstract val key: String

    data class UserMessage(
        val message: ChatMessage,
    ) : ChatRenderItem() {
        override val key: String get() = message.id.ifBlank { "user_${message.timestamp}" }
    }

    data class AssistantMessage(
        val message: ChatMessage,
        val liveThinkingBlocks: List<ThinkingBlock> = emptyList(),
    ) : ChatRenderItem() {
        override val key: String get() = message.id.ifBlank { "asst_${message.timestamp}" }
    }

    data class ToolCall(
        val message: ChatMessage,
        val listIndex: Int,
    ) : ChatRenderItem() {
        // Prefer the message's own stable id — both the live ChatToolCallEvent path and the
        // persisted HistoryMessage path now assign one — over listIndex, which is recomputed
        // fresh from scratch on every render as "position among tool-call messages currently
        // in the list" and so shifts (forcing a Compose remount) whenever a history-sync
        // reconciliation changes the count/order of tool calls ahead of this one. listIndex
        // stays only as a fallback for the rare case content arrives with a blank id.
        override val key: String get() = message.id.ifBlank { "tool_${message.toolName}_$listIndex" }
    }

    data class LiveThinking(
        val blocks: List<ThinkingBlock>,
    ) : ChatRenderItem() {
        override val key: String get() = "live_thinking"
    }

    data class LiveActivity(
        val activity: ChatTurnActivity,
        val generationStartedAt: Long?,
    ) : ChatRenderItem() {
        override val key: String get() = "live_activity"
    }

    data class ArtifactCard(
        val ref: ArtifactRef,
        val messageId: String,
    ) : ChatRenderItem() {
        override val key: String get() = "artifact_${messageId.ifBlank { ref.artifactId }}"
    }

    data class CodeChangeCard(
        val ref: CodeChangeRef,
        val messageId: String,
    ) : ChatRenderItem() {
        override val key: String get() = "code_change_${messageId.ifBlank { ref.reportId }}"
    }
}

fun buildChatRenderItems(
    messages: List<ChatMessage>,
    liveThinkingBlocks: List<ThinkingBlock>,
    isAwaitingResponse: Boolean,
    isStreaming: Boolean,
    activity: ChatTurnActivity?,
    generationStartedAt: Long?,
): List<ChatRenderItem> {
    val result = mutableListOf<ChatRenderItem>()
    val pendingToolCalls = mutableListOf<ChatMessage>()
    var toolCallListIdx = 0

    for (msg in messages) {
        if (msg.artifactRef != null) {
            result.add(ChatRenderItem.ArtifactCard(msg.artifactRef, msg.id))
        } else if (msg.codeChangeRef != null) {
            result.add(ChatRenderItem.CodeChangeCard(msg.codeChangeRef, msg.id))
        } else if (msg.isToolCall) {
            result.add(ChatRenderItem.ToolCall(msg, toolCallListIdx++))
        } else if (msg.isUser) {
            pendingToolCalls.clear()
            result.add(ChatRenderItem.UserMessage(msg))
        } else {
            // Assistant message — attach any preceding tool calls
            val committedBlockIds = msg.thinkingBlocks.map { it.blockId }.toSet()
            val visibleLiveThinking = if (msg.isStreaming && liveThinkingBlocks.isNotEmpty()) {
                liveThinkingBlocks.filter { it.blockId !in committedBlockIds }
            } else {
                emptyList()
            }
            result.add(ChatRenderItem.AssistantMessage(
                message = msg,
                liveThinkingBlocks = visibleLiveThinking,
            ))
            pendingToolCalls.clear()
        }
    }

    // Awaiting section: live thinking + activity bubble (only when not streaming text)
    if (isAwaitingResponse && !isStreaming) {
        if (liveThinkingBlocks.isNotEmpty()) {
            result.add(ChatRenderItem.LiveThinking(liveThinkingBlocks))
        }
        val fallbackActivity = ChatTurnActivity(state = "thinking", label = "Assistant is thinking")
        result.add(ChatRenderItem.LiveActivity(activity ?: fallbackActivity, generationStartedAt))
    }

    return result
}
