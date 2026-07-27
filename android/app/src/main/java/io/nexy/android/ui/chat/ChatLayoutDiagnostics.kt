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
    private val heightByKey = ConcurrentHashMap<String, Int>()

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

    /**
     * Late-growth detector for the intermittent truncated-tail bug. Tracks the last non-zero height
     * seen per (stage,key) and logs only when a subsequent measurement is TALLER than one already
     * reported — i.e. the element grew after it had already been laid out at a real height. The
     * initial 0 -> N measurement is intentionally ignored (that is the normal first layout, not the
     * bug). Correlating streams tells us who grew late and whether the enclosing row followed:
     *  - stage="holder": the Markwon AndroidView's own measured height grew after settling.
     *  - stage="row": the LazyColumn item that hosts it re-measured to the taller height.
     * A "holder" growth WITHOUT a matching "row" growth for the same reply is the smoking gun — the
     * inner content grew but the lazy row kept its stale (shorter) committed height, clipping the tail.
     */
    fun noteHeight(key: String, stage: String, heightPx: Int) {
        if (heightPx <= 0) return
        val sig = "$stage:${key.ifBlank { "blank" }.take(80)}"
        val prev = heightByKey.put(sig, heightPx) ?: 0
        if (prev in 1 until heightPx) {
            if (heightByKey.size > MAX_SIGNATURES) heightByKey.clear()
            WsRepository.appendDebugLog(
                tag = "CHAT_LATE_GROWTH",
                message = "key=${key.take(80)} stage=$stage grew ${prev}px -> ${heightPx}px (+${heightPx - prev})",
            )
        }
    }

    /**
     * Scroll/auto-follow re-pin events. Records the settled geometry of the last item relative to the
     * viewport and whether a re-pin fired or was skipped (with the reason). Deduplicated on [stage] so
     * a steady resting state logs once rather than every frame. `tailBelowFold=true` means the last
     * visible item extends past the viewport bottom — if that shows up alongside `canScrollFwd=false`
     * (auto-follow believing it is done) it is direct evidence the tail is clipped from a stale
     * measurement, which is what we are hunting.
     */
    fun recordScroll(stage: String, details: String) {
        val signatureKey = "scroll:$stage"
        if (lastSignatures.put(signatureKey, details) == details) return
        if (lastSignatures.size > MAX_SIGNATURES) lastSignatures.clear()
        val suspicious = details.contains("tailBelowFold=true")
        WsRepository.appendDebugLog(
            tag = if (suspicious) "CHAT_SCROLL_BUG" else "chat-scroll",
            message = "stage=$stage $details",
        )
    }
}
