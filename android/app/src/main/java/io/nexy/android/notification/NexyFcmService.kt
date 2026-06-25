package io.nexy.android.notification

import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.nexy.android.NexyApp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.PairedServerConfig
import io.nexy.android.data.PairedServerStore
import io.nexy.android.data.WsRepository
import org.json.JSONObject
import java.util.UUID

class NexyFcmService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        val deviceId = getOrCreateDeviceId(this)
        WsRepository.sendOrQueue("mobile:fcm-token", mapOf("deviceId" to deviceId, "token" to token))
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (NexyApp.isInForeground) return
        val data = message.data
        when (data["type"]) {
            "tool:approval-request" -> {
                val requestId = data["requestId"] ?: return
                val toolName = data["toolName"] ?: return
                ApprovalNotificationManager.show(this, requestId, toolName)
            }

            "scheduler:run-completed" -> {
                val taskId = data["taskId"] ?: return
                val taskName = data["taskName"] ?: "Scheduled task"
                SchedulerNotificationManager.show(this, taskId, taskName, success = true)
            }

            "scheduler:run-failed" -> {
                val taskId = data["taskId"] ?: return
                val taskName = data["taskName"] ?: "Scheduled task"
                SchedulerNotificationManager.show(this, taskId, taskName, success = false)
            }

            "chat:complete" -> {
                val convId = data["conversationId"] ?: return
                val title = data["title"] ?: "Chat"
                ChatCompleteNotificationManager.show(this, convId, title)
            }

            "desktop:online" -> {
                val wsUrl = data["wsUrl"]?.takeIf { it.isNotBlank() } ?: return
                handleDesktopOnline(wsUrl)
            }

            "desktop:ip-changed" -> {
                val wsUrl = data["wsUrl"]?.takeIf { it.isNotBlank() } ?: return
                handleIpChanged(wsUrl)
            }
        }
    }

    private fun handleDesktopOnline(wsUrl: String) {
        val store = runCatching { PairedServerStore(this) }.getOrNull() ?: return
        val active = store.activeProfile()
        val newConfig = PairedServerConfig.fromUrl(wsUrl)
        if (newConfig != null && active != null && newConfig.endpoint != active.endpoint) {
            store.save(newConfig.copy(certFingerprint = active.certFingerprint))
        }
        if (WsRepository.connectionState.value != ConnectionState.CONNECTED &&
            WsRepository.connectionState.value != ConnectionState.CONNECTING) {
            WsRepository.connectFromStore()
        }
    }

    private fun handleIpChanged(wsUrl: String) {
        val store = runCatching { PairedServerStore(this) }.getOrNull() ?: return
        val active = store.activeProfile() ?: return
        val newConfig = PairedServerConfig.fromUrl(wsUrl) ?: return
        if (newConfig.endpoint != active.endpoint) {
            store.save(newConfig.copy(certFingerprint = active.certFingerprint))
        }
    }

    companion object {
        fun getOrCreateDeviceId(context: Context): String {
            val prefs = context.getSharedPreferences("nexy_preferences", Context.MODE_PRIVATE)
            return prefs.getString("device_id", null) ?: UUID.randomUUID().toString().also { id ->
                prefs.edit().putString("device_id", id).apply()
            }
        }
    }
}
