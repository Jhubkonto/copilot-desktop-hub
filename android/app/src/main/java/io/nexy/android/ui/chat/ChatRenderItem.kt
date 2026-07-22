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
        // Resolved while the timeline is built off the Compose thread. Looking this up in the
        // item lambda used to scan the entire render list for every visible assistant bubble.
        val precedingUserMessage: ChatMessage? = null,
        val liveThinkingBlocks: List<ThinkingBlock> = emptyList(),
        // Overrides what MessageBubble actually displays (the tail text segment) while
        // message.text (the full concatenated reply) still goes to copy/share/etc — set
        // when an earlier segment of this reply already rendered as its own
        // TextSegmentItem above and repeating it here would duplicate it on screen.
        val displayText: String? = null,
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

    /**
     * A single settled response-text segment (a burst of reply text that was interrupted by
     * a tool call) from a completed assistant turn, positioned as its own top-level item
     * chronologically alongside ThinkingBlockItem/ToolCall — the same rationale as
     * ThinkingBlockItem (per-item LazyColumn virtualization) plus true ordering: without this,
     * a lead-in sentence the model wrote before calling a tool would always render bunched
     * together with the rest of the reply, below every tool call, instead of ahead of the
     * tool call it actually preceded. The most recent segment is never wrapped here — it's
     * the tail, rendered as the owning AssistantMessage's own displayed text instead.
     */
    data class TextSegmentItem(
        val block: ThinkingBlock,
        val messageId: String,
        val index: Int,
    ) : ChatRenderItem() {
        override val key: String get() = "textseg_${messageId}_${block.blockId}_$index"
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

// The most recent text segment (by firstSeenAt) is excluded from the interleaved timeline —
// it becomes the owning message's own displayed text (see AssistantMessage/MessageBubble's
// displayText) instead of an inline item, so the reply reads as "narration, tool calls,
// narration, ..., final answer" rather than repeating the final segment's text twice.
fun tailTextSegment(textSegments: List<ThinkingBlock>): ThinkingBlock? =
    textSegments.maxByOrNull { it.firstSeenAt ?: 0L }

fun buildChatRenderItems(
    messages: List<ChatMessage>,
    liveThinkingBlocks: List<ThinkingBlock>,
    isAwaitingResponse: Boolean,
    isStreaming: Boolean,
    activity: ChatTurnActivity?,
    generationStartedAt: Long?,
): List<ChatRenderItem> {
    val result = mutableListOf<ChatRenderItem>()
    var pendingToolCalls = mutableListOf<ChatMessage>()
    var toolCallListIdx = 0
    var precedingUserMessage: ChatMessage? = null
    val finalizedArtifactIds = messages.mapNotNull { message ->
        message.artifactRef?.takeIf { !it.versionId.isNullOrBlank() }?.artifactId
    }.toSet()

    fun flushDanglingToolCalls() {
        for (tc in pendingToolCalls) result.add(ChatRenderItem.ToolCall(tc, toolCallListIdx++))
        pendingToolCalls = mutableListOf()
    }

    for (msg in messages) {
        if (msg.artifactRef != null) {
            flushDanglingToolCalls()
            if (!(msg.artifactRef.pending && msg.artifactRef.artifactId in finalizedArtifactIds)) {
                result.add(ChatRenderItem.ArtifactCard(msg.artifactRef, msg.id))
            }
        } else if (msg.isToolCall) {
            pendingToolCalls.add(msg)
        } else if (msg.isUser) {
            flushDanglingToolCalls()
            result.add(ChatRenderItem.UserMessage(msg))
            precedingUserMessage = msg
        } else {
            // Assistant message — thinking blocks, text segments (all but the tail, which
            // becomes this message's own displayed text), and the tool calls that preceded
            // it are separate collections with their own real timestamps; interleave them by
            // actual chronological order instead of always grouping every block ahead of
            // every tool call. Ties (blocks with no firstSeenAt, from before that field
            // existed) fall back to a stable sort that keeps blocks before tool calls,
            // matching the historical grouped-rendering behavior.
            val committedBlockIds = msg.thinkingBlocks.map { it.blockId }.toSet()
            val visibleLiveThinking = if (msg.isStreaming && liveThinkingBlocks.isNotEmpty()) {
                liveThinkingBlocks.filter { it.blockId !in committedBlockIds }
            } else {
                emptyList()
            }
            val tail = tailTextSegment(msg.textSegments)
            data class Entry(val ts: Long, val add: () -> Unit)
            val entries = mutableListOf<Entry>()
            // Historical thinking blocks precede the message as their own items — see
            // ThinkingBlockItem's doc. Skipped when live blocks already cover the same
            // content, mirroring the prior bundled-rendering condition exactly.
            if (visibleLiveThinking.isEmpty()) {
                for ((index, block) in msg.thinkingBlocks.withIndex()) {
                    entries.add(Entry(block.firstSeenAt ?: Long.MIN_VALUE) {
                        result.add(ChatRenderItem.ThinkingBlockItem(block, msg.id, index))
                    })
                }
            }
            for ((index, block) in msg.textSegments.withIndex()) {
                if (block === tail) continue
                entries.add(Entry(block.firstSeenAt ?: Long.MIN_VALUE) {
                    result.add(ChatRenderItem.TextSegmentItem(block, msg.id, index))
                })
            }
            for (tc in pendingToolCalls) {
                entries.add(Entry(tc.timestamp) { result.add(ChatRenderItem.ToolCall(tc, toolCallListIdx++)) })
            }
            entries.sortBy { it.ts }
            for (entry in entries) entry.add()

            result.add(ChatRenderItem.AssistantMessage(
                message = msg,
                precedingUserMessage = precedingUserMessage,
                liveThinkingBlocks = visibleLiveThinking,
                displayText = tail?.content,
            ))
            pendingToolCalls = mutableListOf()
        }
    }
    flushDanglingToolCalls()

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

/**
 * Reuses the expanded timeline for the settled portion of a conversation while a response is
 * streaming. A token reveal replaces only the final [ChatMessage], but the old implementation
 * still walked, sorted, and allocated render items for the whole history on every reveal frame.
 *
 * The cache deliberately compares message instances rather than IDs: history reconciliation
 * replaces an affected [ChatMessage] instance, so edits, retries, pagination, and metadata
 * updates invalidate the cached prefix automatically. The single active streaming tail is then
 * expanded separately with the current live-turn state.
 */
internal class ChatRenderTimelineCache {
    private var cachedStableMessages: List<ChatMessage> = emptyList()
    private var cachedStableItems: List<ChatRenderItem> = emptyList()

    @Synchronized
    fun build(
        messages: List<ChatMessage>,
        liveThinkingBlocks: List<ThinkingBlock>,
        isAwaitingResponse: Boolean,
        isStreaming: Boolean,
        activity: ChatTurnActivity?,
        generationStartedAt: Long?,
    ): List<ChatRenderItem> {
        // A live message is always the tail in normal operation. Keeping anything after the
        // first live item in the dynamic portion also makes this safe if events briefly arrive
        // out of order.
        val firstStreamingIndex = messages.indexOfFirst { it.isStreaming }
        val stableCount = if (firstStreamingIndex >= 0) firstStreamingIndex else messages.size

        if (!matchesCachedPrefix(messages, stableCount)) {
            cachedStableMessages = messages.subList(0, stableCount).toList()
            cachedStableItems = buildChatRenderItems(
                messages = cachedStableMessages,
                liveThinkingBlocks = emptyList(),
                isAwaitingResponse = false,
                isStreaming = false,
                activity = null,
                generationStartedAt = null,
            )
        }

        if (stableCount == messages.size && !isAwaitingResponse) return cachedStableItems

        val dynamicItems = buildChatRenderItems(
            messages = messages.subList(stableCount, messages.size),
            liveThinkingBlocks = liveThinkingBlocks,
            isAwaitingResponse = isAwaitingResponse,
            isStreaming = isStreaming,
            activity = activity,
            generationStartedAt = generationStartedAt,
        )
        return if (cachedStableItems.isEmpty()) dynamicItems else cachedStableItems + dynamicItems
    }

    private fun matchesCachedPrefix(messages: List<ChatMessage>, stableCount: Int): Boolean {
        if (cachedStableMessages.size != stableCount) return false
        return (0 until stableCount).all { index -> cachedStableMessages[index] === messages[index] }
    }
}
