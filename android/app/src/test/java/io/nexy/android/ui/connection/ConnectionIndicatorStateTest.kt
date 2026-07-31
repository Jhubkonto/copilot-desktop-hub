package io.nexy.android.ui.connection

import io.nexy.android.data.EffectiveConnectionMode
import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionIndicatorStateTest {
    @Test
    fun `standalone takes priority over sync and errors`() {
        assertEquals(
            ConnectionIndicatorState.STANDALONE,
            resolveConnectionIndicatorState(
                mode = EffectiveConnectionMode.STANDALONE_BY_CHOICE,
                syncInProgress = true,
                pendingChanges = 1,
                failedChanges = 1,
                conflicts = 1,
                contentSyncInProgress = true,
            ),
        )
    }

    @Test
    fun `unresolved failures take priority over syncing`() {
        assertEquals(
            ConnectionIndicatorState.ERROR,
            resolveConnectionIndicatorState(
                mode = EffectiveConnectionMode.CONNECTED,
                syncInProgress = true,
                pendingChanges = 1,
                failedChanges = 1,
                conflicts = 0,
            ),
        )
    }

    @Test
    fun `connection and content transitions resolve to syncing`() {
        listOf(
            resolveConnectionIndicatorState(EffectiveConnectionMode.CONNECTING, false, 0, 0, 0),
            resolveConnectionIndicatorState(EffectiveConnectionMode.SEARCHING, false, 0, 0, 0),
            resolveConnectionIndicatorState(EffectiveConnectionMode.CONNECTED, true, 0, 0, 0),
            resolveConnectionIndicatorState(EffectiveConnectionMode.CONNECTED, false, 1, 0, 0),
            resolveConnectionIndicatorState(
                EffectiveConnectionMode.CONNECTED,
                false,
                0,
                0,
                0,
                contentSyncInProgress = true,
            ),
        ).forEach { state ->
            assertEquals(ConnectionIndicatorState.SYNCING, state)
        }
    }

    @Test
    fun `settled connected mode resolves to connected`() {
        assertEquals(
            ConnectionIndicatorState.CONNECTED,
            resolveConnectionIndicatorState(
                mode = EffectiveConnectionMode.CONNECTED,
                syncInProgress = false,
                pendingChanges = 0,
                failedChanges = 0,
                conflicts = 0,
            ),
        )
    }

    @Test
    fun `chat readiness is not held open by unrelated background sync`() {
        assertEquals(
            ConnectionIndicatorState.CONNECTED,
            resolveConnectionIndicatorState(
                mode = EffectiveConnectionMode.CONNECTED,
                syncInProgress = true,
                pendingChanges = 0,
                failedChanges = 0,
                conflicts = 0,
                contentSyncInProgress = false,
            ),
        )
    }

    @Test
    fun `disconnected mode resolves to error`() {
        assertEquals(
            ConnectionIndicatorState.ERROR,
            resolveConnectionIndicatorState(
                mode = EffectiveConnectionMode.DISCONNECTED,
                syncInProgress = false,
                pendingChanges = 0,
                failedChanges = 0,
                conflicts = 0,
            ),
        )
    }
}
