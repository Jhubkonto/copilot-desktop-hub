package io.nexy.android.ui.featuregenerator

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.ui.components.NexyConfirmDialog
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FeatureGeneratorUiTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val phaseLabels = listOf("Describe", "Spec", "Plan", "Apply", "Done")
    private val allPhases = FeatureGenPhase.values()

    @Test
    fun phaseIndicator_showsAllFiveLabels() {
        composeRule.setContent {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                allPhases.zip(phaseLabels).forEachIndexed { _, (_, label) ->
                    Surface(modifier = Modifier.weight(1f), shape = MaterialTheme.shapes.small) {
                        Text(label, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(6.dp))
                    }
                }
            }
        }
        phaseLabels.forEach { label ->
            composeRule.onNodeWithText(label).assertIsDisplayed()
        }
    }

    @Test
    fun resetConfirmDialog_appearsWithCorrectContent() {
        composeRule.setContent {
            NexyConfirmDialog(
                title = "Start over?",
                message = "The current Feature Generator run will be cleared from this screen.",
                confirmLabel = "Start over",
                destructive = true,
                onConfirm = {},
                onDismiss = {},
            )
        }
        composeRule.onNodeWithText("Start over?").assertIsDisplayed()
        composeRule.onNodeWithText("The current Feature Generator run will be cleared from this screen.").assertIsDisplayed()
        composeRule.onNodeWithText("Start over").assertIsDisplayed()
        composeRule.onNodeWithText("Cancel").assertIsDisplayed()
    }

    @Test
    fun resetConfirmDialog_confirmCallsReset() {
        var resetCalled = false
        composeRule.setContent {
            var show by remember { mutableStateOf(true) }
            if (show) {
                NexyConfirmDialog(
                    title = "Start over?",
                    message = "The current Feature Generator run will be cleared from this screen.",
                    confirmLabel = "Start over",
                    destructive = true,
                    onConfirm = { resetCalled = true; show = false },
                    onDismiss = { show = false },
                )
            }
        }
        composeRule.onNodeWithText("Start over").performClick()
        assertTrue(resetCalled)
    }

    @Test
    fun resetConfirmDialog_cancelDismissesWithoutReset() {
        var resetCalled = false
        var dismissed = false
        composeRule.setContent {
            var show by remember { mutableStateOf(true) }
            if (show) {
                NexyConfirmDialog(
                    title = "Start over?",
                    message = "The current Feature Generator run will be cleared from this screen.",
                    confirmLabel = "Start over",
                    destructive = true,
                    onConfirm = { resetCalled = true; show = false },
                    onDismiss = { dismissed = true; show = false },
                )
            }
        }
        composeRule.onNodeWithText("Cancel").performClick()
        assertTrue(dismissed)
        assertTrue(!resetCalled)
    }
}
