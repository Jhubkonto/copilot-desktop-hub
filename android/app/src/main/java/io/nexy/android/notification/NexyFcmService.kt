package io.nexy.android.notification

import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import org.json.JSONObject
import java.util.UUID

class NexyFcmService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        val deviceId = getOrCreateDeviceId(this)
        WsRepository.sendOrQueue("mobile:fcm-token", mapOf("deviceId" to deviceId, "token" to token))
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["type"] != "tool:approval-request") return
        val requestId = data["requestId"] ?: return
        val toolName = data["toolName"] ?: return
        val args: Map<String, Any> = runCatching {
            val obj = JSONObject(data["args"] ?: "{}")
            val map = mutableMapOf<String, Any>()
            val keys = obj.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                map[key] = obj.get(key)
            }
            map
        }.getOrDefault(emptyMap())
        ApprovalNotificationManager.show(this, requestId, toolName, args)
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
