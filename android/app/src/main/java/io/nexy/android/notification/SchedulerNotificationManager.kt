package io.nexy.android.notification

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import io.nexy.android.MainActivity

object SchedulerNotificationManager {

    private const val CHANNEL_ID = "scheduler_runs"
    fun show(context: Context, taskId: String, taskName: String, success: Boolean, requiresApproval: Boolean = false) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return

        val destination = ActivityBadgeManager.scheduledDestination(taskId)
        ActivityBadgeManager.record(context, destination)
        val nm = context.getSystemService(NotificationManager::class.java)

        ensureChannel(context)

        val openIntent = PendingIntent.getActivity(
            context,
            taskId.hashCode(),
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("deeplink", "scheduled/$taskId")
                putExtra(ActivityBadgeManager.EXTRA_DESTINATION, destination)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val title = when {
            requiresApproval -> "Review required: $taskName"
            success -> "Task completed: $taskName"
            else -> "Task failed: $taskName"
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(io.nexy.android.R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentIntent(openIntent)
            .setAutoCancel(true)
            .setNumber(1)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .build()

        nm.notify(ActivityBadgeManager.notificationId(destination), notification)
    }

    private fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = android.app.NotificationChannel(
            CHANNEL_ID,
            "Scheduled task runs",
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        channel.setShowBadge(true)
        nm.createNotificationChannel(channel)
    }
}
