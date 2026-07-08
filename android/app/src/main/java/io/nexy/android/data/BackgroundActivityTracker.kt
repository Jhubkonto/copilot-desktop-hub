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

    /** Reconciles with a server snapshot (src/main/activity-tracker.ts): authoritative for
     *  anything it knows about, but preserves locally tracked entries the server hasn't echoed
     *  back yet (or never will, e.g. manual-workflow-generator which has no server-side hook). */
    fun applySnapshot(snapshot: List<BackgroundActivity>) {
        val knownIds = snapshot.map { it.id }.toSet()
        val localOnly = _activities.value.filterNot { it.id in knownIds }
        _activities.value = snapshot + localOnly
    }
}
