package io.nexy.android.ui.components

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyInfoDialog
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NexyConfirmDialogTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun confirmDialog_showsTitleAndMessage() {
        composeRule.setContent {
            NexyConfirmDialog(
                title = "Delete item?",
                message = "This action cannot be undone.",
                confirmLabel = "Delete",
                onConfirm = {},
                onDismiss = {},
            )
        }
        composeRule.onNodeWithText("Delete item?").assertIsDisplayed()
        composeRule.onNodeWithText("This action cannot be undone.").assertIsDisplayed()
        composeRule.onNodeWithText("Delete").assertIsDisplayed()
        composeRule.onNodeWithText("Cancel").assertIsDisplayed()
    }

    @Test
    fun confirmDialog_confirmButtonInvokesCallback() {
        var confirmed = false
        composeRule.setContent {
            NexyConfirmDialog(
                title = "Delete item?",
                message = "This action cannot be undone.",
                confirmLabel = "Delete",
                onConfirm = { confirmed = true },
                onDismiss = {},
            )
        }
        composeRule.onNodeWithText("Delete").performClick()
        assertTrue(confirmed)
    }

    @Test
    fun confirmDialog_cancelButtonInvokesDismiss() {
        var dismissed = false
        composeRule.setContent {
            NexyConfirmDialog(
                title = "Delete item?",
                message = "This action cannot be undone.",
                confirmLabel = "Delete",
                onConfirm = {},
                onDismiss = { dismissed = true },
            )
        }
        composeRule.onNodeWithText("Cancel").performClick()
        assertTrue(dismissed)
    }

    @Test
    fun infoDialog_showsTitleMessageAndOk() {
        composeRule.setContent {
            NexyInfoDialog(
                title = "Error",
                message = "Something went wrong.",
                onDismiss = {},
            )
        }
        composeRule.onNodeWithText("Error").assertIsDisplayed()
        composeRule.onNodeWithText("Something went wrong.").assertIsDisplayed()
        composeRule.onNodeWithText("OK").assertIsDisplayed()
    }

    @Test
    fun infoDialog_okButtonInvokesDismiss() {
        var dismissed = false
        composeRule.setContent {
            NexyInfoDialog(
                title = "Error",
                message = "Something went wrong.",
                onDismiss = { dismissed = true },
            )
        }
        composeRule.onNodeWithText("OK").performClick()
        assertTrue(dismissed)
    }
}
