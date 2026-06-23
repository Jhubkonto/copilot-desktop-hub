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

object ChatCompleteNotificationManager {

    private const val CHANNEL_ID = "chat_complete"
    private var nextId = 3000

    fun show(context: Context, conversationId: String, title: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return

        val nm = context.getSystemService(NotificationManager::class.java)

        ensureChannel(context)

        val openIntent = PendingIntent.getActivity(
            context,
            conversationId.hashCode(),
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("deeplink", "chat/$conversationId")
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle("Response ready")
            .setContentText(title)
            .setContentIntent(openIntent)
            .setAutoCancel(true)
            .build()

        nm.notify(nextId++, notification)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = android.app.NotificationChannel(
            CHANNEL_ID,
            "Chat notifications",
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        nm.createNotificationChannel(channel)
    }
}
