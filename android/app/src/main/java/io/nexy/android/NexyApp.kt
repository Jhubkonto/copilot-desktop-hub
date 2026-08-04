package io.nexy.android

import android.app.Activity
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Bundle
import com.google.firebase.messaging.FirebaseMessaging
import io.nexy.android.notification.NexyFcmService
import io.nexy.android.share.ShareTargetPublisher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class NexyApp : Application() {
    private var resumedActivityCount = 0

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                resumedActivityCount++
                if (!isInForeground) {
                    isInForeground = true
                    io.nexy.android.data.WsRepository.onAppForegrounded()
                    io.nexy.android.data.WsRepository.send("mobile:app-foreground", emptyMap())
                }
            }
            override fun onActivityPaused(activity: Activity) {
                resumedActivityCount--
                if (resumedActivityCount <= 0) {
                    resumedActivityCount = 0
                    isInForeground = false
                    io.nexy.android.data.WsRepository.send("mobile:app-background", emptyMap())
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
        CoroutineScope(Dispatchers.Default).launch {
            io.nexy.android.data.WsRepository.conversations
                .map { rows -> rows.map { Triple(it.id, it.title, it.updated_at) } }
                .distinctUntilChanged()
                .collect { ShareTargetPublisher.publish(this@NexyApp, io.nexy.android.data.WsRepository.conversations.value) }
        }
        val runningBuild = io.nexy.android.ui.settings.UpdateInstallVerification.runningBuild(this)
        android.util.Log.i(
            "NexyBuild",
            "APP_START version=${runningBuild.versionName} code=${runningBuild.versionCode} " +
                "buildId=${runningBuild.buildId} commit=${runningBuild.commitSha} " +
                "dirty=${runningBuild.sourceDirty} builtAt=${runningBuild.builtAt}",
        )
        io.nexy.android.data.WsRepository.appendDebugLog(
            "app-build",
            "APP_START version=${runningBuild.versionName} code=${runningBuild.versionCode} " +
                "buildId=${runningBuild.buildId} commit=${runningBuild.commitSha} " +
                "dirty=${runningBuild.sourceDirty} builtAt=${runningBuild.builtAt}",
        )
        io.nexy.android.ui.settings.UpdateInstallVerification.verifyPendingInstall(this)
        val channel = NotificationChannel(
            APPROVAL_CHANNEL_ID,
            "Tool Approvals",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Prompts to approve or reject tool calls from the desktop app"
            setShowBadge(true)
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
