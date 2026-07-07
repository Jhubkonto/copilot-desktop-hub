package io.nexy.android.data.local

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.WsEvent
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for the "Mark completed" persistence bug: the tick was visible right
 * after tapping the button, then silently reverted on the next reconnect/refresh because
 * `applyRemoteEvent` never wrote `completedAt` into Room, and `applySyncSnapshot`'s
 * conversation-merge dropped the field entirely on every reconnect. Both paths are exercised
 * here directly against the real app database singleton (LocalDataRepository has no DB
 * injection seam), using unique conversation ids per test to avoid cross-test collisions.
 */
@RunWith(AndroidJUnit4::class)
class LocalDataRepositoryCompletionTest {
    private val repository: LocalDataRepository
        get() = LocalDataRepository.get(ApplicationProvider.getApplicationContext<Context>())

    @Test
    fun applyRemoteEventPersistsCompletedAtToRoom() = runBlocking {
        val conversationId = "completion-test-${UUID.randomUUID()}"
        repository.createConversation("Test", null, null).let { created ->
            // createConversation always mints its own id — re-seed under our known id directly.
            io.nexy.android.data.local.NexyDatabase.get(ApplicationProvider.getApplicationContext())
                .conversations().upsert(
                    io.nexy.android.data.local.ConversationEntity(
                        id = conversationId,
                        title = created.title,
                        createdAt = System.currentTimeMillis(),
                        updatedAt = System.currentTimeMillis(),
                    ),
                )
        }

        repository.applyRemoteEvent(WsEvent.DebriefConversationCompleted(conversationId, 12345L))

        val completed = repository.conversations.first { list -> list.any { it.id == conversationId } }
            .first { it.id == conversationId }
        assertEquals(12345L, completed.completed_at)

        repository.applyRemoteEvent(WsEvent.DebriefConversationIncompleted(conversationId))

        val incompleted = repository.conversations.first { list -> list.any { it.id == conversationId } }
            .first { it.id == conversationId }
        assertNull(incompleted.completed_at)
    }

    @Test
    fun applySyncSnapshotPreservesExistingCompletedAtWhenSnapshotOmitsIt() = runBlocking {
        val conversationId = "completion-snapshot-test-${UUID.randomUUID()}"
        io.nexy.android.data.local.NexyDatabase.get(ApplicationProvider.getApplicationContext())
            .conversations().upsert(
                io.nexy.android.data.local.ConversationEntity(
                    id = conversationId,
                    title = "Snapshot test",
                    createdAt = 1000L,
                    updatedAt = 1000L,
                    completedAt = 555L,
                    syncStatus = SyncStatus.SYNCED,
                ),
            )

        // A sync snapshot for this conversation that mirrors desktop's shape but WITHOUT
        // completed_at — this is layer 2a of the original bug: applySyncSnapshot must not
        // clobber an existing completedAt just because the payload doesn't carry the field.
        val snapshot = JSONObject().apply {
            put(
                "conversations",
                JSONArray().put(
                    JSONObject().apply {
                        put("id", conversationId)
                        put("title", "Snapshot test")
                        put("created_at", 1000L)
                        put("updated_at", 2000L)
                    },
                ),
            )
            put("versions", JSONObject())
        }

        repository.applySyncSnapshot(snapshot.toString())

        val row = io.nexy.android.data.local.NexyDatabase.get(ApplicationProvider.getApplicationContext())
            .conversations().get(conversationId)
        assertEquals(555L, row?.completedAt)
    }
}
