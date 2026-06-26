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
        override val key: String get() = "tool_${message.toolName}_$listIndex"
    }

    data class LiveThinking(
        val blocks: List<ThinkingBlock>,
    ) : ChatRenderItem() {
        override val key: String get() = "live_thinking"
    }

    data class LiveActivity(
        val label: String,
        val generationStartedAt: Long?,
    ) : ChatRenderItem() {
        override val key: String get() = "live_activity"
    }
}

fun buildChatRenderItems(
    messages: List<ChatMessage>,
    liveThinkingBlocks: List<ThinkingBlock>,
    isAwaitingResponse: Boolean,
    isStreaming: Boolean,
    activityLabel: String,
    generationStartedAt: Long?,
): List<ChatRenderItem> {
    val result = mutableListOf<ChatRenderItem>()
    val pendingToolCalls = mutableListOf<ChatMessage>()
    var toolCallListIdx = 0

    for (msg in messages) {
        if (msg.isToolCall) {
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
        result.add(ChatRenderItem.LiveActivity(activityLabel, generationStartedAt))
    }

    return result
}
