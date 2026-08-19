package io.nexy.android.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationDiagnosticsTest {
    @Test
    fun enabledWhenPermissionAppAndChannelAllowNotifications() {
        val state = NotificationDiagnostics(
            permissionRequired = true,
            permissionGranted = true,
            appNotificationsEnabled = true,
            approvalChannelEnabled = true,
        )

        assertTrue(state.approvalNotificationsEnabled)
        assertEquals("Approval notifications enabled", approvalNotificationStatusLabel(state))
        assertEquals("Granted", notificationPermissionLabel(state))
    }

    @Test
    fun deniedRuntimePermissionBlocksApprovalNotifications() {
        val state = NotificationDiagnostics(
            permissionRequired = true,
            permissionGranted = false,
            appNotificationsEnabled = true,
            approvalChannelEnabled = true,
        )

        assertFalse(state.approvalNotificationsEnabled)
        assertEquals("Approval notifications need attention", approvalNotificationStatusLabel(state))
        assertEquals("Denied", notificationPermissionLabel(state))
        assertEquals(
            "Android notification permission is denied, so approval requests only appear while the app is open.",
            approvalNotificationStatusDetail(state),
        )
    }

    @Test
    fun preAndroid13DoesNotRequireRuntimePermission() {
        val state = NotificationDiagnostics(
            permissionRequired = false,
            permissionGranted = false,
            appNotificationsEnabled = true,
            approvalChannelEnabled = true,
        )

        assertTrue(state.approvalNotificationsEnabled)
        assertEquals("Not required on this Android version", notificationPermissionLabel(state))
    }

    @Test
    fun firebaseBuildStatusExplainsOfflinePushRequirement() {
        val state = NotificationDiagnostics(
            permissionRequired = true,
            permissionGranted = true,
            appNotificationsEnabled = true,
            approvalChannelEnabled = true,
            firebaseConfigured = false,
        )

        assertEquals("Firebase client not included", offlinePushStatusLabel(state))
        assertEquals(
            "This APK was built without Firebase configuration, so offline push notifications are unavailable.",
            offlinePushStatusDetail(state),
        )
    }
}
