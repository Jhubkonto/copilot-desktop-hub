package io.nexy.android.ui.home

import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.EffectiveConnectionMode
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage: the connection chip is now also the Standalone/Remote mode toggle —
 * tapping it should flip the mode immediately when idle, or explain why not when something is
 * active, instead of requiring a trip through a bottom sheet.
 */
@RunWith(AndroidJUnit4::class)
class ConnectionChipTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun tappingWhenIdleInvokesOnToggle() {
        var toggled = false
        composeRule.setContent {
            ConnectionChip(
                mode = EffectiveConnectionMode.CONNECTED,
                isBusy = false,
                onToggle = { toggled = true },
                onBusyTap = {},
            )
        }
        composeRule.onNodeWithText("● Connected to desktop").performClick()
        assertEquals(true, toggled)
    }

    @Test
    fun tappingWhenBusyInvokesOnBusyTapInstead() {
        var toggled = false
        var busyTapped = false
        composeRule.setContent {
            ConnectionChip(
                mode = EffectiveConnectionMode.CONNECTED,
                isBusy = true,
                onToggle = { toggled = true },
                onBusyTap = { busyTapped = true },
            )
        }
        composeRule.onNodeWithText("● Connected to desktop").performClick()
        assertEquals(false, toggled)
        assertEquals(true, busyTapped)
    }

    @Test
    fun showsStandaloneModeLabel() {
        composeRule.setContent {
            ConnectionChip(
                mode = EffectiveConnectionMode.STANDALONE_BY_CHOICE,
                isBusy = false,
                onToggle = {},
                onBusyTap = {},
            )
        }
        composeRule.onNodeWithText("● Standalone mode").assertExists()
    }
}
