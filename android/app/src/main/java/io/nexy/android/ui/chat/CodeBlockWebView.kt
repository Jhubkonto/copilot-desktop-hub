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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

// Mirrors the CSS constants in theme.css exactly: .code-header's padding+content (~32dp),
// pre's 16px top+bottom padding (32dp) plus its 1px border top+bottom (~2dp), and line-height:
// 1.6 at font-size: 13px (13*1.6 ≈ 21dp per line). `pre { overflow-x: auto }` means lines never
// wrap, so the raw newline count maps directly to rendered line count — no width-dependent
// uncertainty to account for.
private const val CODE_HEADER_HEIGHT_DP = 32
private const val CODE_PRE_VERTICAL_PADDING_DP = 34
private const val CODE_LINE_HEIGHT_DP = 21

/**
 * Estimates the rendered height before the WebView has loaded/measured anything, synchronously
 * from the code's line count. `measuredHeight` only becomes authoritative once the async JS
 * reportHeight round-trip completes — until then this is what backs the Compose layout height.
 * A rough guess (the previous flat SKELETON_HEIGHT_DP) means a LARGE correction lands once the
 * real height arrives, and since every item in the chat list has `Modifier.animateItem()`
 * applied, that correction animates every item below it into its new position over 320ms — a
 * visible ripple that can read as jitter well past the code block itself, including at a
 * completely unrelated boundary like the preceding user message. Estimating close to the real
 * height up front leaves little for the async correction to actually change.
 */
private fun estimateCodeBlockHeightDp(code: String): Int {
    val lineCount = code.count { it == '\n' } + 1
    return CODE_HEADER_HEIGHT_DP + CODE_PRE_VERTICAL_PADDING_DP + lineCount * CODE_LINE_HEIGHT_DP
}

/**
 * Caches the last-reported height per (language, code) pair for the lifetime of the process.
 * `CodeBlockWebView` is nested inline inside an `AssistantMessage` item rather than being its
 * own lazy item, so scrolling it fully off-screen and back disposes the composable *and* the
 * underlying native WebView — a fresh WebView reloads the HTML and re-runs the async
 * reportHeight round-trip every time. Without this cache that means every re-entry into the
 * viewport visibly snaps from the small skeleton height up to the real height, which is exactly
 * the jitter scrolling past code blocks. Seeding the initial height from a prior measurement of
 * the same content skips that visible jump for anything already seen this session.
 */
private object CodeBlockHeightCache {
    private val heights = mutableMapOf<Pair<String?, String>, Int>()

    fun get(language: String?, code: String): Int? = heights[language to code]

    fun put(language: String?, code: String, heightPx: Int) {
        heights[language to code] = heightPx
    }
}

/**
 * Bridges the code block's in-page copy/fullscreen buttons and height reporting back into
 * Kotlin. `@JavascriptInterface` methods run on a non-UI thread — every callback hops to the
 * main thread before touching Compose state or Android views.
 */
private class CodeBlockBridge(
    private val context: Context,
    private val onHeightPx: (Int) -> Unit,
    private val onFullscreenRequested: () -> Unit,
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

    @JavascriptInterface
    fun onFullscreen() {
        mainHandler.post { onFullscreenRequested() }
    }
}

@Composable
fun CodeBlockWebView(language: String?, code: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val density = LocalDensity.current
    var measuredHeight by remember(code, language) {
        mutableIntStateOf(CodeBlockHeightCache.get(language, code) ?: 0)
    }
    var showFullscreen by remember(code, language) { mutableStateOf(false) }
    val heightDp: Dp = if (measuredHeight > 0) {
        with(density) { measuredHeight.toDp() }
    } else {
        estimateCodeBlockHeightDp(code).dp
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
                // addJavascriptInterface intentionally NOT called here — see update{} below.
                // This factory only runs for a genuinely new WebView; a reused one (via
                // onReset, below) skips it entirely, and binding the bridge there instead
                // would leave a stale interface pointing at whichever composable instance
                // originally constructed this WebView attached forever.
            }
        },
        onReset = { webView ->
            // Real WebView construction is expensive (a full Chromium surface + JS context) —
            // AndroidView's factory re-runs it every time this composable is freshly mounted,
            // including every time LazyColumn recycles the message it's nested in back into
            // view. A message with several fenced code blocks scrolling back on-screen used to
            // mean that many fresh WebView constructions bursting into one frame. onReset is
            // Compose's own mechanism for reusing an already-constructed View instance instead
            // (see androidx.compose.ui.samples.ReusableAndroidViewInLazyColumnSample) — clear
            // the outgoing page here, same as that sample, before update{} loads this slot's
            // actual content.
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.clearHistory()
            webView.tag = null
        },
        update = { webView ->
            // AndroidView's update lambda re-runs on every recomposition of this node, not
            // just when `code`/`language` change — an unrelated state change bubbling down
            // from a parent (e.g. scroll-driven recomposition) would otherwise reload the
            // page from scratch each time. Besides being wasteful, a reload that lands mid-
            // flight while a previous load's async reportHeight callback is still pending is
            // exactly the kind of race that can pin `measuredHeight` to a value measured
            // against a stale, already-replaced page. Skipping reload when the HTML is
            // unchanged removes that race entirely.
            val html = buildCodeBlockHtml(language, code)
            if (webView.tag != html) {
                webView.tag = html
                // Rebound every time content actually (re)loads — covers both a genuinely
                // new WebView (factory just ran) and a reused one (onReset just cleared it):
                // either way the bridge must target *this* composable instance's callbacks,
                // not whichever instance last owned the WebView.
                webView.addJavascriptInterface(
                    CodeBlockBridge(
                        context = context,
                        onHeightPx = { px ->
                            measuredHeight = px
                            CodeBlockHeightCache.put(language, code, px)
                        },
                        onFullscreenRequested = { showFullscreen = true },
                    ),
                    "AndroidBridge",
                )
                webView.loadDataWithBaseURL("file:///android_asset/codeblock/", html, "text/html", "utf-8", null)
            }
        },
    )

    if (showFullscreen) {
        CodeBlockFullscreenDialog(
            language = language,
            code = code,
            onDismiss = { showFullscreen = false },
        )
    }
}

/**
 * Full-screen viewer for a code block whose content doesn't fit within the card's height-
 * bound WebView (heightIn caps the inline card so the surrounding chat list stays scrollable;
 * long blocks need their own scrollable viewport instead). Reuses the same HTML/CSS/highlight
 * pipeline as the inline card but sized to fill the dialog — the WebView's own native scrolling
 * (vertical for overflowing body content, horizontal via `pre`'s existing overflow-x) handles
 * the rest without any extra height-measurement plumbing.
 */
@Composable
private fun CodeBlockFullscreenDialog(
    language: String?,
    code: String,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                // Every other screen gets system-bar insets for free via Scaffold; a bare
                // Dialog does not, so without this the WebView's own header and the close
                // button both draw straight under the status bar (clock/battery icons
                // overlapping the code block's header row, close button nearly invisible
                // behind them).
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        @SuppressLint("SetJavaScriptEnabled")
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = false
                        setBackgroundColor(0x00000000)
                        webViewClient = WebViewClient()
                        val html = buildCodeBlockHtml(language, code, showFullscreenButton = false)
                        loadDataWithBaseURL("file:///android_asset/codeblock/", html, "text/html", "utf-8", null)
                        addJavascriptInterface(
                            CodeBlockBridge(
                                context = ctx,
                                onHeightPx = {},
                                onFullscreenRequested = {},
                            ),
                            "AndroidBridge",
                        )
                    }
                },
            )
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Close fullscreen code view",
                    tint = MaterialTheme.colorScheme.onBackground,
                )
            }
        }
    }
}
