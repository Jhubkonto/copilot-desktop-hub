package io.nexy.android.ui.chat

import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalContext
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.ThinkingBlock
import io.noties.markwon.Markwon
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ChatTimelineWidthTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun codexReasoningTextKeepsTheAvailableTimelineWidth() {
        val content = "Now inspect the existing Android chat timeline implementation"
        composeRule.setContent {
            ChatTimelineGroup {
                ChatTimelineEntry(beadColor = androidx.compose.ui.graphics.Color.Gray) {
                    CodexReasoningActionLine(
                        listOf(ThinkingBlock("reasoning-1", content, done = true)),
                    )
                }
            }
        }

        composeRule.onNodeWithText(content).assertWidthIsAtLeast(200.dp)
    }

    @Test
    fun settledAssistantTextKeepsTheRemainingMessageRowWidth() {
        val content = "Investigating two issues: live thought and tool rendering"
        composeRule.setContent {
            val context = LocalContext.current
            CompositionLocalProvider(LocalMarkwon provides Markwon.create(context)) {
                MessageBubble(
                    msg = ChatMessage(
                        id = "assistant-1",
                        text = content,
                        isUser = false,
                        isStreaming = false,
                    ),
                    onCopy = {},
                    onEdit = null,
                    onResend = null,
                )
            }
        }

        composeRule.onNodeWithText(content).assertWidthIsAtLeast(200.dp)
    }
}
