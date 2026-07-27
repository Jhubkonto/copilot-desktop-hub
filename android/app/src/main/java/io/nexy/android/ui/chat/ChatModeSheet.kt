package io.nexy.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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

private data class CliModeOption(val value: String?, val label: String, val hint: String)

private data class CliModeSection(val title: String, val options: List<CliModeOption>)

/** Backend-specific mode options — Claude Code permission modes vs Codex sandbox levels.
 *  Hermes has no mode flags, so it gets no section. Mirrors desktop's CLI_MODE_OPTIONS. */
private val cliModeSections: Map<String, CliModeSection> = mapOf(
    "claude-cli" to CliModeSection(
        title = "Claude Code mode (this chat)",
        options = listOf(
            CliModeOption(null, "Default", ""),
            CliModeOption("plan", "Plan", "Analyse only — no file edits"),
            CliModeOption("acceptEdits", "Accept edits", "Auto-accept file edits"),
            CliModeOption("bypassPermissions", "Bypass", "Skip all permission prompts"),
        ),
    ),
    "codex-cli" to CliModeSection(
        title = "Codex sandbox (this chat)",
        options = listOf(
            CliModeOption(null, "Default", ""),
            CliModeOption("read-only", "Read-only", "No file writes"),
            CliModeOption("workspace-write", "Workspace", "Writes inside the workspace"),
            CliModeOption("danger-full-access", "Full access", "No sandbox restrictions"),
        ),
    ),
)

/** Per-conversation overrides for thinking effort and tool auto-approval — the composer-bar
 *  counterpart to the agent-level defaults set in Agent Config. Mirrors desktop's ChatModePicker. */
@Composable
fun ChatModeSheet(
    thinkingEffortOverride: String?,
    fullAutoApproveOverride: Boolean?,
    terminalSandboxOverride: Boolean?,
    activeCliBackend: String? = null,
    cliModeOverride: String? = null,
    onSetThinkingEffort: (String?) -> Unit,
    onSetFullAutoApprove: (Boolean?) -> Unit,
    onSetTerminalSandboxOverride: (Boolean?) -> Unit,
    onSetCliMode: (String?) -> Unit = {},
) {
    val cliModeSection = activeCliBackend?.let { cliModeSections[it] }
    Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Chat mode", style = MaterialTheme.typography.titleMedium)

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Thinking effort (this chat)",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ChoiceChipRow(
                options = thinkingOptions,
                selected = thinkingEffortOverride,
                onSelect = onSetThinkingEffort,
            )
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Auto-approve (this chat)",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ChoiceChipRow(
                options = approveOptions,
                selected = fullAutoApproveOverride,
                onSelect = onSetFullAutoApprove,
            )
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
            ChoiceChipRow(
                options = approveOptions,
                selected = terminalSandboxOverride,
                onSelect = onSetTerminalSandboxOverride,
            )
            Text(
                "Overrides the project's sandbox-bypass default for this conversation only.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (cliModeSection != null) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    cliModeSection.title,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                ChoiceChipRow(
                    options = cliModeSection.options.map { it.value to it.label },
                    selected = cliModeOverride,
                    onSelect = onSetCliMode,
                )
                Text(
                    "Also settable via slash commands (e.g. /plan, /mode-default). Applies from the next message.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * A wrapping row of theme-coloured selectable chips. Wrapping (instead of a fixed
 * segmented row) keeps every option the same size and avoids the squashed, uneven
 * two-line labels that a 6-option segmented control produced on narrow screens.
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun <T> ChoiceChipRow(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEach { (value, label) ->
            val isSelected = selected == value
            FilterChip(
                selected = isSelected,
                onClick = { onSelect(value) },
                label = { Text(label, style = MaterialTheme.typography.labelLarge) },
                leadingIcon = if (isSelected) {
                    { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(18.dp)) }
                } else null,
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primary,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
                    selectedLeadingIconColor = MaterialTheme.colorScheme.onPrimary,
                ),
            )
        }
    }
}
