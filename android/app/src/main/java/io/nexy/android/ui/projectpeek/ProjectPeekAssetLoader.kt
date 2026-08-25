package io.nexy.android.ui.projectpeek

import android.net.Uri
import android.util.Base64
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Synthetic same-origin authority the HTML preview is loaded under via `loadDataWithBaseURL`, so
 * the WebView's own relative-URL resolution turns `img/logo.png`, `../shared/site.css`, etc. into
 * requests this loader can recognize and answer — without ever letting the page make a real
 * network request. See the Project Peek HTML viewer design notes: every sub-resource is answered
 * (or explicitly blocked) from [shouldInterceptRequest], which the WebView calls *before* opening
 * any socket, so nothing a page author writes can reach the open internet.
 */
private const val PEEK_HOST = "peek.nexy.local"
private const val PEEK_SCHEME = "https"
private const val ASSET_TIMEOUT_MS = 5_000L
private const val MAX_CONCURRENT_ASSET_REQUESTS = 6
private const val MAX_DISTINCT_ASSETS_PER_LOAD = 200

/** Base URL to hand to `loadDataWithBaseURL` for a preview of a file at [htmlRelativePath]. */
fun projectPeekBaseUrl(sourceId: String, htmlRelativePath: String): String {
    val dir = htmlRelativePath.substringBeforeLast('/', missingDelimiterValue = "")
    val encodedDir = dir.split('/').filter { it.isNotEmpty() }.joinToString("/") { Uri.encode(it) }
    val suffix = if (encodedDir.isEmpty()) "" else "$encodedDir/"
    return "$PEEK_SCHEME://$PEEK_HOST/${Uri.encode(sourceId)}/$suffix"
}

/**
 * Resolves relative-asset requests issued by an HTML preview against the paired desktop's
 * Project Peek `read-asset` command, with an in-memory cache, a concurrency cap (so one preview
 * can't flood the shared WS channel), and a circuit breaker on total distinct assets per page
 * load. One instance is scoped to a single WebView load of a single source file.
 */
class ProjectPeekAssetLoader(
    private val projectId: String,
    private val sourceId: String,
) {
    private data class CachedAsset(val bytes: ByteArray, val mimeType: String)

    private val lock = ReentrantLock()
    private val cache = LinkedHashMap<String, CachedAsset>()
    private val semaphore = Semaphore(MAX_CONCURRENT_ASSET_REQUESTS)
    private val distinctAssetCount = AtomicInteger(0)

    /** Empty-but-non-null response: WebResourceResponse(null) would let the WebView attempt a
     *  real network load instead, which must never happen. */
    private fun blocked(mimeType: String = "text/plain"): WebResourceResponse =
        WebResourceResponse(mimeType, "utf-8", ByteArrayInputStream(ByteArray(0)))

    private fun relativePathFor(url: Uri): String? {
        if (url.scheme != PEEK_SCHEME || url.host != PEEK_HOST) return null
        val segments = url.pathSegments
        if (segments.isEmpty() || segments[0] != sourceId) return null
        val relative = segments.drop(1).joinToString("/")
        if (relative.isEmpty() || relative.split('/').any { it == ".." || it == "." }) return null
        return relative
    }

    fun intercept(view: WebView, request: WebResourceRequest): WebResourceResponse {
        val relativePath = relativePathFor(request.url) ?: return blocked()

        lock.withLock { cache[relativePath] }?.let { cached ->
            return WebResourceResponse(cached.mimeType, null, ByteArrayInputStream(cached.bytes))
        }

        if (distinctAssetCount.incrementAndGet() > MAX_DISTINCT_ASSETS_PER_LOAD) return blocked()

        val fetched = runBlocking {
            semaphore.acquire()
            try {
                withTimeoutOrNull(ASSET_TIMEOUT_MS) {
                    coroutineScope {
                        val requestId = UUID.randomUUID().toString()
                        val waiter = async {
                            WsRepository.events.filterIsInstance<WsEvent.ProjectPeekAssetContent>().first {
                                it.projectId == projectId && it.sourceId == sourceId &&
                                    it.relativePath == relativePath && it.requestId == requestId
                            }
                        }
                        WsRepository.readProjectPeekAsset(projectId, sourceId, relativePath, requestId)
                        waiter.await()
                    }
                }
            } finally {
                semaphore.release()
            }
        }

        if (fetched == null || fetched.error != null || fetched.mimeType.isNullOrEmpty()) return blocked()
        val bytes = try { Base64.decode(fetched.content, Base64.DEFAULT) } catch (_: IllegalArgumentException) { return blocked() }

        lock.withLock {
            cache[relativePath] = CachedAsset(bytes, fetched.mimeType)
        }
        return WebResourceResponse(fetched.mimeType, null, ByteArrayInputStream(bytes))
    }
}

/**
 * Hardened, read-only WebViewClient for Project Peek HTML previews: every sub-resource is routed
 * through [ProjectPeekAssetLoader], every top-level navigation (including in-page `<a href>`
 * taps) is blocked, and — combined with JavaScript disabled at the WebView-settings level by the
 * caller — nothing on the loaded page can reach the internet or navigate the WebView away from
 * the single previewed document.
 */
class ProjectPeekWebViewClient(private val loader: ProjectPeekAssetLoader) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
        loader.intercept(view, request)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
}
