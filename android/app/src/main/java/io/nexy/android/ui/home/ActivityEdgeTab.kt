package io.nexy.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp

/**
 * Translucent tap-only tab anchored to the left edge, vertically centered — the Android
 * counterpart of desktop's sidebar Activity row. Only visible while something is in progress;
 * tapping opens the full activity feed screen. No existing edge-swipe/drawer pattern exists
 * anywhere in this app, so this is a plain tap target rather than a drag-to-reveal gesture.
 */
@Composable
fun ActivityEdgeTab(
    visible: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!visible) return

    Box(
        modifier = modifier
            .padding(start = 0.dp)
            .clip(RoundedCornerShape(topEnd = 12.dp, bottomEnd = 12.dp))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.55f))
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = "Activity in progress — open activity feed",
            tint = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.size(18.dp),
        )
    }
}
