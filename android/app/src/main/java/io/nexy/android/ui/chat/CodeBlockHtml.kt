package io.nexy.android.ui.chat

/** Escapes text for safe interpolation into an HTML text node. */
private fun escapeHtml(text: String): String =
    text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")

/**
 * Builds the minimal HTML shell loaded into the code-block WebView island. References the
 * bundled `theme.css` (ported from src/renderer/styles/global.css) and `highlight.min.js`
 * (vendored highlight.js 11.11.1, matching desktop's resolved version) via relative asset
 * paths — loaded through `loadDataWithBaseURL("file:///android_asset/", ...)` so they resolve.
 */
fun buildCodeBlockHtml(language: String?, code: String): String {
    val escapedCode = escapeHtml(code)
    val langClass = if (language != null) "language-$language" else "nohighlight"
    val langLabel = escapeHtml(language ?: "code")
    return """
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
          <link rel="stylesheet" href="theme.css">
          <script src="highlight.min.js"></script>
        </head>
        <body>
          <div class="code-wrapper">
            <div class="code-header">
              <span class="lang">$langLabel</span>
              <button onclick="copyCode()">Copy</button>
            </div>
            <pre><code class="$langClass">$escapedCode</code></pre>
          </div>
          <script>
            // Swallow highlight.js failures (e.g. an unrecognized language class from the
            // model's fence tag) — otherwise a thrown error here stops the script before
            // reportHeight ever runs, leaving the WebView pinned at the small loading-skeleton
            // height with the code invisible below the fold instead of falling back to
            // plain, unhighlighted text at its real height.
            try { hljs.highlightAll(); } catch (e) {}
            function copyCode() {
              AndroidBridge.onCopy(document.querySelector('code').innerText);
            }
            AndroidBridge.reportHeight(document.body.scrollHeight);
          </script>
        </body>
        </html>
    """.trimIndent()
}
