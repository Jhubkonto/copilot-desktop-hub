package io.nexy.android.ui.chat

import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

enum class ChatTurnStatus {
    Idle,
    Active,
    Streaming,
    Completed,
    Failed,
}

data class ChatTurnToolCall(
    val id: String? = null,
    val toolName: String,
    val serverName: String? = null,
    val argsJson: String? = null,
    val result: String,
    val success: Boolean,
    val resultImages: List<Map<String, String>> = emptyList(),
)

data class ChatTurnActivity(
    val state: String,
    val label: String,
    val toolName: String? = null,
    val serverName: String? = null,
)

data class ChatTurnCost(
    val inputTokens: Int,
    val outputTokens: Int,
    val totalCostUsd: Double,
)

data class ChatTurnError(
    val type: String,
    val message: String,
    val retryable: Boolean,
    val retryAfterSeconds: Int? = null,
)

// One entry in a turn's true chronological order — text/thinking bursts and tool calls,
// interleaved the way they actually happened, keyed by blockId (text/thinking) or id (tool
// call) so a later event for the same entry updates it in place instead of appending a
// duplicate. Backends that don't segment text (no blockId on assistant_text_delta) get a
// single legacy TextSegment with blockId "" covering the whole turn, per the comment on
// ChatAssistantTextDeltaEvent.blockId in chat-turn-types.ts.
sealed class ChatTurnItem {
    data class TextSegment(val blockId: String, val content: String, val done: Boolean) : ChatTurnItem()
    data class Thinking(val blockId: String, val content: String, val done: Boolean) : ChatTurnItem()
    data class ToolCall(val id: String, val call: ChatTurnToolCall) : ChatTurnItem()
}

data class ChatTurnState(
    val conversationId: String? = null,
    val turnId: String? = null,
    val lastSequence: Long = 0L,
    val status: ChatTurnStatus = ChatTurnStatus.Idle,
    // Full concatenated text regardless of blockId — kept for existing call sites that only
    // need the whole reply, not its interleaving with tool calls (e.g. copy/share).
    val text: String = "",
    val thinkingBlocks: List<ThinkingBlock> = emptyList(),
    val pendingThinkingEnds: Set<String> = emptySet(),
    val toolCalls: List<ChatTurnToolCall> = emptyList(),
    // Same content as text/thinkingBlocks/toolCalls above, but as one sequence-ordered list —
    // this is what live rendering should walk to reproduce true chronological order instead
    // of the three separate buckets, which only preserve order within their own kind.
    val timeline: List<ChatTurnItem> = emptyList(),
    val activity: ChatTurnActivity? = null,
    val cost: ChatTurnCost? = null,
    val model: String? = null,
    val error: ChatTurnError? = null,
    val generationStartedAt: Long? = null,
)

fun emptyChatTurnState(conversationId: String? = null): ChatTurnState =
    ChatTurnState(conversationId = conversationId)

fun reduceChatTurn(state: ChatTurnState, event: WsEvent.ChatTurnEvent): ChatTurnState {
    if (state.conversationId != null && event.conversationId != state.conversationId) return state

    val payload = JSONObject(event.payloadJson)
    if (event.type == "turn_started") {
        return emptyChatTurnState(event.conversationId).copy(
            turnId = event.turnId,
            lastSequence = event.sequence,
            status = ChatTurnStatus.Active,
            // Anchor to the event's own emission time (the real turn start), not `now`. On a
            // mid-turn re-entry the desktop replays this same `turn_started` from its persisted
            // log; using `now` would restart the "Thinking · Ns" counter from zero on every
            // reconnect/snapshot instead of holding the elapsed value.
            generationStartedAt = event.timestamp.takeIf { it > 0L } ?: System.currentTimeMillis(),
        )
    }

    if (state.turnId != null && event.turnId != state.turnId) return state
    if (event.sequence <= state.lastSequence) return state

    val base = state.copy(
        conversationId = event.conversationId,
        turnId = event.turnId,
        lastSequence = event.sequence,
    )

    return when (event.type) {
        "user_message_committed" -> base.copy(status = ChatTurnStatus.Active)

        "assistant_text_delta" -> {
            // Omitted by backends that don't segment text yet — the whole turn's text is then
            // treated as a single legacy block under blockId "" (see ChatTurnItem doc comment).
            val blockId = payload.optString("blockId", "")
            val chunk = payload.optString("chunk", "")
            val existingContent = state.timeline
                .filterIsInstance<ChatTurnItem.TextSegment>()
                .firstOrNull { it.blockId == blockId }
                ?.content
                .orEmpty()
            base.copy(
                status = ChatTurnStatus.Streaming,
                text = state.text + chunk,
                timeline = state.timeline.upsertTextSegment(blockId, existingContent + chunk, done = false),
            )
        }

        "text_segment_done" -> {
            val blockId = payload.optString("blockId", "")
            val existing = state.timeline
                .filterIsInstance<ChatTurnItem.TextSegment>()
                .firstOrNull { it.blockId == blockId }
            if (existing == null) base else base.copy(
                timeline = state.timeline.upsertTextSegment(blockId, existing.content, done = true),
            )
        }

        "thinking_delta" -> {
            val blockId = payload.optString("blockId", "")
            val chunk = payload.optString("chunk", "")
            if (blockId.isBlank() || chunk.isEmpty()) {
                base
            } else {
                val existing = state.thinkingBlocks.firstOrNull { it.blockId == blockId }
                val pendingThinkingEnds = state.pendingThinkingEnds - blockId
                val done = existing?.done == true || blockId in state.pendingThinkingEnds
                val content = (existing?.content ?: "") + chunk
                val nextBlock = ThinkingBlock(
                    blockId = blockId,
                    content = content,
                    done = done,
                )
                base.copy(
                    thinkingBlocks = state.thinkingBlocks.upsertThinkingBlock(nextBlock),
                    pendingThinkingEnds = pendingThinkingEnds,
                    timeline = state.timeline.upsertThinkingItem(blockId, content, done),
                )
            }
        }

        "thinking_done" -> {
            val blockId = payload.optString("blockId", "")
            val existing = state.thinkingBlocks.firstOrNull { it.blockId == blockId }
            if (blockId.isBlank()) {
                base
            } else if (existing == null) {
                base.copy(pendingThinkingEnds = state.pendingThinkingEnds + blockId)
            } else {
                base.copy(
                    thinkingBlocks = state.thinkingBlocks.upsertThinkingBlock(existing.copy(done = true)),
                    timeline = state.timeline.upsertThinkingItem(blockId, existing.content, done = true),
                )
            }
        }

        "tool_started" -> {
            val id = payload.nullableString("id")
            val timeline = if (id != null) {
                // Placeholder entry so the timeline positions this tool call the moment it
                // starts, not just once tool_finished's result arrives — tool_finished below
                // upserts the same id in place rather than appending a second entry.
                state.timeline.upsertToolCallItem(id, ChatTurnToolCall(
                    id = id,
                    toolName = payload.optString("name", "Tool call"),
                    serverName = payload.nullableString("serverName"),
                    argsJson = payload.optJSONObject("input")?.toString(),
                    result = "",
                    success = true,
                ))
            } else {
                state.timeline
            }
            base.copy(
                status = ChatTurnStatus.Active,
                activity = ChatTurnActivity(
                    state = "tool",
                    label = "Running ${payload.optString("name", "tool")}",
                    toolName = payload.nullableString("name"),
                    serverName = payload.nullableString("serverName"),
                ),
                timeline = timeline,
            )
        }

        "tool_finished" -> {
            val toolCall = ChatTurnToolCall(
                id = payload.nullableString("id"),
                toolName = payload.optString("toolName", "Tool call"),
                serverName = payload.nullableString("serverName"),
                argsJson = payload.optJSONObject("args")?.toString(),
                result = payload.optString("result", ""),
                success = payload.optBoolean("success", true),
                resultImages = payload.optJSONArray("resultImages").toStringMapList(),
            )
            base.copy(
                status = ChatTurnStatus.Active,
                toolCalls = state.toolCalls.upsertToolCall(toolCall),
                timeline = if (toolCall.id != null) {
                    state.timeline.upsertToolCallItem(toolCall.id, toolCall)
                } else {
                    state.timeline + ChatTurnItem.ToolCall(UUID.randomUUID().toString(), toolCall)
                },
            )
        }

        "activity_changed" -> base.copy(
            activity = ChatTurnActivity(
                state = payload.optString("state", "thinking"),
                label = payload.optString("label", "Assistant is thinking"),
                toolName = payload.nullableString("toolName"),
                serverName = payload.nullableString("serverName"),
            ),
        )

        "cost_updated" -> base.copy(
            cost = ChatTurnCost(
                inputTokens = payload.optInt("inputTokens", 0),
                outputTokens = payload.optInt("outputTokens", 0),
                totalCostUsd = payload.optDouble("totalCostUsd", 0.0),
            ),
        )

        "model_changed" -> base.copy(model = payload.nullableString("model"))

        "turn_completed" -> base.copy(
            status = ChatTurnStatus.Completed,
            thinkingBlocks = state.thinkingBlocks.map { it.copy(done = true) },
            pendingThinkingEnds = emptySet(),
            timeline = state.timeline.map { it.markDone() },
        )

        "turn_failed" -> base.copy(
            status = ChatTurnStatus.Failed,
            thinkingBlocks = state.thinkingBlocks.map { it.copy(done = true) },
            pendingThinkingEnds = emptySet(),
            timeline = state.timeline.map { it.markDone() },
            error = ChatTurnError(
                type = payload.optString("errorType", "unknown"),
                message = payload.optString("message", ""),
                retryable = payload.optBoolean("retryable", false),
                retryAfterSeconds = if (payload.has("retryAfterSeconds") && !payload.isNull("retryAfterSeconds")) {
                    payload.optInt("retryAfterSeconds")
                } else {
                    null
                },
            ),
        )

        "history_snapshot_received" -> base

        else -> base
    }
}

private fun List<ThinkingBlock>.upsertThinkingBlock(block: ThinkingBlock): List<ThinkingBlock> {
    val index = indexOfFirst { it.blockId == block.blockId }
    return if (index >= 0) {
        toMutableList().also { it[index] = block }
    } else {
        this + block
    }
}

private fun List<ChatTurnToolCall>.upsertToolCall(toolCall: ChatTurnToolCall): List<ChatTurnToolCall> {
    val id = toolCall.id ?: return this + toolCall
    val index = indexOfFirst { it.id == id }
    return if (index >= 0) {
        toMutableList().also { it[index] = toolCall }
    } else {
        this + toolCall
    }
}

private fun List<ChatTurnItem>.upsertTextSegment(blockId: String, content: String, done: Boolean): List<ChatTurnItem> {
    val item = ChatTurnItem.TextSegment(blockId, content, done)
    val index = indexOfFirst { it is ChatTurnItem.TextSegment && it.blockId == blockId }
    return if (index >= 0) toMutableList().also { it[index] = item } else this + item
}

private fun List<ChatTurnItem>.upsertThinkingItem(blockId: String, content: String, done: Boolean): List<ChatTurnItem> {
    val item = ChatTurnItem.Thinking(blockId, content, done)
    val index = indexOfFirst { it is ChatTurnItem.Thinking && it.blockId == blockId }
    return if (index >= 0) toMutableList().also { it[index] = item } else this + item
}

private fun List<ChatTurnItem>.upsertToolCallItem(id: String, call: ChatTurnToolCall): List<ChatTurnItem> {
    val item = ChatTurnItem.ToolCall(id, call)
    val index = indexOfFirst { it is ChatTurnItem.ToolCall && it.id == id }
    return if (index >= 0) toMutableList().also { it[index] = item } else this + item
}

private fun ChatTurnItem.markDone(): ChatTurnItem = when (this) {
    is ChatTurnItem.TextSegment -> copy(done = true)
    is ChatTurnItem.Thinking -> copy(done = true)
    is ChatTurnItem.ToolCall -> this
}

private fun JSONObject.nullableString(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotBlank() } else null

private fun JSONArray?.toStringMapList(): List<Map<String, String>> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index ->
        val obj = optJSONObject(index) ?: return@mapNotNull null
        obj.keys().asSequence().associateWith { key -> obj.optString(key) }
    }
}
