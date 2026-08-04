package io.nexy.android.data.local

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.WsEvent
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalDataRepositoryPinTest {
    private val context: Context
        get() = ApplicationProvider.getApplicationContext()

    private val repository: LocalDataRepository
        get() = LocalDataRepository.get(context)

    @Test
    fun conversationPageAndPinEchoArePersistedToSharedConversationState() = runBlocking {
        val conversationId = "pin-test-${UUID.randomUUID()}"
        val conversation = Conversation(
            id = conversationId,
            title = "Pinned test",
            created_at = "1000",
            updated_at = "1000",
            pinned = false,
        )

        repository.applyRemoteEvent(
            WsEvent.ConversationPage(
                requestId = "page-1",
                conversations = listOf(conversation),
                totalCount = 1,
                nextCursor = null,
                hasMore = false,
            ),
        )
        repository.applyRemoteEvent(WsEvent.ConversationPinned(conversationId, true))

        val cached = repository.conversations
            .first { rows -> rows.any { it.id == conversationId && it.pinned } }
            .first { it.id == conversationId }
        assertTrue(cached.pinned)
    }
}
