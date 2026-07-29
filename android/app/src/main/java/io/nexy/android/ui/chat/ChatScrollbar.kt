package io.nexy.android.ui.chat

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import androidx.compose.material3.MaterialTheme
import kotlinx.coroutines.launch

/**
 * A draggable scrollbar thumb for the chat message [LazyColumn]. Position/height are estimated
 * from the average measured item size (LazyColumn has no fixed item height to compute this
 * exactly), which is good enough for a drag handle since it self-corrects every frame as more
 * items get measured. Hidden entirely when the whole conversation already fits on screen.
 */
@Composable
fun ChatScrollbar(
    listState: LazyListState,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val trackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.05f)
    val thumbColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.22f)
    val activeThumbColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.45f)

    var isDragging by remember { mutableStateOf(false) }
    var trackHeightPx by remember { mutableFloatStateOf(0f) }

    fun estimate(): Triple<Float, Float, Int>? {
        val layout = listState.layoutInfo
        val totalItems = layout.totalItemsCount
        val visible = layout.visibleItemsInfo
        if (totalItems == 0 || visible.isEmpty()) return null

        val averageItemSize = visible.sumOf { it.size }.toFloat() / visible.size
        if (averageItemSize <= 0f) return null
        val estimatedContentSize = averageItemSize * totalItems
        val viewportSize = (layout.viewportEndOffset - layout.viewportStartOffset).toFloat()
        if (estimatedContentSize <= viewportSize) return null

        val first = visible.first()
        val scrolledPast = first.index * averageItemSize - first.offset
        val scrollFraction = (scrolledPast / (estimatedContentSize - viewportSize)).coerceIn(0f, 1f)
        val thumbFraction = (viewportSize / estimatedContentSize).coerceIn(0.06f, 1f)
        return Triple(scrollFraction, thumbFraction, totalItems)
    }

    fun jumpTo(y: Float, totalItems: Int, thumbFraction: Float) {
        if (trackHeightPx <= 0f || totalItems == 0) return
        val thumbHeightPx = trackHeightPx * thumbFraction
        val usableTrack = (trackHeightPx - thumbHeightPx).coerceAtLeast(1f)
        val fraction = ((y - thumbHeightPx / 2f) / usableTrack).coerceIn(0f, 1f)
        val targetIndex = (fraction * (totalItems - 1)).toInt().coerceIn(0, totalItems - 1)
        scope.launch { listState.scrollToItem(targetIndex) }
    }

    val info = estimate() ?: return
    val (scrollFraction, thumbFraction, totalItems) = info

    Canvas(
        modifier = modifier
            .width(10.dp)
            .onSizeChanged { trackHeightPx = it.height.toFloat() }
            .pointerInput(totalItems) {
                detectTapGestures(
                    onPress = { offset ->
                        isDragging = true
                        val current = estimate()
                        if (current != null) jumpTo(offset.y, current.third, current.second)
                        tryAwaitRelease()
                        isDragging = false
                    },
                )
            }
            .pointerInput(totalItems) {
                detectDragGestures(
                    onDragStart = { isDragging = true },
                    onDragEnd = { isDragging = false },
                    onDragCancel = { isDragging = false },
                    onDrag = { change, _ ->
                        change.consume()
                        val current = estimate()
                        if (current != null) jumpTo(change.position.y, current.third, current.second)
                    },
                )
            },
    ) {
        drawRect(color = trackColor)

        val thumbHeight = (size.height * thumbFraction).coerceAtLeast(32f)
        val thumbTop = scrollFraction * (size.height - thumbHeight)
        drawRect(
            color = if (isDragging) activeThumbColor else thumbColor,
            topLeft = Offset(0f, thumbTop),
            size = Size(size.width, thumbHeight),
        )
    }
}
