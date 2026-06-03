package io.nexy.android.ui.components

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import io.nexy.android.data.model.WsEvent

@Composable
fun ApprovalDialog(
    request: WsEvent.ToolApprovalRequest,
    onApprove: () -> Unit,
    onReject: () -> Unit,
) {
    val context = LocalContext.current

    AlertDialog(
        onDismissRequest = { /* require explicit action */ },
        containerColor = MaterialTheme.colorScheme.surface,
        titleContentColor = MaterialTheme.colorScheme.onSurface,
        textContentColor = MaterialTheme.colorScheme.onSurface,
        shape = MaterialTheme.shapes.large,
        title = {
            Text(
                "Tool Request",
                style = MaterialTheme.typography.titleMedium,
            )
        },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    text = request.toolName,
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
                    vibrate(context, durationMs = 50, amplitude = VibrationEffect.DEFAULT_AMPLITUDE)
                    onApprove()
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF16A34A),
                    contentColor = Color.White,
                ),
                shape = MaterialTheme.shapes.small,
            ) {
                Text("Approve", style = MaterialTheme.typography.labelLarge)
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = {
                    vibrate(context, durationMs = 100, amplitude = VibrationEffect.DEFAULT_AMPLITUDE)
                    onReject()
                },
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFEF4444)),
                shape = MaterialTheme.shapes.small,
            ) {
                Text("Reject", style = MaterialTheme.typography.labelLarge)
            }
        },
    )
}

private fun vibrate(context: Context, durationMs: Long, amplitude: Int) {
    val effect = VibrationEffect.createOneShot(durationMs, amplitude)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = context.getSystemService(VibratorManager::class.java)
        vm?.defaultVibrator?.vibrate(effect)
    } else {
        @Suppress("DEPRECATION")
        val v = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        v?.vibrate(effect)
    }
}
