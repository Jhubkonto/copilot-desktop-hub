package io.nexy.android.data

import io.nexy.android.data.model.Conversation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationPageMergeTest {
    @Test
    fun pageRowsPopulateSharedConversationStateAndReplaceStaleCopies() {
        val stale = conversation("chat-1", pinned = false)
        val retained = conversation("chat-older", pinned = false)
        val incoming = listOf(
            conversation("chat-1", pinned = true),
            conversation("chat-2", pinned = true),
        )

        val merged = mergeConversationPage(listOf(stale, retained), incoming)

        assertEquals(listOf("chat-1", "chat-older", "chat-2"), merged.map { it.id })
        assertTrue(merged.first { it.id == "chat-1" }.pinned)
        assertTrue(merged.first { it.id == "chat-2" }.pinned)
    }

    private fun conversation(id: String, pinned: Boolean) = Conversation(
        id = id,
        title = id,
        created_at = "0",
        updated_at = "0",
        pinned = pinned,
    )
}
