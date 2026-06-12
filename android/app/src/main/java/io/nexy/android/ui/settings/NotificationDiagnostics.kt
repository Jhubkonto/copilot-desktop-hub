package io.nexy.android.ui.settings

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.nexy.android.NexyApp

internal fun readNotificationDiagnostics(app: Application): NotificationDiagnostics {
    val permissionRequired = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    val permissionGranted = !permissionRequired ||
        ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    val appNotificationsEnabled = NotificationManagerCompat.from(app).areNotificationsEnabled()
    val notificationManager = app.getSystemService(NotificationManager::class.java)
    val approvalChannelEnabled = notificationManager
        ?.getNotificationChannel(NexyApp.APPROVAL_CHANNEL_ID)
        ?.importance
        ?.let { it != NotificationManager.IMPORTANCE_NONE }
        ?: true

    return NotificationDiagnostics(
        permissionRequired = permissionRequired,
        permissionGranted = permissionGranted,
        appNotificationsEnabled = appNotificationsEnabled,
        approvalChannelEnabled = approvalChannelEnabled,
    )
}

data class NotificationDiagnostics(
    val permissionRequired: Boolean,
    val permissionGranted: Boolean,
    val appNotificationsEnabled: Boolean,
    val approvalChannelEnabled: Boolean,
) {
    val approvalNotificationsEnabled: Boolean
        get() = (!permissionRequired || permissionGranted) &&
            appNotificationsEnabled &&
            approvalChannelEnabled
}

fun approvalNotificationStatusLabel(state: NotificationDiagnostics): String =
    if (state.approvalNotificationsEnabled) "Approval notifications enabled" else "Approval notifications need attention"

fun approvalNotificationStatusDetail(state: NotificationDiagnostics): String =
    when {
        state.permissionRequired && !state.permissionGranted ->
            "Android notification permission is denied, so approval requests only appear while the app is open."
        !state.appNotificationsEnabled ->
            "App notifications are disabled in Android settings."
        !state.approvalChannelEnabled ->
            "The Tool Approvals notification channel is disabled."
        else ->
            "Approval requests can appear as high-priority notifications with Approve and Reject actions."
    }

fun notificationPermissionLabel(state: NotificationDiagnostics): String =
    if (!state.permissionRequired) "Not required on this Android version"
    else if (state.permissionGranted) "Granted"
    else "Denied"
