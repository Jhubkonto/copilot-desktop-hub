package io.nexy.android.ui.chat

import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.text.AnnotatedString

fun decodeDataUrl(dataUrl: String): android.graphics.Bitmap? = runCatching {
    val bytes = android.util.Base64.decode(dataUrl.substringAfter(','), android.util.Base64.DEFAULT)
    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}.getOrNull()

fun copyMessage(clipboardManager: ClipboardManager, text: String) {
    if (text.isNotBlank()) clipboardManager.setText(AnnotatedString(text))
}
