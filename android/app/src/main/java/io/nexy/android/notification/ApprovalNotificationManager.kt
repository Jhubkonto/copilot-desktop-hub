package io.nexy.android.notification

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import io.nexy.android.MainActivity
import io.nexy.android.NexyApp

object ApprovalNotificationManager {

    const val NOTIFICATION_ID = 1001
    const val ACTION_APPROVE = "io.nexy.android.ACTION_APPROVE"
    const val ACTION_REJECT = "io.nexy.android.ACTION_REJECT"
    const val EXTRA_REQUEST_ID = "requestId"

    fun show(context: Context, requestId: String, toolName: String) {
        val nm = context.getSystemService(NotificationManager::class.java)

        val openIntent = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val approveIntent = PendingIntent.getBroadcast(
            context, 1,
            Intent(context, ApprovalActionReceiver::class.java).apply {
                action = ACTION_APPROVE
                putExtra(EXTRA_REQUEST_ID, requestId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val rejectIntent = PendingIntent.getBroadcast(
            context, 2,
            Intent(context, ApprovalActionReceiver::class.java).apply {
                action = ACTION_REJECT
                putExtra(EXTRA_REQUEST_ID, requestId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = Notification.Builder(context, NexyApp.APPROVAL_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Tool Request")
            .setContentText(toolName)
            .setContentIntent(openIntent)
            .setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, "Approve", approveIntent).build())
            .addAction(Notification.Action.Builder(null, "Reject", rejectIntent).build())
            .build()

        nm.notify(NOTIFICATION_ID, notification)
    }

    fun cancel(context: android.content.Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }
}
