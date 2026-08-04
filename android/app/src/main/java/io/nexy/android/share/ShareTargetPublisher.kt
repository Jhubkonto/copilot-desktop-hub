package io.nexy.android.share

import android.content.Context
import android.content.Intent
import androidx.core.app.Person
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import io.nexy.android.MainActivity
import io.nexy.android.R
import io.nexy.android.data.model.Conversation

object ShareTargetPublisher {
    private const val CATEGORY = "io.nexy.android.category.SHARE_CHAT"
    private const val MAX_TARGETS = 4
    private const val CONVERSATION_EXTRA = "io.nexy.android.extra.SHARE_CONVERSATION_ID"

    fun publish(context: Context, conversations: List<Conversation>) {
        val targets = conversations
            .asSequence()
            .filterNot { it.archived }
            .sortedWith(compareByDescending<Conversation> { it.pinned }.thenByDescending { it.updated_at })
            .take(MAX_TARGETS)
            .mapIndexed { rank, conversation ->
                ShortcutInfoCompat.Builder(context, "chat-${conversation.id}")
                    .setShortLabel(conversation.title.ifBlank { "Chat" }.take(40))
                    .setLongLived(true)
                    .setCategories(setOf(CATEGORY))
                    .setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
                    .setPerson(Person.Builder().setName(conversation.title.ifBlank { "Nexy chat" }).build())
                    .setRank(rank)
                    .setIntent(
                        Intent(context, MainActivity::class.java)
                            .setAction(Intent.ACTION_VIEW)
                            .putExtra(CONVERSATION_EXTRA, conversation.id),
                    )
                    .build()
            }
            .toList()
        ShortcutManagerCompat.setDynamicShortcuts(context, targets)
    }
}
