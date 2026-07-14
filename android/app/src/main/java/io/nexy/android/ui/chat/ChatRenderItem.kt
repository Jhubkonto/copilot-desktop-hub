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

    /**
     * A single settled (non-live) reasoning block from a completed assistant turn, as its own
     * top-level LazyColumn item rather than bundled inside AssistantMessage's Column. A turn
     * with many reasoning blocks used to compose/measure all of them at once as part of one
     * large AssistantMessage item — LazyColumn only virtualizes at item granularity, so that
     * whole burst of SelectionContainer/Text/AnimatedVisibility/timeline-bead work landed in a
     * single frame whenever the item entered the composed window, which is exactly the jitter
     * scrolling past reasoning-heavy history. Standalone ChatRenderItem.ToolCall already gets
     * its own item+ChatTimelineGroup for the same reason — this mirrors that existing pattern
     * rather than introducing a new one.
     */
    data class ThinkingBlockItem(
        val block: ThinkingBlock,
        val messageId: String,
        val index: Int,
    ) : ChatRenderItem() {
        // block.blockId alone is not a safe LazyColumn key: persisted history parses it via
        // `obj.optString("blockId")` (WsEventParser.parseThinkingBlocks), which defaults to ""
        // when a stored block predates blockId tracking or otherwise omits it. Every such block
        // across an entire conversation collapsed onto the same key "thinking_" once these
        // became real LazyColumn items — items(key=) requires strict uniqueness and throws at
        // runtime on a collision, which is what made scrolling crash. Scoping to the owning
        // message plus its position in that message's block list guarantees uniqueness even
        // when blockId is blank or duplicated, since a settled message's block list is frozen.
        override val key: String get() = "thinking_${messageId}_${block.blockId}_$index"
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
            // Historical thinking blocks precede the message as their own items — see
            // ThinkingBlockItem's doc. Skipped when live blocks already cover the same
            // content, mirroring the prior bundled-rendering condition exactly.
            if (visibleLiveThinking.isEmpty()) {
                for ((index, block) in msg.thinkingBlocks.withIndex()) {
                    result.add(ChatRenderItem.ThinkingBlockItem(block, msg.id, index))
                }
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
