package io.nexy.android

import android.app.Activity
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Bundle
import com.google.firebase.messaging.FirebaseMessaging
import io.nexy.android.notification.NexyFcmService

class NexyApp : Application() {
    private var resumedActivityCount = 0

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                resumedActivityCount++
                isInForeground = true
            }
            override fun onActivityPaused(activity: Activity) {
                resumedActivityCount--
                if (resumedActivityCount <= 0) {
                    resumedActivityCount = 0
                    isInForeground = false
                }
            }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
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
        @Volatile var isInForeground: Boolean = false
            internal set
    }
}
