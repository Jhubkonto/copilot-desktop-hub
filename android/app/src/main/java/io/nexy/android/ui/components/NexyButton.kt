package io.nexy.android.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.theme.LocalNexyEightBit

/**
 * Shared button variants for the app, mirroring the desktop app's Button primitive
 * (src/renderer/components/ui/primitives.tsx) so both platforms use the same visual
 * language: primary (filled), secondary (outlined), ghost (text), danger (destructive).
 *
 * Use these instead of raw Button/OutlinedButton/TextButton with inline ButtonDefaults
 * color overrides, so destructive actions stay pinned to MaterialTheme.colorScheme.error
 * rather than drifting to ad-hoc hex values across screens.
 */

@Composable
fun NexyPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    leadingIcon: ImageVector? = null,
    leadingNexyIcon: NexyIconName? = null,
) {
    val eightBit = LocalNexyEightBit.current
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = MaterialTheme.shapes.small,
        border = BorderStroke(if (eightBit) 2.dp else 1.dp, MaterialTheme.colorScheme.outline),
        elevation = if (eightBit) ButtonDefaults.buttonElevation(
            defaultElevation = 0.dp,
            pressedElevation = 0.dp,
            focusedElevation = 0.dp,
            hoveredElevation = 0.dp,
            disabledElevation = 0.dp,
        ) else ButtonDefaults.buttonElevation(),
    ) {
        if (leadingNexyIcon != null) {
            NexyIcon(leadingNexyIcon, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
        } else if (leadingIcon != null) {
            Icon(leadingIcon, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun NexySecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    leadingIcon: ImageVector? = null,
    leadingNexyIcon: NexyIconName? = null,
) {
    val eightBit = LocalNexyEightBit.current
    OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = MaterialTheme.shapes.small,
        border = BorderStroke(if (eightBit) 2.dp else 1.dp, MaterialTheme.colorScheme.outline),
    ) {
        if (leadingNexyIcon != null) {
            NexyIcon(leadingNexyIcon, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
        } else if (leadingIcon != null) {
            Icon(leadingIcon, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun NexyGhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val eightBit = LocalNexyEightBit.current
    TextButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = MaterialTheme.shapes.small,
        border = BorderStroke(if (eightBit) 2.dp else 0.dp, Color.Transparent),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Destructive action, outlined style (e.g. "Delete", "Remove", "Reject"). */
@Composable
fun NexyDangerButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val eightBit = LocalNexyEightBit.current
    OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = MaterialTheme.shapes.small,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
        border = BorderStroke(if (eightBit) 2.dp else 1.dp, MaterialTheme.colorScheme.error),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Destructive action, filled style — for the primary action in a confirmation ("Delete forever"). */
@Composable
fun NexyDangerFilledButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val eightBit = LocalNexyEightBit.current
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = MaterialTheme.shapes.small,
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.error,
            contentColor = MaterialTheme.colorScheme.onError,
        ),
        border = BorderStroke(if (eightBit) 2.dp else 1.dp, MaterialTheme.colorScheme.error),
        elevation = if (eightBit) ButtonDefaults.buttonElevation(
            defaultElevation = 0.dp,
            pressedElevation = 0.dp,
            focusedElevation = 0.dp,
            hoveredElevation = 0.dp,
            disabledElevation = 0.dp,
        ) else ButtonDefaults.buttonElevation(),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
