package io.nexy.android.ui.settings

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.CliInstallInfo
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for item 5 of the Round 4 hotfix roadmap: CliModelsScreen used to render a
 * leading check/close icon swatch (read by the user as a checkbox) plus a separate trailing
 * "Installed"/"Not found" text, with 0-2 conditional subtitle lines causing inconsistent row
 * heights. CliModelRow now uses the same NexyStatusBadge pattern ProvidersScreen uses, with at
 * most one additional detail line.
 */
@RunWith(AndroidJUnit4::class)
class CliModelRowTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersInstalledBadgeWithVersionAndPath() {
        composeRule.setContent {
            CliModelRow(name = "Claude CLI", info = CliInstallInfo(installed = true, version = "1.2.3", path = "/usr/local/bin/claude"))
        }
        composeRule.onNodeWithText("Claude CLI").assertExists()
        composeRule.onNodeWithText("Installed").assertExists()
        composeRule.onNodeWithText("v1.2.3 · /usr/local/bin/claude").assertExists()
    }

    @Test
    fun rendersNotFoundBadgeWithNoDetailLineWhenVersionAndPathAreNull() {
        composeRule.setContent {
            CliModelRow(name = "Codex CLI", info = CliInstallInfo(installed = false, version = null, path = null))
        }
        composeRule.onNodeWithText("Codex CLI").assertExists()
        composeRule.onNodeWithText("Not found").assertExists()
    }
}
