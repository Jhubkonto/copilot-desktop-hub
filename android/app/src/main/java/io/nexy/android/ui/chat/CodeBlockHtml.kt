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
fun buildCodeBlockHtml(language: String?, code: String, showFullscreenButton: Boolean = true): String {
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
              <div class="header-actions">
                ${if (showFullscreenButton) """<button onclick="openFullscreen()" aria-label="View fullscreen">⛶</button>""" else ""}
                <button onclick="copyCode()">Copy</button>
              </div>
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
            function openFullscreen() {
              AndroidBridge.onFullscreen();
            }
            function reportSize() {
              AndroidBridge.reportHeight(document.body.scrollHeight);
            }
            // A single synchronous scrollHeight read at parse time races the WebView's own
            // native layout pass — Compose may not have handed it its final measured width
            // yet, so the initial read can lock in a height computed against a transient
            // (too-narrow/too-wide) layout, permanently clipping the code block short of its
            // real content. ResizeObserver re-reports height on every subsequent layout
            // change (final width settling, font metrics resolving, hljs's DOM mutations),
            // self-correcting instead of trusting one early snapshot.
            reportSize();
            if (window.ResizeObserver) {
              new ResizeObserver(reportSize).observe(document.body);
            } else {
              window.addEventListener('load', reportSize);
            }
          </script>
        </body>
        </html>
    """.trimIndent()
}
