package io.nexy.android

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.google.firebase.messaging.FirebaseMessaging
import io.nexy.android.notification.NexyFcmService

class NexyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        io.nexy.android.ui.theme.ThemePreferenceStore.init(this)
        io.nexy.android.data.WsRepository.init(this)
        val channel = NotificationChannel(
            APPROVAL_CHANNEL_ID,
            "Tool Approvals",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Prompts to approve or reject tool calls from the desktop app"
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
        // FCM auto-init is disabled so a placeholder google-services.json doesn't cause errors.
        // Fetch the token manually so it is sent to the desktop on every startup.
        // This fails silently when real Firebase credentials are not configured.
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                val deviceId = NexyFcmService.getOrCreateDeviceId(this)
                io.nexy.android.data.WsRepository.sendOrQueue(
                    "mobile:fcm-token",
                    mapOf("deviceId" to deviceId, "token" to token)
                )
            }
    }

    companion object {
        const val APPROVAL_CHANNEL_ID = "nexy_approvals"
    }
}
