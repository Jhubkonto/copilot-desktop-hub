package io.nexy.android.ui.settings

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
