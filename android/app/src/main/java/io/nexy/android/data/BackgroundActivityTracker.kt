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

    // Ids ever passed to register() — used to tell "genuinely local-only, server will never
    // know about it" apart from "was in a previous server snapshot but has since ended". Both
    // look identical as "missing from the new snapshot" otherwise, and conflating them was why
    // a finished chat's "Assistant is responding…" entry stayed stuck forever: it wasn't in the
    // newer (post-completion) snapshot, so it got treated as a protected local-only entry and
    // re-added right back.
    private val locallyRegisteredIds = mutableSetOf<String>()

    fun register(id: String, label: String, route: String) {
        locallyRegisteredIds += id
        _activities.value = _activities.value.filterNot { it.id == id } + BackgroundActivity(id, label, route)
    }

    fun unregister(id: String) {
        locallyRegisteredIds -= id
        if (_activities.value.none { it.id == id }) return
        _activities.value = _activities.value.filterNot { it.id == id }
    }

    /** Reconciles with a server snapshot (src/main/activity-tracker.ts): authoritative for
     *  anything it knows about, but preserves locally tracked entries the server hasn't echoed
     *  back yet. */
    fun applySnapshot(snapshot: List<BackgroundActivity>) {
        val knownIds = snapshot.map { it.id }.toSet()
        val localOnly = _activities.value.filter { it.id in locallyRegisteredIds && it.id !in knownIds }
        _activities.value = snapshot + localOnly
    }
}
