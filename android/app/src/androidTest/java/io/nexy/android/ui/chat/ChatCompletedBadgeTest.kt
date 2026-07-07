package io.nexy.android.ui.chat

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for the "no indication of completion inside the open chat window" gap:
 * ChatScreen's header now renders this badge whenever the open conversation's completed_at is
 * non-null (see ChatScreen.kt's `isCompleted` derivation), mirroring the checkmark list screens
 * already show. This test covers the badge in isolation since ChatScreen itself depends on the
 * live WsRepository singleton and isn't practical to mount directly in a unit test.
 */
@RunWith(AndroidJUnit4::class)
class ChatCompletedBadgeTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersCompletedLabel() {
        composeRule.setContent {
            ChatCompletedBadge()
        }
        composeRule.onNodeWithText("Completed").assertExists()
    }
}
