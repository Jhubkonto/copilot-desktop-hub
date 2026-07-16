package io.nexy.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

private val thinkingOptions = listOf(
    null to "Default",
    "disabled" to "Disabled",
    "low" to "Low",
    "medium" to "Medium",
    "high" to "High",
    "max" to "Max",
)

private val approveOptions = listOf<Pair<Boolean?, String>>(
    null to "Default",
    true to "On",
    false to "Off",
)

/** Per-conversation overrides for thinking effort and tool auto-approval — the composer-bar
 *  counterpart to the agent-level defaults set in Agent Config. Mirrors desktop's ChatModePicker. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatModeSheet(
    thinkingEffortOverride: String?,
    fullAutoApproveOverride: Boolean?,
    terminalSandboxOverride: Boolean?,
    onSetThinkingEffort: (String?) -> Unit,
    onSetFullAutoApprove: (Boolean?) -> Unit,
    onSetTerminalSandboxOverride: (Boolean?) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Chat mode", style = MaterialTheme.typography.titleMedium)

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Thinking effort (this chat)",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                thinkingOptions.forEachIndexed { i, (value, label) ->
                    SegmentedButton(
                        selected = thinkingEffortOverride == value,
                        onClick = { onSetThinkingEffort(value) },
                        shape = SegmentedButtonDefaults.itemShape(index = i, count = thinkingOptions.size),
                    ) {
                        Text(label, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Auto-approve (this chat)",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                approveOptions.forEachIndexed { i, (value, label) ->
                    SegmentedButton(
                        selected = fullAutoApproveOverride == value,
                        onClick = { onSetFullAutoApprove(value) },
                        shape = SegmentedButtonDefaults.itemShape(index = i, count = approveOptions.size),
                    ) {
                        Text(label, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            Text(
                "Overrides the agent's saved default for this conversation only.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Terminal sandbox bypass (this chat)",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                approveOptions.forEachIndexed { i, (value, label) ->
                    SegmentedButton(
                        selected = terminalSandboxOverride == value,
                        onClick = { onSetTerminalSandboxOverride(value) },
                        shape = SegmentedButtonDefaults.itemShape(index = i, count = approveOptions.size),
                    ) {
                        Text(label, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            Text(
                "Overrides the project's sandbox-bypass default for this conversation only.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
