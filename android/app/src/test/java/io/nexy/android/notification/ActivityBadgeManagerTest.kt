package io.nexy.android.notification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ActivityBadgeManagerTest {
    @Test
    fun destinationKeysAreStableAndNamespaced() {
        assertEquals("chat:conversation-1", ActivityBadgeManager.chatDestination("conversation-1"))
        assertEquals("scheduled:task-1", ActivityBadgeManager.scheduledDestination("task-1"))
        assertEquals("approval:request-1", ActivityBadgeManager.approvalDestination("request-1"))
    }

    @Test
    fun stableNotificationIdsDifferAcrossDestinationKinds() {
        val chatId = ActivityBadgeManager.notificationId("chat:same-id")
        val taskId = ActivityBadgeManager.notificationId("scheduled:same-id")

        assertEquals(chatId, ActivityBadgeManager.notificationId("chat:same-id"))
        assertNotEquals(chatId, taskId)
    }
}
