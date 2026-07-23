package io.nexy.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import io.nexy.android.ui.theme.Blue500
import io.nexy.android.ui.theme.Gray400
import io.nexy.android.ui.theme.Green500
import io.nexy.android.ui.theme.LocalNexyColors
import io.nexy.android.ui.theme.Purple400
import io.nexy.android.ui.theme.Purple500
import io.nexy.android.ui.theme.Red500

/**
 * Timeline status bead colors — mirrors desktop's toolCallDotColor/thinkingDotColor
 * (ChatMessages.tsx:95-102). Kept as free functions rather than an enum so callers
 * can resolve running/success/failure/thinking state from whatever shape they hold.
 */
fun toolCallBeadColor(inProgress: Boolean, success: Boolean): Color = when {
    inProgress -> Blue500
    success -> Green500
    else -> Red500
}

fun thinkingBeadColor(streaming: Boolean): Color = if (streaming) Purple400 else Purple500

/**
 * One step in the shared vertical connector line used for tool calls and thinking blocks —
 * the Android counterpart of desktop's `TimelineEntry` (ChatMessages.tsx:82-96). A single
 * continuous `2.dp` line runs behind a chain of entries with a colored status "bead" per step;
 * callers wrap a run of adjacent timeline-eligible items in [ChatTimelineGroup] so the line reads
 * as one continuous thread rather than a fresh line per item.
 */
@Composable
fun ChatTimelineEntry(
    beadColor: Color,
    pulse: Boolean = false,
    content: @Composable () -> Unit,
) {
    val haloColor = MaterialTheme.colorScheme.background

    Box(modifier = Modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 12.dp),
        ) {
            content()
        }
        Box(
            modifier = Modifier
                .offset(x = (-5).dp, y = 6.dp)
                .size(10.dp)
                .background(haloColor, CircleShape)
                .padding(2.dp)
                .background(beadColor, CircleShape),
        )
    }
}

/**
 * Wraps a run of adjacent [ChatTimelineEntry] steps in one continuous left-border connector
 * (`2.dp`, `outlineVariant`), matching desktop's `border-l-2 border-gray-200 dark:border-gray-700`
 * wrapper (ChatMessages.tsx:430,472-490,578) rather than a border per item.
 */
@Composable
fun ChatTimelineGroup(content: @Composable () -> Unit) {
    val lineColor = MaterialTheme.colorScheme.outlineVariant
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .drawBehind {
                drawLine(
                    color = lineColor,
                    start = Offset(x = 0f, y = 0f),
                    end = Offset(x = 0f, y = size.height),
                    strokeWidth = 2.dp.toPx(),
                )
            },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        content()
    }
}
