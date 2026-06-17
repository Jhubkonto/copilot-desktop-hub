package io.nexy.android.ui.components

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NexySearchFieldTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun searchField_showsPlaceholder() {
        composeRule.setContent {
            NexySearchField(
                query = "",
                onQueryChange = {},
                placeholder = "Search items",
            )
        }
        composeRule.onNodeWithText("Search items").assertIsDisplayed()
    }

    @Test
    fun searchField_typingInvokesCallback() {
        var emitted = ""
        composeRule.setContent {
            NexySearchField(
                query = "",
                onQueryChange = { emitted = it },
                placeholder = "Search",
            )
        }
        composeRule.onNodeWithText("Search").performTextInput("hello")
        assertEquals("hello", emitted)
    }

    @Test
    fun searchField_clearButtonAppearsWhenQueryNonBlank() {
        composeRule.setContent {
            var query by remember { mutableStateOf("hello") }
            NexySearchField(
                query = query,
                onQueryChange = { query = it },
                placeholder = "Search",
            )
        }
        composeRule.onNodeWithContentDescription("Clear search").assertIsDisplayed()
    }

    @Test
    fun searchField_clearButtonHiddenWhenQueryBlank() {
        composeRule.setContent {
            NexySearchField(
                query = "",
                onQueryChange = {},
                placeholder = "Search",
            )
        }
        composeRule.onNodeWithContentDescription("Clear search").assertDoesNotExist()
    }

    @Test
    fun searchField_clearButtonClickClearsQuery() {
        var query = "hello"
        composeRule.setContent {
            var q by remember { mutableStateOf(query) }
            NexySearchField(
                query = q,
                onQueryChange = { q = it; query = it },
                placeholder = "Search",
            )
        }
        composeRule.onNodeWithContentDescription("Clear search").performClick()
        assertTrue(query.isEmpty())
    }
}
