package io.nexy.android.data

import org.junit.Assert.assertEquals
import org.junit.Test

class SyncErrorMessagesTest {

    @Test
    fun mapsForeignKeyConstraintErrorToPlainLanguage() {
        val result = humanizeSyncError("FOREIGN KEY constraint failed")
        assertEquals(
            "This change referenced data that no longer exists (for example, a message in a " +
                "conversation that was deleted) and was cleaned up automatically.",
            result,
        )
    }

    @Test
    fun mapsForeignKeyConstraintErrorRegardlessOfCase() {
        val result = humanizeSyncError("SQLiteConstraintException: foreign key constraint failed (code 787)")
        assertEquals(true, result.startsWith("This change referenced data that no longer exists"))
    }

    @Test
    fun passesThroughUnrecognizedErrorsUnchanged() {
        assertEquals("Connection timed out", humanizeSyncError("Connection timed out"))
    }

    @Test
    fun handlesNullAndBlank() {
        assertEquals("Synchronization failed for an unknown reason.", humanizeSyncError(null))
        assertEquals("Synchronization failed for an unknown reason.", humanizeSyncError("  "))
    }
}
