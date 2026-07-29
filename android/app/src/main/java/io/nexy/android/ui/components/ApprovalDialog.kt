package io.nexy.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.theme.LocalNexyColors

@Composable
fun ApprovalDialog(
    request: WsEvent.ToolApprovalRequest,
    onApprove: () -> Unit,
    onKeepPlanning: () -> Unit = onApprove,
    onReject: () -> Unit,
) {
    val haptic = LocalHapticFeedback.current
    val nexyColors = LocalNexyColors.current
    val isPlanDecision = request.toolName == "exit_plan_mode"

    AlertDialog(
        onDismissRequest = { /* require explicit action */ },
        containerColor = MaterialTheme.colorScheme.surface,
        titleContentColor = MaterialTheme.colorScheme.onSurface,
        textContentColor = MaterialTheme.colorScheme.onSurface,
        shape = MaterialTheme.shapes.large,
        title = {
            Text(
                if (isPlanDecision) "Plan ready" else "Tool Request",
                style = MaterialTheme.typography.titleMedium,
            )
        },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    text = if (isPlanDecision) {
                        "Choose whether Codex should implement this plan or continue planning."
                    } else {
                        request.description.ifBlank { request.toolName }
                    },
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                if (request.args.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = request.args.entries.joinToString("\n") { (k, v) -> "$k: $v" },
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace,
                        ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(8.dp),
                            )
                            .padding(10.dp),
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onApprove()
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = nexyColors.success,
                    contentColor = nexyColors.onSuccess,
                ),
                shape = MaterialTheme.shapes.small,
            ) {
                Text(if (isPlanDecision) "Implement plan" else "Approve", style = MaterialTheme.typography.labelLarge)
            }
        },
        dismissButton = {
            if (isPlanDecision) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NexySecondaryButton(
                        text = "Keep planning",
                        onClick = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            onKeepPlanning()
                        },
                    )
                    NexyDangerButton(
                        text = "Cancel",
                        onClick = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            onReject()
                        },
                    )
                }
            } else {
                NexyDangerButton(
                    text = "Reject",
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        onReject()
                    },
                )
            }
        },
    )
}
