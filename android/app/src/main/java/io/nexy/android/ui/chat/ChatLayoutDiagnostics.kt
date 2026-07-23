package io.nexy.android.ui.chat

import io.nexy.android.data.WsRepository
import java.util.concurrent.ConcurrentHashMap

/**
 * Low-volume diagnostics for the intermittent one-glyph-wide chat layout. Only changed
 * measurements are retained, so normal recomposition and streamed chunks do not flood the
 * in-app debug log. No message content is logged.
 */
internal object ChatLayoutDiagnostics {
    private const val SUSPICIOUS_WIDTH_PX = 96
    private const val MAX_SIGNATURES = 400
    private val lastSignatures = ConcurrentHashMap<String, String>()

    fun record(
        messageKey: String,
        stage: String,
        widthPx: Int,
        heightPx: Int,
        details: String = "",
    ) {
        val safeKey = messageKey.ifBlank { "blank" }.take(80)
        val signatureKey = "$safeKey:$stage"
        val signature = "${widthPx}x$heightPx $details"
        if (lastSignatures.put(signatureKey, signature) == signature) return
        if (lastSignatures.size > MAX_SIGNATURES) lastSignatures.clear()

        val suspicious = widthPx in 1 until SUSPICIOUS_WIDTH_PX ||
            (details.contains("layoutWidth=0") && !details.contains("lines=-1"))
        WsRepository.appendDebugLog(
            tag = if (suspicious) "CHAT_LAYOUT_BUG" else "chat-layout",
            message = "key=$safeKey stage=$stage size=${widthPx}x$heightPx" +
                if (details.isBlank()) "" else " $details",
        )
    }

}
