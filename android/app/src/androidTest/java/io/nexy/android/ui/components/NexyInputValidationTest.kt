package io.nexy.android.ui.components

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for item 6 of the UX correctness roadmap: screens had no way to
 * attach a description to a text field without misusing the error-message or placeholder
 * slot, so most Agent Settings options shipped with no explanation at all.
 */
@RunWith(AndroidJUnit4::class)
class NexyInputValidationTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun showsHelperTextWhenNoError() {
        composeRule.setContent {
            NexyInputValidation(
                value = "",
                onValueChange = {},
                label = "Max tokens",
                helperText = "The maximum length of the model's response.",
            )
        }
        composeRule.onNodeWithText("The maximum length of the model's response.").assertIsDisplayed()
    }

    @Test
    fun errorMessageTakesPrecedenceOverHelperText() {
        composeRule.setContent {
            NexyInputValidation(
                value = "",
                onValueChange = {},
                label = "Max tokens",
                errorMessage = "Must be a number",
                helperText = "The maximum length of the model's response.",
            )
        }
        composeRule.onNodeWithText("Must be a number").assertIsDisplayed()
    }
}
