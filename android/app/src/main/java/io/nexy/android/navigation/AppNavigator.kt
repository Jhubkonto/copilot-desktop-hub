package io.nexy.android.navigation

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * App-global one-shot navigation intents for UI that lives outside any single screen's navigator —
 * e.g. the persistent connection sheet in the top app bar. That sheet is shown on every screen
 * (via [io.nexy.android.ui.connection.ConnectionDot]) and needs to route to the QR pairing flow
 * without every screen threading a navigation callback down into the app bar.
 *
 * [NavGraph] collects [routes] once and forwards each to the real NavController.
 */
object AppNavigator {
    private val _routes = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val routes: SharedFlow<String> = _routes.asSharedFlow()

    fun navigate(route: String) {
        _routes.tryEmit(route)
    }
}
