package io.nexy.android.notification

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.content.ContextCompat
import io.nexy.android.MainActivity
import io.nexy.android.NexyApp

object ApprovalNotificationManager {

    const val NOTIFICATION_ID = 1001
    const val ACTION_APPROVE = "io.nexy.android.ACTION_APPROVE"
    const val ACTION_REJECT = "io.nexy.android.ACTION_REJECT"
    const val EXTRA_REQUEST_ID = "requestId"

    fun show(context: Context, requestId: String, toolName: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return

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
            .setCategory(Notification.CATEGORY_STATUS)
            .addAction(Notification.Action.Builder(null, "Approve", approveIntent).build())
            .addAction(Notification.Action.Builder(null, "Reject", rejectIntent).build())
            .build()

        nm.notify(NOTIFICATION_ID, notification)
    }

    fun cancel(context: android.content.Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
    }

    fun vibrateDecision(context: Context, approved: Boolean) {
        val durationMs = if (approved) 50L else 100L
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        } ?: return

        if (!vibrator.hasVibrator()) return
        vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
    }
}
