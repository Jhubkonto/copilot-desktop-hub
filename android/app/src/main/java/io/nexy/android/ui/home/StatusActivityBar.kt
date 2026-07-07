package io.nexy.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.nexy.android.data.BackgroundActivity
import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.ui.connection.getEffectiveModePresentation

// Extends the original POLLING-only "Looking for your desktop..." banner into a general
// status strip: each row appears only when there is something worth surfacing (connectivity
// trouble, unsynchronized changes, or a generator still running in the background) and
// disappears once resolved, rather than sitting as permanent chrome.
@Composable
fun StatusActivityBar(
    effectiveMode: EffectiveConnectionMode,
    intentionalRestartExpected: Boolean,
    pendingChanges: Int,
    failedChanges: Int,
    backgroundActivities: List<BackgroundActivity>,
    onWakeDesktop: () -> Unit,
    onOpenConnection: () -> Unit,
    onOpenActivity: (BackgroundActivity) -> Unit,
) {
    val showConnectivity = effectiveMode != EffectiveConnectionMode.CONNECTED &&
        effectiveMode != EffectiveConnectionMode.STANDALONE_BY_CHOICE
    val showSync = pendingChanges > 0 || failedChanges > 0

    if (!showConnectivity && !showSync && backgroundActivities.isEmpty()) return

    Column(modifier = Modifier.fillMaxWidth()) {
        if (showConnectivity) {
            val presentation = getEffectiveModePresentation(effectiveMode, intentionalRestartExpected)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFFFF3CD))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    presentation.label,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF856404),
                    modifier = Modifier.weight(1f),
                )
                if (effectiveMode == EffectiveConnectionMode.SEARCHING) {
                    Text(
                        "Wake it up",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFF664D03),
                        modifier = Modifier
                            .clickable(onClick = onWakeDesktop)
                            .padding(start = 8.dp),
                    )
                }
            }
        }

        if (showSync) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFE0E7FF))
                    .clickable(onClick = onOpenConnection)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val label = buildString {
                    if (pendingChanges > 0) {
                        append(if (pendingChanges == 1) "Syncing 1 change…" else "Syncing $pendingChanges changes…")
                    }
                    if (failedChanges > 0) {
                        if (isNotEmpty()) append(" · ")
                        append(if (failedChanges == 1) "1 change failed to sync" else "$failedChanges changes failed to sync")
                    }
                }
                Text(
                    label,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF3730A3),
                    modifier = Modifier.weight(1f),
                )
            }
        }

        backgroundActivities.forEach { activity ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .clickable { onOpenActivity(activity) }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text(
                    activity.label,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
