package io.nexy.android.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import io.nexy.android.service.NexySpeechService

class ReadAloudActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) return
        if (intent.action != "io.nexy.android.ACTION_LISTEN_SUMMARY") return

        val conversationId = intent.getStringExtra("conversationId") ?: return
        val summary = intent.getStringExtra("summary") ?: return

        val serviceIntent = Intent(context, NexySpeechService::class.java).apply {
            putExtra("conversationId", conversationId)
            putExtra("summary", summary)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(context, serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }
}
