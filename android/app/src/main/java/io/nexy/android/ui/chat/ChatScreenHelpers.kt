package io.nexy.android.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Bitmap
import android.util.LruCache

// Bounded by memory, not entry count, since attachment thumbnails vary in size. Decoding a
// bitmap from a base64 data URL is genuinely expensive, synchronous, main-thread work
// (Base64.decode + BitmapFactory.decodeByteArray) — a user message bubble with an image
// attachment is its own LazyColumn item, so scrolling it fully off-screen and back (the
// normal recycling any sufficiently long conversation goes through) used to re-run that
// decode from scratch every time, which is a real jitter contributor for image-heavy chats.
// A flat 16MB cap is plenty for "thumbnail"-sized images while staying well clear of OOM risk
// even on lower-memory devices.
private val decodedBitmapCache = object : LruCache<String, Bitmap>(16 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
}

fun decodeDataUrl(dataUrl: String): Bitmap? {
    decodedBitmapCache.get(dataUrl)?.let { return it }
    val decoded = runCatching {
        val bytes = android.util.Base64.decode(dataUrl.substringAfter(','), android.util.Base64.DEFAULT)
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }.getOrNull() ?: return null
    decodedBitmapCache.put(dataUrl, decoded)
    return decoded
}

fun copyMessage(clipboardManager: ClipboardManager, text: String) {
    if (text.isNotBlank()) clipboardManager.setPrimaryClip(ClipData.newPlainText("Nexy message", text))
}
