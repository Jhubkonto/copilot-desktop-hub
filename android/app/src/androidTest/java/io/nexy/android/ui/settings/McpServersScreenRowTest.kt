package io.nexy.android.ui.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNode
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.McpToolInfo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Regression coverage for item 6 of the follow-up roadmap: McpServersScreen hand-rolled its own
 * zebra-striped Surface/Row instead of the shared NexyListRow that ProvidersScreen/CliModelsScreen
 * already use. Confirms the rows render through the shared component and their actions still work.
 */
@RunWith(AndroidJUnit4::class)
class McpServersScreenRowTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersServerNameAndCommand() {
        composeRule.setContent {
            McpServerRow(
                server = McpServerInfo(id = "s1", name = "Filesystem", command = "npx -y @modelcontextprotocol/server-filesystem", enabled = true),
                status = "connected",
                onEdit = {},
                onDelete = {},
                onRestart = {},
            )
        }
        composeRule.onNodeWithText("Filesystem").assertIsDisplayed()
        composeRule.onNodeWithText("npx -y @modelcontextprotocol/server-filesystem").assertIsDisplayed()
        composeRule.onNodeWithText("Connected").assertIsDisplayed()
    }

    @Test
    fun showsOffBadgeWhenDisabled() {
        composeRule.setContent {
            McpServerRow(
                server = McpServerInfo(id = "s1", name = "Filesystem", command = "npx", enabled = false),
                status = null,
                onEdit = {},
                onDelete = {},
                onRestart = {},
            )
        }
        composeRule.onNodeWithText("Off").assertIsDisplayed()
    }

    @Test
    fun openingMenuAndTappingEditInvokesOnEdit() {
        var edited = false
        composeRule.setContent {
            McpServerRow(
                server = McpServerInfo(id = "s1", name = "Filesystem", command = "npx", enabled = true),
                status = null,
                onEdit = { edited = true },
                onDelete = {},
                onRestart = {},
            )
        }
        composeRule.onNode(hasContentDescription("Server options")).performClick()
        composeRule.onNodeWithText("Edit").performClick()
        assertEquals(true, edited)
    }

    @Test
    fun rendersToolNameDescriptionAndServerName() {
        composeRule.setContent {
            McpToolEntry(
                tool = McpToolInfo(name = "read_file", description = "Reads a file from disk", serverId = "s1", serverName = "Filesystem"),
            )
        }
        composeRule.onNodeWithText("read_file").assertIsDisplayed()
        composeRule.onNodeWithText("Reads a file from disk").assertIsDisplayed()
        composeRule.onNodeWithText("Filesystem").assertIsDisplayed()
    }
}
