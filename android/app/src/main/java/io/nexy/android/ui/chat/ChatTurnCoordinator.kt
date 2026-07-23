package io.nexy.android.ui.chat

import io.nexy.android.data.model.WsEvent
import java.util.TreeMap

data class ChatTurnCoordinationResult(
    val state: ChatTurnState,
    val needsSnapshot: Boolean,
)

/**
 * Serializes live and replayed turn events before they reach [reduceChatTurn].
 *
 * WebSocket delivery is normally ordered, but a reconnect can race a live event against an
 * active-turn snapshot. The reducer intentionally rejects stale sequences, so feeding it a
 * higher sequence first permanently loses the missing prefix. This coordinator buffers gaps,
 * deduplicates by sequence, and only advances the reducer through a contiguous prefix.
 */
class ChatTurnCoordinator(private val conversationId: String) {
    private var state = emptyChatTurnState(conversationId)
    private var bufferedTurnId: String? = null
    private val pending = TreeMap<Long, WsEvent.ChatTurnEvent>()

    fun currentState(): ChatTurnState = state

    fun reset() {
        state = emptyChatTurnState(conversationId)
        bufferedTurnId = null
        pending.clear()
    }

    fun accept(event: WsEvent.ChatTurnEvent): ChatTurnCoordinationResult {
        if (event.conversationId != conversationId) {
            return ChatTurnCoordinationResult(state, needsSnapshot = false)
        }

        if (event.type == "turn_started") {
            if (state.turnId != event.turnId) {
                state = emptyChatTurnState(conversationId)
                pending.clear()
            }
            bufferedTurnId = event.turnId
            pending[event.sequence] = event
        } else {
            if (bufferedTurnId != null && bufferedTurnId != event.turnId) {
                pending.clear()
            }
            bufferedTurnId = event.turnId
            pending.putIfAbsent(event.sequence, event)
        }

        drainContiguous()
        return ChatTurnCoordinationResult(state, needsSnapshot = hasGap())
    }

    /**
     * Merges an authoritative replay prefix with any newer live events already buffered.
     * Rebuilding from the prefix makes reconnect restoration identical to uninterrupted live
     * delivery while preserving events that raced ahead of the snapshot response.
     */
    fun restore(events: List<WsEvent.ChatTurnEvent>): ChatTurnCoordinationResult {
        if (events.isEmpty()) return ChatTurnCoordinationResult(state, needsSnapshot = hasGap())
        val ordered = events
            .asSequence()
            .filter { it.conversationId == conversationId }
            .sortedBy { it.sequence }
            .toList()
        val turnId = ordered.firstOrNull { it.type == "turn_started" }?.turnId
            ?: ordered.first().turnId
        val raced = pending.values.filter { it.turnId == turnId }

        state = emptyChatTurnState(conversationId)
        pending.clear()
        bufferedTurnId = turnId
        (ordered + raced).forEach { pending.putIfAbsent(it.sequence, it) }
        drainContiguous()
        return ChatTurnCoordinationResult(state, needsSnapshot = hasGap())
    }

    private fun drainContiguous() {
        if (state.turnId == null) {
            val start = pending.values.firstOrNull { it.type == "turn_started" } ?: return
            pending.remove(start.sequence)
            state = reduceChatTurn(state, start)
        }
        while (true) {
            val nextSequence = state.lastSequence + 1
            val next = pending.remove(nextSequence) ?: break
            if (next.turnId == state.turnId) state = reduceChatTurn(state, next)
        }
        pending.headMap(state.lastSequence, true).clear()
    }

    private fun hasGap(): Boolean =
        pending.isNotEmpty() && (state.turnId == null || pending.firstKey() > state.lastSequence + 1)
}
