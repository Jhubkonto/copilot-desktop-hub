package io.nexy.android.ui.chat

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

private const val SKELETON_HEIGHT_DP = 80

/**
 * Bridges the code block's in-page copy button and height reporting back into Kotlin.
 * `@JavascriptInterface` methods run on a non-UI thread — both callbacks hop to the main
 * thread before touching Compose state or Android views.
 */
private class CodeBlockBridge(
    private val context: Context,
    private val onHeightPx: (Int) -> Unit,
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onCopy(text: String) {
        mainHandler.post {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("code", text))
        }
    }

    @JavascriptInterface
    fun reportHeight(px: Int) {
        mainHandler.post { onHeightPx(px) }
    }
}

@Composable
fun CodeBlockWebView(language: String?, code: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val density = LocalDensity.current
    var measuredHeight by remember(code, language) { mutableIntStateOf(0) }
    val heightDp: Dp = if (measuredHeight > 0) {
        with(density) { measuredHeight.toDp() }
    } else {
        SKELETON_HEIGHT_DP.dp
    }

    AndroidView(
        modifier = modifier.fillMaxWidth().height(heightDp),
        factory = { ctx ->
            WebView(ctx).apply {
                // JS is required to run the bundled, locally-packaged highlight.js — this
                // WebView never loads remote content or navigates, so the usual JS/XSS risk
                // from untrusted pages doesn't apply.
                @SuppressLint("SetJavaScriptEnabled")
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = false
                setBackgroundColor(0x00000000)
                webViewClient = WebViewClient()
                addJavascriptInterface(
                    CodeBlockBridge(context) { px -> measuredHeight = px },
                    "AndroidBridge",
                )
            }
        },
        update = { webView ->
            val html = buildCodeBlockHtml(language, code)
            webView.loadDataWithBaseURL("file:///android_asset/codeblock/", html, "text/html", "utf-8", null)
        },
    )
}
