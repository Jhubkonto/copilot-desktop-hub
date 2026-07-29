package io.nexy.android.ui.connection

import io.nexy.android.data.EffectiveConnectionMode

enum class ConnectionIndicatorState {
    CONNECTED,
    SYNCING,
    STANDALONE,
    ERROR,
}

/**
 * Resolves the single state shown in the app bar. Mode has the highest priority, followed by
 * unresolved problems, work that can make visible data stale, and finally the settled state.
 */
fun resolveConnectionIndicatorState(
    mode: EffectiveConnectionMode,
    syncInProgress: Boolean,
    pendingChanges: Int,
    failedChanges: Int,
    conflicts: Int,
    contentSyncInProgress: Boolean = false,
): ConnectionIndicatorState = when {
    mode == EffectiveConnectionMode.STANDALONE_BY_CHOICE ->
        ConnectionIndicatorState.STANDALONE

    failedChanges > 0 ||
        conflicts > 0 ||
        mode == EffectiveConnectionMode.DISCONNECTED ->
        ConnectionIndicatorState.ERROR

    syncInProgress ||
        pendingChanges > 0 ||
        contentSyncInProgress ||
        mode == EffectiveConnectionMode.CONNECTING ||
        mode == EffectiveConnectionMode.SEARCHING ->
        ConnectionIndicatorState.SYNCING

    else -> ConnectionIndicatorState.CONNECTED
}
