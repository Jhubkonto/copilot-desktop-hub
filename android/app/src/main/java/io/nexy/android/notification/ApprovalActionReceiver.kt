package io.nexy.android.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.NotificationManager
import io.nexy.android.data.WsRepository

class ApprovalActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val requestId = intent.getStringExtra(ApprovalNotificationManager.EXTRA_REQUEST_ID) ?: return
        when (intent.action) {
            ApprovalNotificationManager.ACTION_APPROVE ->
                WsRepository.send("tool:approve", mapOf("requestId" to requestId))
            ApprovalNotificationManager.ACTION_REJECT ->
                WsRepository.send("tool:reject", mapOf("requestId" to requestId))
        }
        context.getSystemService(NotificationManager::class.java)
            ?.cancel(ApprovalNotificationManager.NOTIFICATION_ID)
    }
}
