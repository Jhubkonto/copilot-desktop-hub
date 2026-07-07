package io.nexy.android.ui.home

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.BackgroundActivity
import io.nexy.android.data.EffectiveConnectionMode
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StatusActivityBarTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun setBar(
        effectiveMode: EffectiveConnectionMode = EffectiveConnectionMode.CONNECTED,
        pendingChanges: Int = 0,
        failedChanges: Int = 0,
        backgroundActivities: List<BackgroundActivity> = emptyList(),
        onWakeDesktop: () -> Unit = {},
        onOpenConnection: () -> Unit = {},
        onOpenActivity: (BackgroundActivity) -> Unit = {},
    ) {
        composeRule.setContent {
            StatusActivityBar(
                effectiveMode = effectiveMode,
                intentionalRestartExpected = false,
                pendingChanges = pendingChanges,
                failedChanges = failedChanges,
                backgroundActivities = backgroundActivities,
                onWakeDesktop = onWakeDesktop,
                onOpenConnection = onOpenConnection,
                onOpenActivity = onOpenActivity,
            )
        }
    }

    @Test
    fun rendersNothingWhenConnectedWithNoSyncOrActivity() {
        setBar(effectiveMode = EffectiveConnectionMode.CONNECTED)
        composeRule.onNodeWithText("Searching…").assertDoesNotExist()
    }

    @Test
    fun rendersNothingWhenStandaloneByChoice() {
        setBar(effectiveMode = EffectiveConnectionMode.STANDALONE_BY_CHOICE)
        composeRule.onNodeWithText("Standalone mode").assertDoesNotExist()
    }

    @Test
    fun showsSearchingRowWithWakeItUp() {
        setBar(effectiveMode = EffectiveConnectionMode.SEARCHING)
        composeRule.onNodeWithText("Searching…").assertIsDisplayed()
        composeRule.onNodeWithText("Wake it up").assertIsDisplayed()
    }

    @Test
    fun clickingWakeItUpInvokesCallback() {
        var woke = false
        setBar(effectiveMode = EffectiveConnectionMode.SEARCHING, onWakeDesktop = { woke = true })
        composeRule.onNodeWithText("Wake it up").performClick()
        assertEquals(true, woke)
    }

    @Test
    fun connectingRowHasNoWakeItUp() {
        setBar(effectiveMode = EffectiveConnectionMode.CONNECTING)
        composeRule.onNodeWithText("Connecting…").assertIsDisplayed()
        composeRule.onNodeWithText("Wake it up").assertDoesNotExist()
    }

    @Test
    fun showsSyncRowWhenPendingChangesExist() {
        setBar(pendingChanges = 3)
        composeRule.onNodeWithText("Syncing 3 changes…").assertIsDisplayed()
    }

    @Test
    fun showsFailedSyncCount() {
        setBar(pendingChanges = 0, failedChanges = 2)
        composeRule.onNodeWithText("2 changes failed to sync").assertIsDisplayed()
    }

    @Test
    fun tappingSyncRowInvokesOnOpenConnection() {
        var opened = false
        setBar(pendingChanges = 1, onOpenConnection = { opened = true })
        composeRule.onNodeWithText("Syncing 1 change…").performClick()
        assertEquals(true, opened)
    }

    @Test
    fun rendersBackgroundActivityChipAndInvokesCallbackOnTap() {
        var opened: BackgroundActivity? = null
        val activity = BackgroundActivity("agent-generator", "Generating agent…", "agent-generator")
        setBar(backgroundActivities = listOf(activity), onOpenActivity = { opened = it })

        composeRule.onNodeWithText("Generating agent…").assertIsDisplayed()
        composeRule.onNodeWithText("Generating agent…").performClick()
        assertEquals(activity, opened)
    }

    @Test
    fun rendersMultipleBackgroundActivitiesIndependently() {
        setBar(
            backgroundActivities = listOf(
                BackgroundActivity("agent-generator", "Generating agent…", "agent-generator"),
                BackgroundActivity("project-generator", "Generating project…", "project-generator"),
            ),
        )
        composeRule.onNodeWithText("Generating agent…").assertIsDisplayed()
        composeRule.onNodeWithText("Generating project…").assertIsDisplayed()
    }
}
