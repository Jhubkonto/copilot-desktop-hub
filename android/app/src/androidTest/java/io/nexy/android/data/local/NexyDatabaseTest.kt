package io.nexy.android.data.local

import android.content.Context
import androidx.room.Room
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NexyDatabaseTest {
    private lateinit var database: NexyDatabase

    @Before
    fun createDatabase() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, NexyDatabase::class.java)
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun closeDatabase() {
        database.close()
    }

    @Test
    fun storesOfflineConversationMessageAndOutboxAtomically() = runBlocking {
        val now = 100L
        database.conversations().upsert(
            ConversationEntity(
                id = "conversation-1",
                title = "Offline",
                createdAt = now,
                updatedAt = now,
                localVersion = 1,
                syncStatus = SyncStatus.PENDING,
            ),
        )
        database.messages().upsert(
            MessageEntity(
                id = "message-1",
                conversationId = "conversation-1",
                role = "user",
                content = "hello",
                timestamp = now,
                localVersion = 1,
                syncStatus = SyncStatus.PENDING,
            ),
        )
        database.sync().enqueue(
            OutboxEntity(
                operationId = UUID.randomUUID().toString(),
                deviceId = "android-1",
                deviceSequence = 1,
                entityType = "message",
                entityId = "message-1",
                operation = "upsert",
                payloadJson = "{}",
                baseRemoteVersion = 0,
                createdAt = now,
            ),
        )

        assertEquals("Offline", database.conversations().observeAll().first().single().title)
        assertEquals("hello", database.messages().getForConversation("conversation-1").single().content)
        assertEquals(1, database.sync().pendingOutbox(Long.MAX_VALUE, 100).size)
    }

    @Test
    fun enforcesDeviceSequenceIdempotency() = runBlocking {
        val first = OutboxEntity(
            operationId = "operation-1",
            deviceId = "android-1",
            deviceSequence = 1,
            entityType = "project",
            entityId = "project-1",
            operation = "upsert",
            payloadJson = "{}",
            baseRemoteVersion = 0,
            createdAt = 1,
        )
        val duplicate = first.copy(operationId = "operation-2")

        assertTrue(database.sync().enqueue(first) >= 0)
        assertEquals(-1L, database.sync().enqueue(duplicate))
        assertEquals(1, database.sync().observeOutbox().first().size)
    }

    @Test
    fun exposesOnlyUnresolvedConflicts() = runBlocking {
        val conflict = ConflictEntity(
            id = "conflict-1",
            entityType = "conversation",
            entityId = "conversation-1",
            field = "title",
            localValueJson = "\"Android\"",
            remoteValueJson = "\"Desktop\"",
            localVersion = 2,
            remoteVersion = 2,
            createdAt = 1,
        )
        database.sync().upsertConflict(conflict)
        assertEquals(1, database.sync().observeConflicts().first().size)

        database.sync().resolveConflict("conflict-1", "remote", 2)
        assertTrue(database.sync().observeConflicts().first().isEmpty())
    }

    @Test
    fun rollsBackEntityAndOutboxTogether() = runBlocking {
        runCatching {
            database.withTransaction {
                database.projects().upsert(
                    ProjectEntity(
                        id = "project-rollback",
                        name = "Must roll back",
                        color = "blue",
                        createdAt = 1,
                        updatedAt = 1,
                        syncStatus = SyncStatus.PENDING,
                    ),
                )
                database.sync().enqueue(
                    OutboxEntity(
                        operationId = "operation-rollback",
                        deviceId = "android-1",
                        deviceSequence = 99,
                        entityType = "project",
                        entityId = "project-rollback",
                        operation = "upsert",
                        payloadJson = "{}",
                        baseRemoteVersion = 0,
                        createdAt = 1,
                    ),
                )
                error("fault injection")
            }
        }

        assertEquals(null, database.projects().get("project-rollback"))
        assertTrue(database.sync().observeOutbox().first().none { it.operationId == "operation-rollback" })
    }

    @Test
    fun rejectsSwitchingToADifferentDatasetIdentity() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("nexy_device_identity", Context.MODE_PRIVATE)
            .edit()
            .remove("dataset_id")
            .commit()
        val repository = LocalDataRepository.get(context)

        assertTrue(repository.bindDataset("dataset-a"))
        assertTrue(repository.bindDataset("dataset-a"))
        assertTrue(!repository.bindDataset("dataset-b"))
    }

    @Test
    fun markFailedBackoffExcludesOperationFromPendingOutboxUntilItElapses() = runBlocking {
        val operation = OutboxEntity(
            operationId = "operation-backoff",
            deviceId = "android-1",
            deviceSequence = 1,
            entityType = "project",
            entityId = "project-1",
            operation = "upsert",
            payloadJson = "{}",
            baseRemoteVersion = 0,
            createdAt = 1,
        )
        database.sync().enqueue(operation)

        // Regression coverage for the sync tight-loop bug: discardOrphanedOperations() used to call
        // retry() on every non-orphaned failed operation right after markFailed() set a backoff,
        // resetting nextAttemptAt back to 0 and making it instantly eligible for re-push again —
        // combined with an immediate flushStandaloneOutbox() call, that looped forever. The fix
        // relies on markFailed()'s backoff actually holding until it elapses, which this asserts
        // directly at the DAO level.
        val now = 1_000L
        database.sync().markFailed("operation-backoff", now + 5_000L, "boom")

        assertTrue(database.sync().pendingOutbox(now, 100).none { it.operationId == "operation-backoff" })
        assertEquals(1, database.sync().failedOutbox().size)

        assertTrue(database.sync().pendingOutbox(now + 5_000L, 100).any { it.operationId == "operation-backoff" })

        // retry() is reserved for the user-initiated "Retry change" action — it resets nextAttemptAt
        // to 0, which is exactly why the automatic sweep must never call it on a non-orphaned op.
        database.sync().retry("operation-backoff")
        assertTrue(database.sync().pendingOutbox(now, 100).any { it.operationId == "operation-backoff" })
    }

    @Test
    fun recoversInterruptedAssistantTurnAsRetryableFailure() = runBlocking {
        database.messages().upsert(
            MessageEntity(
                id = "partial-assistant",
                conversationId = "conversation-1",
                role = "assistant",
                content = "partial output",
                timestamp = 1,
                partial = true,
            ),
        )

        database.messages().recoverInterruptedTurns()

        val recovered = requireNotNull(database.messages().get("partial-assistant"))
        assertTrue(!recovered.partial)
        assertTrue(recovered.sendFailed)
        assertEquals("partial output", recovered.content)
    }
}
