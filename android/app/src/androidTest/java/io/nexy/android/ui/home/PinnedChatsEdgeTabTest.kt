package io.nexy.android.ui.home

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import org.junit.Rule
import org.junit.Test

class PinnedChatsEdgeTabTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun hiddenWhenThereAreNoPinnedChats() {
        composeRule.setContent {
            MaterialTheme {
                PinnedChatsEdgeTab(visible = false, onClick = {})
            }
        }

        composeRule
            .onNodeWithContentDescription("Open pinned chats")
            .assertDoesNotExist()
    }

    @Test
    fun displayedWhenPinnedChatsExist() {
        composeRule.setContent {
            MaterialTheme {
                PinnedChatsEdgeTab(visible = true, onClick = {})
            }
        }

        composeRule
            .onNodeWithContentDescription("Open pinned chats")
            .assertIsDisplayed()
    }
}
