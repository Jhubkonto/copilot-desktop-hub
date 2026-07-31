package io.nexy.android.data

import io.nexy.android.data.model.WsEvent

/**
 * Keeps remote cache writes serialized while allowing authoritative chat history to reach the
 * screen before a potentially contended Room write completes.
 */
internal suspend fun dispatchRemoteEvent(
    event: WsEvent,
    persist: suspend (WsEvent) -> Unit,
    publish: suspend (WsEvent) -> Unit,
    onPersistError: (WsEvent, Exception) -> Unit,
) {
    if (event is WsEvent.ConversationMessages) {
        publish(event)
    }

    try {
        persist(event)
    } catch (error: Exception) {
        onPersistError(event, error)
    }

    if (event !is WsEvent.ConversationMessages) {
        publish(event)
    }
}
