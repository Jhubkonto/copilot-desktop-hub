package io.nexy.android.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.nexy.android.ui.theme.LocalNexyEightBit

/** Visual-only 8-bit treatments. None of these modifiers alter measured bounds. */
fun Modifier.nexyPixelBorder(
    color: Color,
    shape: Shape,
    width: Dp = 2.dp,
): Modifier = composed {
    if (LocalNexyEightBit.current) border(width, color, shape) else this
}

fun Modifier.nexyHardShadow(
    color: Color,
    offset: Dp = 2.dp,
): Modifier = composed {
    if (!LocalNexyEightBit.current) this else drawBehind {
        val offsetPx = offset.toPx()
        drawRect(
            color = color,
            topLeft = Offset(offsetPx, offsetPx),
            size = Size(
                width = (size.width - offsetPx).coerceAtLeast(0f),
                height = (size.height - offsetPx).coerceAtLeast(0f),
            ),
        )
    }
}

fun Modifier.nexyDither(
    background: Color,
    foreground: Color,
    cellSize: Dp = 4.dp,
): Modifier = composed {
    if (!LocalNexyEightBit.current) background(background) else drawBehind {
        drawRect(background)
        drawDither(foreground, cellSize.toPx())
    }
}

private fun DrawScope.drawDither(color: Color, cellSizePx: Float) {
    val cell = cellSizePx.coerceAtLeast(1f)
    var row = 0
    var y = 0f
    while (y < size.height) {
        var column = 0
        var x = 0f
        while (x < size.width) {
            if ((row + column) % 2 == 0) {
                drawRect(
                    color = color,
                    topLeft = Offset(x, y),
                    size = Size(cell / 2f, cell / 2f),
                )
            }
            column += 1
            x += cell
        }
        row += 1
        y += cell
    }
}

/** Static segmented progress record for indeterminate work. It retains the
 * four-dp progress-bar footprint without introducing decorative motion. */
@Composable
fun NexyStaticProgressRecord(modifier: Modifier = Modifier) {
    if (!LocalNexyEightBit.current) {
        LinearProgressIndicator(modifier = modifier.fillMaxWidth().height(4.dp))
        return
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(4.dp)
            .nexyDither(
                background = MaterialTheme.colorScheme.surfaceVariant,
                foreground = MaterialTheme.colorScheme.primary,
                cellSize = 4.dp,
            )
            .border(1.dp, MaterialTheme.colorScheme.outline),
    )
}
