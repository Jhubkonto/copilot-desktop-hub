package io.nexy.android.ui.connection

import androidx.compose.ui.graphics.Color

/**
 * Content-sync health, independent of connectivity.
 *
 * The app bar splits two questions the user was previously forced to read from one glyph: the
 * [ConnectionDotState] answers "am I linked to the desktop?" while this answers "is the content I
 * pulled from the desktop up to date?". Connectivity (connecting / disconnected / standalone) lives
 * on the dot; this enum only tracks the fate of synced content and any outstanding local changes.
 */
enum class ContentSyncState {
    /** Nothing outstanding — local content matches the desktop. */
    SYNCED,

    /** A transfer is actually in flight right now. This is the only state that animates. */
    SYNCING,

    /**
     * Local edits are queued but nothing is being transferred at this moment (offline, waiting for
     * the next flush, or a push that has not started yet). Deliberately distinct from [SYNCING]:
     * a queue that cannot drain must not present as perpetual motion, which is indistinguishable
     * from a hung sync and was reported as "the spinner never stops".
     */
    PENDING,

    /** A push failed or a change conflicts and needs the user to follow up. */
    ERROR,
}

/**
 * @param syncInProgress        a whole-app reconcile is running *right now*. This signal is
 *                              bounded by WsRepository so a lost desktop reply cannot pin it true.
 * @param pendingChanges        local edits queued to push to the desktop.
 * @param failedChanges         local edits that exhausted their retries.
 * @param conflicts             unresolved local/remote divergences.
 * @param contentSyncInProgress optional per-screen override. `true` forces SYNCING (e.g. a chat
 *                              reconciling its history); `false` suppresses the global
 *                              `syncInProgress` so an unrelated background reconcile does not read
 *                              as this screen syncing; `null` defers to the global signal.
 *
 * Priority: unresolved problems win, then anything in flight or queued, then the settled state.
 */
fun resolveContentSyncState(
    syncInProgress: Boolean,
    pendingChanges: Int,
    failedChanges: Int,
    conflicts: Int,
    contentSyncInProgress: Boolean? = null,
): ContentSyncState = when {
    failedChanges > 0 || conflicts > 0 -> ContentSyncState.ERROR
    contentSyncInProgress == true ||
        (contentSyncInProgress == null && syncInProgress) -> ContentSyncState.SYNCING
    pendingChanges > 0 -> ContentSyncState.PENDING
    else -> ContentSyncState.SYNCED
}

data class ContentSyncPresentation(
    val label: String,
    val color: Color,
    val accessibilityDescription: String,
)

private val SyncedGreen = Color(0xFF22C55E)
private val SyncingAmber = Color(0xFFF59E0B)
private val ErrorRed = Color(0xFFEF4444)

fun getContentSyncPresentation(state: ContentSyncState): ContentSyncPresentation = when (state) {
    ContentSyncState.SYNCED ->
        ContentSyncPresentation("Synced", SyncedGreen, "Content is up to date with the desktop")
    ContentSyncState.SYNCING ->
        ContentSyncPresentation("Syncing…", SyncingAmber, "Synchronizing content with the desktop")
    ContentSyncState.PENDING ->
        ContentSyncPresentation("Changes queued", SyncingAmber, "Local changes are waiting to sync with the desktop")
    ContentSyncState.ERROR ->
        ContentSyncPresentation("Sync problem", ErrorRed, "A sync problem needs your attention")
}
