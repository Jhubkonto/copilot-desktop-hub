package io.nexy.android.ui.chat

import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import org.json.JSONArray
import org.json.JSONObject

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

data class ChatTurnState(
    val conversationId: String? = null,
    val turnId: String? = null,
    val lastSequence: Long = 0L,
    val status: ChatTurnStatus = ChatTurnStatus.Idle,
    val text: String = "",
    val thinkingBlocks: List<ThinkingBlock> = emptyList(),
    val pendingThinkingEnds: Set<String> = emptySet(),
    val toolCalls: List<ChatTurnToolCall> = emptyList(),
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

        "assistant_text_delta" -> base.copy(
            status = ChatTurnStatus.Streaming,
            text = state.text + payload.optString("chunk", ""),
        )

        "thinking_delta" -> {
            val blockId = payload.optString("blockId", "")
            val chunk = payload.optString("chunk", "")
            if (blockId.isBlank() || chunk.isEmpty()) {
                base
            } else {
                val existing = state.thinkingBlocks.firstOrNull { it.blockId == blockId }
                val pendingThinkingEnds = state.pendingThinkingEnds - blockId
                val done = existing?.done == true || blockId in state.pendingThinkingEnds
                val nextBlock = ThinkingBlock(
                    blockId = blockId,
                    content = (existing?.content ?: "") + chunk,
                    done = done,
                )
                base.copy(
                    thinkingBlocks = state.thinkingBlocks.upsertThinkingBlock(nextBlock),
                    pendingThinkingEnds = pendingThinkingEnds,
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
                )
            }
        }

        "tool_started" -> base.copy(
            status = ChatTurnStatus.Active,
            activity = ChatTurnActivity(
                state = "tool",
                label = "Running ${payload.optString("name", "tool")}",
                toolName = payload.nullableString("name"),
                serverName = payload.nullableString("serverName"),
            ),
        )

        "tool_finished" -> base.copy(
            status = ChatTurnStatus.Active,
            toolCalls = state.toolCalls.upsertToolCall(ChatTurnToolCall(
                id = payload.nullableString("id"),
                toolName = payload.optString("toolName", "Tool call"),
                serverName = payload.nullableString("serverName"),
                argsJson = payload.optJSONObject("args")?.toString(),
                result = payload.optString("result", ""),
                success = payload.optBoolean("success", true),
                resultImages = payload.optJSONArray("resultImages").toStringMapList(),
            )),
        )

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
        )

        "turn_failed" -> base.copy(
            status = ChatTurnStatus.Failed,
            thinkingBlocks = state.thinkingBlocks.map { it.copy(done = true) },
            pendingThinkingEnds = emptySet(),
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

private fun JSONObject.nullableString(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotBlank() } else null

private fun JSONArray?.toStringMapList(): List<Map<String, String>> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index ->
        val obj = optJSONObject(index) ?: return@mapNotNull null
        obj.keys().asSequence().associateWith { key -> obj.optString(key) }
    }
}
