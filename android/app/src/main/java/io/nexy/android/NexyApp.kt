package io.nexy.android

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class NexyApp : Application() {
    override fun onCreate() {
        super.onCreate()
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
    }

    companion object {
        const val APPROVAL_CHANNEL_ID = "nexy_approvals"
    }
}
