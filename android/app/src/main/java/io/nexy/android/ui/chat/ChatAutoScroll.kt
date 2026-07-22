package io.nexy.android.ui.chat

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow

/**
 * Sticky-scroll behavior shared by the generator screens (agent/artifact/project/skill/schedule):
 * auto-follows the bottom of a growing message list while the user is at the bottom, and stops
 * following once they scroll away. Extracted so these screens share the same behavior instead of
 * each having its own unconditional `animateScrollToItem` on every update, which ignored manual
 * scroll-up and fought the user while reading earlier output.
 */
@Stable
class ChatAutoScrollState internal constructor(val listState: LazyListState) {
    var shouldAutoFollow by mutableStateOf(true)
        internal set

    suspend fun scrollToBottom(animated: Boolean = false) {
        if (!shouldAutoFollow) return
        val itemCount = listState.layoutInfo.totalItemsCount
        if (itemCount <= 0) return
        listState.scrollToItem(itemCount - 1)
    }
}

@Composable
fun rememberChatAutoScrollState(listState: LazyListState = rememberLazyListState()): ChatAutoScrollState {
    return remember(listState) { ChatAutoScrollState(listState) }
}

/**
 * Registers the two effects that drive [state]: re-pin to bottom whenever [contentSignal]
 * changes (while following), and stop/resume following based on the user's own scroll gestures.
 */
@Composable
fun ChatAutoScrollEffect(state: ChatAutoScrollState, contentSignal: Any?) {
    LaunchedEffect(contentSignal) {
        state.scrollToBottom(animated = false)
    }
    LaunchedEffect(state) {
        var wasScrolling = false
        snapshotFlow { state.listState.isScrollInProgress to state.listState.canScrollForward }
            .collect { (scrolling, canScrollForward) ->
                if (scrolling && canScrollForward) {
                    state.shouldAutoFollow = false
                } else if (wasScrolling && !scrolling && !canScrollForward) {
                    state.shouldAutoFollow = true
                }
                wasScrolling = scrolling
            }
    }
}
