package io.nexy.android.data

import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteEventDispatcherTest {

    @Test
    fun publishesConversationHistoryBeforePersistingIt() = runTest {
        val calls = mutableListOf<String>()
        val event = WsEvent.ConversationMessages("conversation-1", emptyList())

        dispatchRemoteEvent(
            event = event,
            persist = { calls += "persist" },
            publish = { calls += "publish" },
            onPersistError = { _, _ -> calls += "error" },
        )

        assertEquals(listOf("publish", "persist"), calls)
    }

    @Test
    fun keepsOtherRemoteEventsCacheFirst() = runTest {
        val calls = mutableListOf<String>()
        val event = WsEvent.AgentList(emptyList())

        dispatchRemoteEvent(
            event = event,
            persist = { calls += "persist" },
            publish = { calls += "publish" },
            onPersistError = { _, _ -> calls += "error" },
        )

        assertEquals(listOf("persist", "publish"), calls)
    }

    @Test
    fun stillPublishesNonHistoryEventsWhenPersistenceFails() = runTest {
        val calls = mutableListOf<String>()
        val event = WsEvent.AgentList(emptyList())

        dispatchRemoteEvent(
            event = event,
            persist = {
                calls += "persist"
                throw IllegalStateException("cache unavailable")
            },
            publish = { calls += "publish" },
            onPersistError = { _, _ -> calls += "error" },
        )

        assertEquals(listOf("persist", "error", "publish"), calls)
    }

    @Test
    fun doesNotRepublishHistoryWhenItsPersistenceFails() = runTest {
        val calls = mutableListOf<String>()
        val event = WsEvent.ConversationMessages("conversation-1", emptyList())

        dispatchRemoteEvent(
            event = event,
            persist = {
                calls += "persist"
                throw IllegalStateException("cache unavailable")
            },
            publish = { calls += "publish" },
            onPersistError = { _, _ -> calls += "error" },
        )

        assertEquals(listOf("publish", "persist", "error"), calls)
    }
}
