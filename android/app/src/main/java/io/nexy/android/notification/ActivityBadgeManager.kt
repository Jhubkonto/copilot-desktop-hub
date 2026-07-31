package io.nexy.android.notification

import android.app.NotificationManager
import android.content.Context
import android.content.Intent

/**
 * Persisted, destination-based unseen activity state shared by all notification producers.
 * A Set intentionally deduplicates the same event arriving over WebSocket and FCM.
 */
object ActivityBadgeManager {
    const val EXTRA_DESTINATION = "activityBadgeDestination"

    private const val PREFS_NAME = "nexy_activity_badges"
    private const val PREFS_KEY = "unseen_destinations"

    fun chatDestination(conversationId: String): String = "chat:$conversationId"
    fun scheduledDestination(taskId: String): String = "scheduled:$taskId"
    fun approvalDestination(requestId: String): String = "approval:$requestId"

    @Synchronized
    fun record(context: Context, destination: String): Int {
        val unseen = read(context).toMutableSet()
        unseen += destination
        write(context, unseen)
        return unseen.size
    }

    @Synchronized
    fun markSeen(context: Context, destination: String): Int {
        val unseen = read(context).toMutableSet()
        if (unseen.remove(destination)) write(context, unseen)
        context.getSystemService(NotificationManager::class.java)
            ?.cancel(notificationId(destination))
        return unseen.size
    }

    @Synchronized
    fun markSeenWithPrefix(context: Context, prefix: String): Int {
        val unseen = read(context).toMutableSet()
        val removed = unseen.filter { it.startsWith(prefix) }
        if (removed.isNotEmpty()) {
            unseen.removeAll(removed.toSet())
            write(context, unseen)
            val notificationManager = context.getSystemService(NotificationManager::class.java)
            removed.forEach { notificationManager?.cancel(notificationId(it)) }
        }
        return unseen.size
    }

    fun markIntentSeen(context: Context, intent: Intent?) {
        intent?.getStringExtra(EXTRA_DESTINATION)?.let { markSeen(context, it) }
    }

    fun notificationId(destination: String): Int = destination.hashCode() and Int.MAX_VALUE

    internal fun count(context: Context): Int = read(context).size

    private fun read(context: Context): Set<String> =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getStringSet(PREFS_KEY, emptySet())
            ?.toSet()
            ?: emptySet()

    private fun write(context: Context, unseen: Set<String>) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(PREFS_KEY, unseen)
            .apply()
    }
}
