package io.nexy.android.ui.projectpeek

import android.graphics.BitmapFactory
import android.util.Base64
import android.webkit.WebView
import android.widget.TextView
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar
import io.noties.markwon.Markwon
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

@Composable
fun ProjectPeekViewerScreen(
    projectId: String,
    sourceId: String,
    relativePath: String,
    category: String,
    onBack: () -> Unit,
) {
    BackHandler { onBack() }
    val context = LocalContext.current
    var content by remember(relativePath) { mutableStateOf<String?>(null) }
    var error by remember(relativePath) { mutableStateOf<String?>(null) }
    var truncated by remember(relativePath) { mutableStateOf(false) }
    var sourceMode by remember(relativePath) { mutableStateOf(false) }
    var retryKey by remember(relativePath) { mutableStateOf(0) }

    LaunchedEffect(projectId, sourceId, relativePath, retryKey) {
        content = null; error = null; truncated = false
        val requestId = UUID.randomUUID().toString()
        val response = withTimeoutOrNull(15_000) {
            coroutineScope {
                val waiter = async {
                    WsRepository.events.filterIsInstance<WsEvent.ProjectPeekFileContent>().first {
                        it.projectId == projectId && it.sourceId == sourceId && it.relativePath == relativePath && it.requestId == requestId
                    }
                }
                WsRepository.readProjectPeekFile(projectId, sourceId, relativePath, requestId)
                waiter.await()
            }
        }
        if (response == null) error = "The desktop did not respond. Check the connection and try again."
        else { error = response.error; content = response.content.takeIf { response.error == null }; truncated = response.truncated }
    }

    Scaffold(topBar = {
        NexyTopAppBar(
            titleContent = { Text(relativePath.substringAfterLast('/')) }, onBack = onBack,
            actions = { if (category == "document" || category == "html") TextButton(onClick = { sourceMode = !sourceMode }) { Text(if (sourceMode) "Rendered" else "Source") } },
        )
    }) { padding ->
        when {
            error != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { retryKey++ }) { Text("Retry") }
                }
            }
            content == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { Text("Loading preview…") }
            category == "image" -> {
                val bitmap = remember(content) { runCatching {
                    BitmapFactory.decodeByteArray(Base64.decode(content, Base64.DEFAULT), 0, Base64.decode(content, Base64.DEFAULT).size)?.asImageBitmap()
                }.getOrNull() }
                if (bitmap == null) Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { Text("This image could not be decoded on Android.") }
                else Column(Modifier.fillMaxSize().padding(padding), horizontalAlignment = Alignment.CenterHorizontally) {
                    Image(bitmap = bitmap, contentDescription = "Image preview", modifier = Modifier.weight(1f))
                    Text("${bitmap.width} × ${bitmap.height} px", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(8.dp))
                }
            }
            category == "html" && sourceMode -> Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)) {
                if (truncated) Text("This document is very large; only the first 500 KB is shown.", color = MaterialTheme.colorScheme.error)
                Text(content.orEmpty(), style = MaterialTheme.typography.bodySmall)
            }
            category == "html" -> {
                val loader = remember(projectId, sourceId, relativePath) { ProjectPeekAssetLoader(projectId, sourceId) }
                val baseUrl = remember(sourceId, relativePath) { projectPeekBaseUrl(sourceId, relativePath) }
                Column(Modifier.fillMaxSize().padding(padding)) {
                    if (truncated) Text(
                        "This document is very large; only the first 500 KB is shown.",
                        color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(8.dp),
                    )
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { ctx ->
                            WebView(ctx).apply {
                                // Hardened, read-only preview: no script execution, no reach into
                                // phone storage, every sub-resource funneled through the
                                // interceptor below instead of a real network request.
                                settings.javaScriptEnabled = false
                                settings.allowFileAccess = false
                                settings.allowContentAccess = false
                                settings.blockNetworkLoads = true
                                webViewClient = ProjectPeekWebViewClient(loader)
                            }
                        },
                        update = { it.loadDataWithBaseURL(baseUrl, content.orEmpty(), "text/html", "utf-8", null) },
                    )
                }
            }
            else -> Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)) {
                if (truncated) Text("This document is very large; only the first 500 KB is shown.", color = MaterialTheme.colorScheme.error)
                if (sourceMode) Text(content.orEmpty(), style = MaterialTheme.typography.bodySmall)
                else AndroidView(
                    modifier = Modifier.fillMaxWidth(),
                    factory = { TextView(context).apply { setTextIsSelectable(true) } },
                    update = { Markwon.create(context).setMarkdown(it, content.orEmpty()) },
                )
            }
        }
    }
}
