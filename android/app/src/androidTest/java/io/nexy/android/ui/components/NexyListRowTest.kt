package io.nexy.android.ui.components

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for item 8 of the UX correctness roadmap: NexyListRow was defined
 * but never used anywhere, while ProvidersScreen and CliModelsScreen each hand-rolled their
 * own custom row with alternating stripe colors. Extended with `leading`/`subtitleContent`
 * slots so both screens could adopt it instead of duplicating bespoke layout code.
 */
@RunWith(AndroidJUnit4::class)
class NexyListRowTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun showsTitleAndPlainSubtitle() {
        composeRule.setContent {
            NexyListRow(title = "Anthropic", subtitle = "Connected")
        }
        composeRule.onNodeWithText("Anthropic").assertIsDisplayed()
        composeRule.onNodeWithText("Connected").assertIsDisplayed()
    }

    @Test
    fun subtitleContentTakesPrecedenceOverPlainSubtitle() {
        composeRule.setContent {
            NexyListRow(
                title = "Anthropic",
                subtitle = "ignored",
                subtitleContent = { Text("Custom badge content") },
            )
        }
        composeRule.onNodeWithText("Custom badge content").assertIsDisplayed()
        composeRule.onNodeWithText("ignored").assertDoesNotExist()
    }

    @Test
    fun rendersLeadingAndTrailingContent() {
        composeRule.setContent {
            NexyListRow(
                title = "Claude CLI",
                leading = { Text("ICON") },
                trailing = { Text("Installed") },
            )
        }
        composeRule.onNodeWithText("ICON").assertIsDisplayed()
        composeRule.onNodeWithText("Installed").assertIsDisplayed()
    }

    @Test
    fun clickableRowInvokesOnClick() {
        var clicked = false
        composeRule.setContent {
            NexyListRow(title = "Row", onClick = { clicked = true })
        }
        composeRule.onNodeWithText("Row").performClick()
        assertTrue(clicked)
    }
}
