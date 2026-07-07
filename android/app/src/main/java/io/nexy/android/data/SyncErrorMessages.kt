package io.nexy.android.data

// Desktop echoes raw SQLite/driver exception text back on sync failures (e.g. "FOREIGN KEY
// constraint failed"). Most users have no use for that string; map the ones we recognize to a
// plain-language explanation and fall back to the raw text for anything unrecognized so nothing
// is silently swallowed.
fun humanizeSyncError(raw: String?): String {
    if (raw.isNullOrBlank()) return "Synchronization failed for an unknown reason."
    return when {
        raw.contains("FOREIGN KEY constraint failed", ignoreCase = true) ->
            "This change referenced data that no longer exists (for example, a message in a " +
                "conversation that was deleted) and was cleaned up automatically."
        else -> raw
    }
}
