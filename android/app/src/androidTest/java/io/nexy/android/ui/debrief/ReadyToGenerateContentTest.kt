package io.nexy.android.ui.debrief

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.ModelOption
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage: Debrief used to auto-generate on screen open with no explanation of what
 * it does or which model would be used. This exercises the new pre-generate step directly (no
 * ViewModel/WsRepository wiring needed) to confirm the explanation and model picker render before
 * generation starts, and that nothing happens until the user explicitly taps "Generate debrief".
 */
@RunWith(AndroidJUnit4::class)
class ReadyToGenerateContentTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun showsExplanationOfWhatADebriefContains() {
        composeRule.setContent {
            ReadyToGenerateContent(selectedModel = null, models = emptyList(), onPickModel = {}, onGenerate = {})
        }
        composeRule.onNodeWithText("Generate a debrief").assertIsDisplayed()
        composeRule.onNodeWithText(
            "A debrief asks an AI model to read this conversation's transcript and produce four things: " +
                "a short summary of what was accomplished, the commands/tools/APIs used, a step-by-step guide " +
                "to reproduce the work from scratch, and the reasoning approach that was followed. It's separate " +
                "from \"Mark complete\" — generating a debrief doesn't change the conversation's completed state, " +
                "and marking a conversation complete doesn't generate one.",
        ).assertIsDisplayed()
    }

    @Test
    fun showsDefaultModelLabelWhenNoneSelected() {
        composeRule.setContent {
            ReadyToGenerateContent(selectedModel = null, models = emptyList(), onPickModel = {}, onGenerate = {})
        }
        composeRule.onNodeWithText("Use this conversation's model").assertIsDisplayed()
    }

    @Test
    fun showsSelectedModelLabel() {
        composeRule.setContent {
            ReadyToGenerateContent(
                selectedModel = "claude-sonnet-4-6",
                models = listOf(ModelOption("claude-sonnet-4-6", "Claude Sonnet 4.6", "Anthropic")),
                onPickModel = {},
                onGenerate = {},
            )
        }
        composeRule.onNodeWithText("Claude Sonnet 4.6").assertIsDisplayed()
    }

    @Test
    fun tappingModelButtonInvokesOnPickModel() {
        var picked = false
        composeRule.setContent {
            ReadyToGenerateContent(selectedModel = null, models = emptyList(), onPickModel = { picked = true }, onGenerate = {})
        }
        composeRule.onNodeWithText("Use this conversation's model").performClick()
        assertEquals(true, picked)
    }

    @Test
    fun tappingGenerateInvokesOnGenerate() {
        var generated = false
        composeRule.setContent {
            ReadyToGenerateContent(selectedModel = null, models = emptyList(), onPickModel = {}, onGenerate = { generated = true })
        }
        composeRule.onNodeWithText("Generate debrief").performClick()
        assertEquals(true, generated)
    }
}
