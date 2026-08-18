package io.nexy.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Mirrors desktop's Tailwind color coding for each mode section (ChatModePicker.tsx). */
private val AutoApproveColor = Color(0xFF3B82F6) // blue-500
private val AgenticModeColor = Color(0xFF10B981) // emerald-500
private val TerminalSandboxColor = Color(0xFFF59E0B) // amber-500
private val CliModeColor = Color(0xFFA855F7) // purple-500
private val CodexExecutionModeColor = Color(0xFF6366F1) // indigo-500

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
    projectDefaultThinkingEffort: String? = null,
    fullAutoApproveOverride: Boolean?,
    agenticModeOverride: Boolean?,
    terminalSandboxOverride: Boolean?,
    activeCliBackend: String? = null,
    showAgenticMode: Boolean = true,
    cliModeOverride: String? = null,
    codexExecutionModeOverride: String? = null,
    onSetThinkingEffort: (String?) -> Unit,
    onSetFullAutoApprove: (Boolean?) -> Unit,
    onSetAgenticMode: (Boolean?) -> Unit,
    onSetTerminalSandboxOverride: (Boolean?) -> Unit,
    onSetCliMode: (String?) -> Unit = {},
    onSetCodexExecutionMode: (String?) -> Unit = {},
) {
    val displayedThinkingEffort = thinkingEffortOverride ?: projectDefaultThinkingEffort
    val cliModeSection = activeCliBackend?.let { cliModeSections[it] }
    // Claude's permission mode includes its approval policy, while Codex approval policy and
    // filesystem sandbox are independent. Codex therefore shows both controls, matching desktop.
    val showAutoApprove = activeCliBackend != "claude-cli"
    // Terminal sandbox bypass is currently only implemented by the Claude CLI adapter; showing
    // it for other backends is a silent no-op.
    val showTerminalSandboxBypass = activeCliBackend == "claude-cli"
    val showProviderPlanMode = activeCliBackend == null
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
                selected = displayedThinkingEffort,
                onSelect = onSetThinkingEffort,
                selectedColor = AutoApproveColor,
            )
        }

        if (showProviderPlanMode && showAgenticMode) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Agentic mode (this chat)",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                ChoiceChipRow(
                    options = approveOptions,
                    selected = agenticModeOverride,
                    onSelect = onSetAgenticMode,
                    selectedColor = AgenticModeColor,
                )
                Text(
                    "Lets a tool-capable BYOK model continue using available project tools until the task is complete.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (activeCliBackend == "codex-cli") {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Codex execution mode (this chat)",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                ChoiceChipRow(
                    options = listOf(null to "Default", "plan" to "Plan"),
                    selected = codexExecutionModeOverride,
                    onSelect = onSetCodexExecutionMode,
                    selectedColor = CodexExecutionModeColor,
                )
                Text(
                    "Uses Codex's native collaboration mode, independently of approvals and sandbox access.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (showProviderPlanMode) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Execution mode (this chat)",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                ChoiceChipRow(
                    options = listOf(null to "Default", "plan" to "Plan"),
                    selected = cliModeOverride,
                    onSelect = onSetCliMode,
                    selectedColor = CodexExecutionModeColor,
                )
                Text(
                    "The model exits Plan mode when its plan is ready; implementation starts only after you approve it.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (showAutoApprove) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    if (activeCliBackend == "codex-cli") {
                        "Codex auto-approve (this chat)"
                    } else {
                        "Auto-approve (this chat)"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                ChoiceChipRow(
                    options = approveOptions,
                    selected = fullAutoApproveOverride,
                    onSelect = onSetFullAutoApprove,
                    selectedColor = AutoApproveColor,
                )
                Text(
                    if (activeCliBackend == "codex-cli") {
                        "Controls approval prompts independently of the Codex sandbox level below."
                    } else {
                        "Overrides the agent's saved default for this conversation only."
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (showTerminalSandboxBypass) {
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
                    selectedColor = TerminalSandboxColor,
                )
                Text(
                    "Overrides the project's sandbox-bypass default for this conversation only.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
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
                    selectedColor = CliModeColor,
                )
                Text(
                    "Applies from the next message.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private const val CHIP_ROW_COLUMNS = 3

/**
 * A grid of theme-coloured selectable chips, laid out in fixed-width rows of
 * [CHIP_ROW_COLUMNS] so every chip in a section is the same width regardless of its
 * label length — a `FlowRow` sized each chip to its own text and produced visibly
 * uneven rows (e.g. "Low" much narrower than "Medium").
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> ChoiceChipRow(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    selectedColor: Color = MaterialTheme.colorScheme.primary,
    columns: Int = CHIP_ROW_COLUMNS,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.chunked(columns).forEach { rowOptions ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                rowOptions.forEach { (value, label) ->
                    val isSelected = selected == value
                    FilterChip(
                        modifier = Modifier.weight(1f),
                        selected = isSelected,
                        onClick = { onSelect(value) },
                        label = {
                            Text(
                                label,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                softWrap = false,
                                style = MaterialTheme.typography.labelLarge,
                            )
                        },
                        leadingIcon = if (isSelected) {
                            { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(18.dp)) }
                        } else null,
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = selectedColor,
                            selectedLabelColor = Color.White,
                            selectedLeadingIconColor = Color.White,
                        ),
                    )
                }
                // Pad the last row with invisible spacers so its chips stay the same
                // width as full rows above, instead of stretching to fill the row alone.
                repeat(columns - rowOptions.size) {
                    Row(modifier = Modifier.weight(1f)) {}
                }
            }
        }
    }
}
