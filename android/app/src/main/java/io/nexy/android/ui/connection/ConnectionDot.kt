package io.nexy.android.ui.connection

import android.animation.ValueAnimator
import android.widget.Toast
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.nexy.android.data.BackgroundActivityTracker
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.PairedServerProfile
import io.nexy.android.data.WsRepository
import io.nexy.android.navigation.AppNavigator
import io.nexy.android.ui.home.hasActiveActivity
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.theme.LocalNexyEightBit
import kotlinx.coroutines.launch

/**
 * Connectivity dot. Reads the app-wide [io.nexy.android.data.EffectiveConnectionMode] and shows a
 * single colored dot — green connected, amber connecting, red disconnected, purple standalone.
 * Tapping it opens the self-contained [ConnectionSheet] (active server, standalone toggle, saved
 * servers, scan/disconnect). Because the sheet is self-owned it works on every screen with zero
 * per-screen wiring — the same shape as the sibling [ContentSyncIndicator].
 *
 * The dot breathes continuously while CONNECTING (an active-work signal, like the sync spinner) and
 * gives one bigger "impact" pop when the link settles into CONNECTED or DISCONNECTED. All motion is
 * gated by [LocalNexyEightBit] and the platform reduced-motion setting per the no-visual-motion
 * policy; the sync icon still owns the "follow up problems" tap.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionDot(
    modifier: Modifier = Modifier,
) {
    val mode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    val intentionalRestartExpected by WsRepository.intentionalRestartExpected.collectAsStateWithLifecycle()
    val state = resolveConnectionDotState(mode)
    val presentation = getConnectionDotPresentation(state, intentionalRestartExpected)
    var showSheet by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .size(48.dp)
            .clickable { showSheet = true }
            .semantics {
                contentDescription = presentation.accessibilityDescription
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        ConnectionPulseDot(state = state, color = presentation.color)
    }

    if (showSheet) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ConnectionSheet(sheetState = sheetState, onDismiss = { showSheet = false })
    }
}

/**
 * The 12.dp status dot with its motion. While CONNECTING it breathes continuously (scale + alpha,
 * RepeatMode.Reverse); when the link settles into CONNECTED or DISCONNECTED it gives a single bigger
 * springy "pop". Motion is a work/transition signal, so — like the sync spinner — it is suppressed
 * when the system disables animators or in Compose previews, and its cadence is theme-aware.
 */
@Composable
private fun ConnectionPulseDot(
    state: ConnectionDotState,
    color: Color,
) {
    val eightBit = LocalNexyEightBit.current
    val motionEnabled = !LocalInspectionMode.current && ValueAnimator.areAnimatorsEnabled()
    val breathing = motionEnabled && state == ConnectionDotState.CONNECTING
    val pulsePeriod = if (eightBit) 520 else 720

    // Continuous breathing while we're actively trying to reach the desktop.
    val transition = rememberInfiniteTransition(label = "connection-pulse")
    val connectingScale by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (breathing) 1.35f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(pulsePeriod, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "connection-pulse-scale",
    )
    val connectingAlpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (breathing) 0.4f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(pulsePeriod, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "connection-pulse-alpha",
    )

    // One-shot bigger "impact" pop when the link settles into a terminal state — but not on the
    // first composition (screen mount) or when the state didn't actually change.
    val impactScale = remember { Animatable(1f) }
    var lastState by remember { mutableStateOf<ConnectionDotState?>(null) }
    LaunchedEffect(state) {
        val previous = lastState
        lastState = state
        val settled = state == ConnectionDotState.CONNECTED || state == ConnectionDotState.DISCONNECTED
        if (motionEnabled && settled && previous != null && previous != state) {
            impactScale.snapTo(1.9f)
            impactScale.animateTo(
                targetValue = 1f,
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioMediumBouncy,
                    stiffness = Spring.StiffnessMediumLow,
                ),
            )
        } else {
            impactScale.snapTo(1f)
        }
    }

    val scale = connectingScale * impactScale.value
    Box(
        modifier = Modifier
            .size(12.dp)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                alpha = if (breathing) connectingAlpha else 1f
            }
            .background(color, CircleShape),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConnectionSheet(
    sheetState: SheetState,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val preferStandaloneMode by WsRepository.preferStandaloneMode.collectAsStateWithLifecycle()
    val profiles by WsRepository.profiles.collectAsStateWithLifecycle()
    val activeProfileId by WsRepository.activeProfileId.collectAsStateWithLifecycle()
    val activeConversationIds by WsRepository.activeConversationIds.collectAsStateWithLifecycle()
    val pendingConversationIds by WsRepository.pendingConversationIds.collectAsStateWithLifecycle()
    val syncInProgress by WsRepository.syncInProgress.collectAsStateWithLifecycle()
    val backgroundActivities by BackgroundActivityTracker.activities.collectAsStateWithLifecycle()

    // Hide the sheet, then run the follow-up action once it's fully gone (avoids animating a
    // navigation/disconnect underneath a dismissing sheet).
    fun dismissThen(action: () -> Unit) {
        scope.launch { sheetState.hide() }.invokeOnCompletion {
            onDismiss()
            action()
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        val activeProfile = profiles.firstOrNull { it.id == activeProfileId } ?: profiles.firstOrNull()
        Text(
            "Connection",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
        )
        activeProfile?.let { profile ->
            Text(
                profile.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
            Text(
                profile.endpoint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
            )
        }
        HorizontalDivider(
            color = MaterialTheme.colorScheme.outlineVariant,
            modifier = Modifier.padding(top = 12.dp),
        )
        StandaloneModeToggle(
            isStandaloneModeEnabled = preferStandaloneMode,
            onToggle = { prefer ->
                if (hasActiveActivity(activeConversationIds, pendingConversationIds, syncInProgress, backgroundActivities)) {
                    Toast.makeText(
                        context,
                        "Can't switch modes while a chat or generation is in progress",
                        Toast.LENGTH_SHORT,
                    ).show()
                } else {
                    WsRepository.setPreferStandaloneMode(prefer)
                }
            },
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        if (profiles.size > 1) {
            Text(
                "Saved servers",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
            )
            profiles.forEach { profile ->
                SavedServerRow(
                    profile = profile,
                    isActive = profile.id == activeProfileId,
                    onSelect = { dismissThen { WsRepository.switchProfile(profile.id) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FilledTonalButton(
                onClick = { dismissThen { AppNavigator.navigate("home/add-server") } },
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.small,
            ) {
                NexyIcon(
                    NexyIconName.Scan,
                    contentDescription = null,
                    modifier = Modifier.padding(end = 8.dp),
                )
                Text("Scan new QR code")
            }
            OutlinedButton(
                onClick = { dismissThen { WsRepository.disconnect() } },
                enabled = connectionState != ConnectionState.DISCONNECTED,
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.small,
            ) {
                Text("Disconnect")
            }
        }
        Spacer(Modifier.padding(bottom = 8.dp))
    }
}

@Composable
private fun SavedServerRow(
    profile: PairedServerProfile,
    isActive: Boolean,
    onSelect: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (!isActive) Modifier.clickable(onClick = onSelect) else Modifier)
            .padding(horizontal = 20.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                profile.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                profile.endpoint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (isActive) {
            Text(
                "Active",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
    }
}
