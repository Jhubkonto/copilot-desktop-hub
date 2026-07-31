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

/** Notifies the user when a debrief/quiz finishes generating while they're not looking at the
 *  chat it belongs to — mirrors ChatCompleteNotificationManager's pattern exactly. */
object GenerationNotificationManager {

    private const val CHANNEL_ID = "generation_complete"
    fun show(context: Context, conversationId: String, kind: String, title: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return

        val destination = ActivityBadgeManager.chatDestination(conversationId)
        ActivityBadgeManager.record(context, destination)
        val nm = context.getSystemService(NotificationManager::class.java)

        ensureChannel(context)

        val openIntent = PendingIntent.getActivity(
            context,
            "$kind-$conversationId".hashCode(),
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("deeplink", "chat/$conversationId")
                putExtra(ActivityBadgeManager.EXTRA_DESTINATION, destination)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val contentTitle = if (kind == "quiz") "Quiz ready" else "Debrief ready"

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(contentTitle)
            .setContentText(title)
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
            "Generation notifications",
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        channel.setShowBadge(true)
        nm.createNotificationChannel(channel)
    }
}
