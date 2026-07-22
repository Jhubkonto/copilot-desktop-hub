package io.nexy.android.data

import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

data class ChatAnimationState(
    val turnId: String? = null,
    val authoritativeText: String = "",
    val displayedText: String = "",
    val lastSequence: Long = 0L,
    val terminal: Boolean = false,
    val revealLagMs: Long = 0L,
    val droppedDuplicateEvents: Long = 0L,
    val sequenceGaps: Long = 0L,
    val snapshotRecoveries: Long = 0L,
    val oldestPendingAt: Long? = null,
) {
    val backlogLength: Int get() = authoritativeText.length - displayedText.length
}

/**
 * Process-memory streaming state. Authoritative text is exposed immediately; the
 * retained shape keeps paired-client compatibility while animation is removed.
 */
object ChatAnimationRepository {
    private val states = mutableMapOf<String, MutableStateFlow<ChatAnimationState>>()

    @Synchronized
    fun observe(conversationId: String): StateFlow<ChatAnimationState> =
        states.getOrPut(conversationId) { MutableStateFlow(ChatAnimationState()) }.asStateFlow()

    @Synchronized
    fun accept(event: WsEvent.ChatTurnEvent) {
        val flow = states.getOrPut(event.conversationId) { MutableStateFlow(ChatAnimationState()) }
        val current = flow.value
        if (event.type == "turn_started") {
            flow.value = ChatAnimationState(turnId = event.turnId, lastSequence = event.sequence)
            return
        }
        if (current.turnId != null && current.turnId != event.turnId) return
        if (event.sequence <= current.lastSequence) {
            flow.value = current.copy(droppedDuplicateEvents = current.droppedDuplicateEvents + 1)
            return
        }
        val sequenceGaps = current.sequenceGaps +
            if (current.lastSequence > 0L && event.sequence > current.lastSequence + 1L) 1 else 0
        when (event.type) {
            "assistant_text_delta" -> {
                val chunk = JSONObject(event.payloadJson).optString("chunk", "")
                val text = current.authoritativeText + chunk
                flow.value = current.copy(
                    turnId = event.turnId,
                    authoritativeText = text,
                    displayedText = text,
                    lastSequence = event.sequence,
                    sequenceGaps = sequenceGaps,
                    revealLagMs = 0L,
                    oldestPendingAt = null,
                )
            }
            "text_segment_done" -> {
                // A text segment just closed (a tool call is about to interrupt it, or the
                // turn is wrapping up) — snap the reveal forward to cover it completely
                // *right now*, rather than continuing to trickle it out at the normal pace.
                // Without this, freezeCurrentStreamingMessage() (called right before the
                // next tool-call/team-activity message is inserted) reads displayedText's
                // length as "where this segment ends", but the throttled drain loop is
                // usually still lagging behind authoritativeText at that moment — especially
                // for a tool like ToolSearch that resolves almost instantly. The freeze then
                // lands mid-sentence at wherever the animation happened to have reached, and
                // the remainder of the (already-complete) segment gets wrongly treated as the
                // start of a brand new one. Segments this closes are, by construction, never
                // written to again, so jumping straight to full is not a "cheat forward" the
                // way it would be mid-segment — only the still-open next segment continues to
                // reveal at the normal typewriter pace.
                flow.value = current.copy(
                    turnId = event.turnId,
                    displayedText = current.authoritativeText,
                    lastSequence = event.sequence,
                    sequenceGaps = sequenceGaps,
                    revealLagMs = 0L,
                    oldestPendingAt = null,
                )
            }
            "turn_completed", "turn_failed" -> {
                flow.value = current.copy(
                    turnId = event.turnId,
                    displayedText = current.authoritativeText,
                    lastSequence = event.sequence,
                    terminal = true,
                    sequenceGaps = sequenceGaps,
                )
            }
            else -> flow.value = current.copy(
                turnId = event.turnId,
                lastSequence = event.sequence,
                sequenceGaps = sequenceGaps,
            )
        }
    }

    @Synchronized
    fun restore(snapshot: WsEvent.ChatActiveTurnSnapshot) {
        val flow = states.getOrPut(snapshot.conversationId) { MutableStateFlow(ChatAnimationState()) }
        val current = flow.value
        if (current.turnId == snapshot.turnId && current.lastSequence >= snapshot.latestSequence) return
        // Re-entry/cold reconnect policy: accumulated desktop text is immediately visible.
        flow.value = ChatAnimationState(
            turnId = snapshot.turnId,
            authoritativeText = snapshot.assistantText,
            displayedText = snapshot.assistantText,
            lastSequence = snapshot.latestSequence,
            terminal = snapshot.status != "active",
            droppedDuplicateEvents = current.droppedDuplicateEvents,
            sequenceGaps = current.sequenceGaps,
            snapshotRecoveries = current.snapshotRecoveries + 1,
        )
    }

    @Synchronized
    fun clear(conversationId: String) {
        // Reset the existing MutableStateFlow's *value* in place — do not remove it from
        // `states`. observe() hands out `.asStateFlow()` wrappers bound to one specific
        // instance; removing the map entry here meant the next accept()/restore() call would
        // getOrPut a brand-new instance, permanently orphaning any collector already running
        // against the old one (e.g. ChatViewModel's live-render collector, subscribed once in
        // init{}). Since this is called on every sendMessage(), not just Retry, every turn
        // after the very first in a chat session fed a state flow nobody was listening to
        // anymore — live text and thinking blocks stopped rendering incrementally, only
        // reappearing via the end-of-turn full history refetch. Resetting in place keeps the
        // same instance alive so existing collectors keep receiving updates.
        states[conversationId]?.value = ChatAnimationState()
    }

    fun shouldApplyPersistedHistory(conversationId: String, persistedAssistantText: String?): Boolean {
        val current = observe(conversationId).value
        if (current.turnId == null) return true
        return current.terminal &&
            persistedAssistantText != null &&
            persistedAssistantText == current.authoritativeText
    }

}
