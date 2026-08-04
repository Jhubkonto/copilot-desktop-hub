package io.nexy.android.navigation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationDeeplinkNavigationTest {
    @Test
    fun coldStartDefersNavigationUntilTheNavHostLeavesSplash() {
        assertTrue(shouldDeferNotificationDeeplink(null))
        assertTrue(shouldDeferNotificationDeeplink("splash"))
    }

    @Test
    fun runningAppNavigatesImmediatelyFromHomeOrAnotherChat() {
        assertFalse(shouldDeferNotificationDeeplink("home"))
        assertFalse(shouldDeferNotificationDeeplink(CHAT_ROUTE))
        assertFalse(shouldDeferNotificationDeeplink("settings"))
    }
}
