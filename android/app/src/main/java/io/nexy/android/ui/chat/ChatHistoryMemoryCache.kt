package io.nexy.android.ui.chat

/**
 * Keeps the last rendered history window available while users move between destinations.
 *
 * Room remains the durable cache and the desktop remains authoritative. This tiny process-local
 * layer only closes the scheduling gap between creating a new [ChatViewModel] and Room returning
 * its first query, which otherwise makes a previously opened chat briefly look empty on every
 * re-entry.
 */
internal object ChatHistoryMemoryCache {
    private const val MAX_CONVERSATIONS = 12

    private val entries = object : LinkedHashMap<String, List<ChatMessage>>(
        MAX_CONVERSATIONS,
        0.75f,
        true,
    ) {}

    @Synchronized
    fun get(conversationId: String): List<ChatMessage>? = entries[conversationId]

    @Synchronized
    fun put(conversationId: String, messages: List<ChatMessage>) {
        if (messages.isEmpty()) return
        entries[conversationId] = messages
        while (entries.size > MAX_CONVERSATIONS) {
            entries.entries.iterator().next().also { entries.remove(it.key) }
        }
    }

    @Synchronized
    internal fun clearForTest() = entries.clear()
}
