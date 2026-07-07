package io.nexy.android.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class BackgroundActivity(
    val id: String,
    val label: String,
    val route: String,
)

// App-wide registry of long-running work (generator streams, etc.) so a persistent status
// surface can tell the user something is still happening even after they've navigated away
// from the screen that started it.
object BackgroundActivityTracker {
    private val _activities = MutableStateFlow<List<BackgroundActivity>>(emptyList())
    val activities: StateFlow<List<BackgroundActivity>> = _activities

    fun register(id: String, label: String, route: String) {
        _activities.value = _activities.value.filterNot { it.id == id } + BackgroundActivity(id, label, route)
    }

    fun unregister(id: String) {
        if (_activities.value.none { it.id == id }) return
        _activities.value = _activities.value.filterNot { it.id == id }
    }
}
