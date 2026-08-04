package io.nexy.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName

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

    val edgeTabShape = MaterialTheme.shapes.extraSmall.copy(
        topStart = CornerSize(0.dp),
        bottomStart = CornerSize(0.dp),
    )

    Box(
        modifier = modifier
            .padding(start = 0.dp)
            .clip(edgeTabShape)
            .background(MaterialTheme.colorScheme.primary)
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        NexyIcon(
            NexyIconName.ChevronRight,
            contentDescription = "Activity in progress — open activity feed",
            tint = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.size(18.dp),
        )
    }
}

/** Cyan quick-access tab for pinned chats, mirrored on the right edge when pins exist. */
@Composable
fun PinnedChatsEdgeTab(
    visible: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!visible) return

    val edgeTabShape = MaterialTheme.shapes.extraSmall.copy(
        topEnd = CornerSize(0.dp),
        bottomEnd = CornerSize(0.dp),
    )

    Box(
        modifier = modifier
            .clip(edgeTabShape)
            .background(MaterialTheme.colorScheme.secondary)
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        NexyIcon(
            NexyIconName.Pin,
            contentDescription = "Open pinned chats",
            tint = MaterialTheme.colorScheme.onSecondary,
            modifier = Modifier.size(18.dp),
        )
    }
}
