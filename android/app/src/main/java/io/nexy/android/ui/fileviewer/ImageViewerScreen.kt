package io.nexy.android.ui.fileviewer

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

private const val MAX_ZOOM = 5f

@Composable
fun ImageViewerScreen(path: String, onBack: () -> Unit) {
    BackHandler { onBack() }

    var image by remember(path) { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    var error by remember(path) { mutableStateOf<String?>(null) }

    LaunchedEffect(path) {
        image = null
        error = null

        // Subscribe before requesting the file. The event stream is hot and a fast desktop
        // response must not arrive before the collector is attached.
        val requestId = UUID.randomUUID().toString()
        val response = withTimeoutOrNull(15_000) {
            coroutineScope {
                val waiter = async {
                    WsRepository.events
                        .filterIsInstance<WsEvent.FsFileContent>()
                        .first { it.path == path && it.requestId == requestId }
                }
                val legacyFallback = launch {
                    // Older desktops simply ignore fs:read-image. Give the current command a
                    // short head start, then retry through fs:read-file, whose current handler
                    // also returns base64 for image paths.
                    delay(IMAGE_READ_FALLBACK_DELAY_MS)
                    if (!waiter.isCompleted) WsRepository.readFile(path, requestId)
                }
                WsRepository.readImageFile(path, requestId)
                try {
                    waiter.await()
                } finally {
                    legacyFallback.cancel()
                }
            }
        }

        when {
            response == null -> error = "The desktop did not respond. Check the connection and try again."
            response.error != null -> error = response.error
            response.encoding != "base64" -> error = "The desktop returned an unsupported image format."
            else -> {
                val decoded = withContext(Dispatchers.Default) {
                    runCatching {
                        val bytes = Base64.decode(response.content, Base64.DEFAULT)
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                    }.getOrNull()
                }
                image = decoded
                if (decoded == null) error = "This image could not be decoded on Android."
            }
        }
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(path.substringAfterLast('/').substringAfterLast('\\')) },
                onBack = onBack,
            )
        },
    ) { padding ->
        when {
            error != null -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
            }
            image == null -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text("Loading image…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> ZoomableImage(
                bitmap = image!!,
                modifier = Modifier.fillMaxSize().padding(padding),
            )
        }
    }
}

@Composable
private fun ZoomableImage(
    bitmap: androidx.compose.ui.graphics.ImageBitmap,
    modifier: Modifier = Modifier,
) {
    var scale by remember(bitmap) { mutableFloatStateOf(1f) }
    var offsetX by remember(bitmap) { mutableFloatStateOf(0f) }
    var offsetY by remember(bitmap) { mutableFloatStateOf(0f) }

    val resetOrZoom = {
        if (scale > 1f) {
            scale = 1f
            offsetX = 0f
            offsetY = 0f
        } else {
            scale = 2.5f
        }
    }

    Column(modifier = modifier.background(Color.Black)) {
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        val nextScale = (scale * zoom).coerceIn(1f, MAX_ZOOM)
                        scale = nextScale
                        if (nextScale == 1f) {
                            offsetX = 0f
                            offsetY = 0f
                        } else {
                            offsetX += pan.x
                            offsetY += pan.y
                        }
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = { resetOrZoom() })
                },
            contentAlignment = Alignment.Center,
        ) {
            Image(
                bitmap = bitmap,
                contentDescription = "Image preview",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationX = offsetX
                        translationY = offsetY
                    },
            )
        }
        Text(
            "Pinch to zoom • double-tap to zoom or reset",
            color = Color.White.copy(alpha = 0.75f),
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 8.dp),
        )
    }
}
