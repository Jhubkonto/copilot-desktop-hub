package io.nexy.android.ui.connection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * A labeled on/off switch for the user's chosen connection mode, used in Settings → Connection
 * as the explicit, descriptive place to change it. The home top bar's
 * [io.nexy.android.ui.home.ConnectionChip] offers the same toggle as a single tap for quick
 * access; this version trades that speed for an explanation of what each mode means.
 */
@Composable
fun StandaloneModeToggle(
    isStandaloneModeEnabled: Boolean,
    onToggle: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text("Standalone mode", style = MaterialTheme.typography.bodyMedium)
            Text(
                text = if (isStandaloneModeEnabled) {
                    "Using only your locally-configured API keys. Works without a desktop, but CLI models and desktop file/git context stay unavailable."
                } else {
                    "Using the connected desktop's models and CLI backends when it's reachable."
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(
            checked = isStandaloneModeEnabled,
            onCheckedChange = onToggle,
        )
    }
}
