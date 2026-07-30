package io.nexy.android.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.nexy.android.service.NexySpeechService
import io.nexy.android.service.SpokenOutputKind

class ReadAloudActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) return
        if (intent.action != "io.nexy.android.ACTION_LISTEN_SUMMARY") return

        val conversationId = intent.getStringExtra("conversationId") ?: return
        val summary = intent.getStringExtra("summary") ?: return

        NexySpeechService.play(
            context = context,
            text = summary,
            messageId = null,
            conversationId = conversationId,
            kind = SpokenOutputKind.NOTIFICATION_SUMMARY,
        )
    }
}
