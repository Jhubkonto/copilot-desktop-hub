package io.nexy.android.ui.chat

import android.text.Spanned
import android.util.LruCache
import io.noties.markwon.Markwon

/**
 * Keeps parsed Markdown available while chat items are recycled by LazyColumn.
 *
 * A Markwon instance is rebuilt when the active colour scheme changes, so the
 * renderer identity is part of the key. The cache is deliberately bounded by
 * source length rather than entry count: one unusually large response must not
 * evict the whole history or retain unbounded text in memory.
 */
internal object MarkdownRenderCache {
    private const val MAX_CACHED_CHARACTERS = 250_000

    private val entries = object : LruCache<String, Spanned>(MAX_CACHED_CHARACTERS) {
        override fun sizeOf(key: String, value: Spanned): Int = key.length.coerceAtLeast(1)
    }

    fun get(markwon: Markwon, markdown: String): Spanned? = entries.get(keyFor(markwon, markdown))

    fun getOrParse(markwon: Markwon, markdown: String): Spanned {
        val key = keyFor(markwon, markdown)
        return entries.get(key) ?: markwon.toMarkdown(markdown).also { entries.put(key, it) }
    }

    private fun keyFor(markwon: Markwon, markdown: String): String =
        "${System.identityHashCode(markwon)}:$markdown"
}
