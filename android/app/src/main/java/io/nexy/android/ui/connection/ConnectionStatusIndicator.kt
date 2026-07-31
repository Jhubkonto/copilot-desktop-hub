package io.nexy.android.ui.connection

import android.animation.ValueAnimator
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.SyncProblem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.nexy.android.data.WsRepository

private val ConnectedGreen = Color(0xFF22C55E)
private val SyncingAmber = Color(0xFFF59E0B)
private val StandalonePurple = Color(0xFF8B5CF6)
private val ErrorRed = Color(0xFFEF4444)

@Composable
fun ConnectionStatusIndicator(
    contentSyncInProgress: Boolean? = null,
    modifier: Modifier = Modifier,
) {
    val mode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    val syncInProgress by WsRepository.syncInProgress.collectAsStateWithLifecycle()
    val syncProgress by WsRepository.syncProgress.collectAsStateWithLifecycle()
    val capabilities by WsRepository.capabilities.collectAsStateWithLifecycle()
    val state = resolveConnectionIndicatorState(
        mode = mode,
        syncInProgress = syncInProgress,
        pendingChanges = capabilities.pendingChanges,
        failedChanges = capabilities.failedChanges,
        conflicts = capabilities.conflicts,
        contentSyncInProgress = contentSyncInProgress,
    )
    val motionEnabled = !LocalInspectionMode.current && ValueAnimator.areAnimatorsEnabled()

    val progressLabel =
        if (contentSyncInProgress == null && state == ConnectionIndicatorState.SYNCING && syncProgress.total > 0) {
            "${syncProgress.completed} of ${syncProgress.total}"
        } else {
            null
        }
    Row(
        modifier = modifier
            .semantics {
                contentDescription = listOfNotNull(state.accessibilityDescription, progressLabel).joinToString(", ")
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Box(modifier = Modifier.size(48.dp), contentAlignment = Alignment.Center) {
            AnimatedContent(
                targetState = state,
                transitionSpec = {
                    if (motionEnabled) {
                        (fadeIn(tween(180)) + scaleIn(tween(180), initialScale = 0.86f))
                            .togetherWith(fadeOut(tween(140)) + scaleOut(tween(140), targetScale = 0.92f))
                    } else {
                        EnterTransition.None togetherWith ExitTransition.None
                    }
                },
                label = "connection-status",
            ) { target ->
                ConnectionStatusGlyph(target, motionEnabled)
            }
        }
        if (progressLabel != null) {
            Text(
                text = progressLabel,
                style = MaterialTheme.typography.labelSmall,
                color = SyncingAmber,
            )
        }
    }
}

@Composable
private fun ConnectionStatusGlyph(
    state: ConnectionIndicatorState,
    motionEnabled: Boolean,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "connection-status-motion")
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = if (motionEnabled && state == ConnectionIndicatorState.SYNCING) 360f else 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1_600, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "sync-rotation",
    )
    val errorAlpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (motionEnabled && state == ConnectionIndicatorState.ERROR) 0.62f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1_500, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "error-pulse",
    )
    val entryScale = androidx.compose.runtime.remember { Animatable(1f) }
    val errorOffset = androidx.compose.runtime.remember { Animatable(0f) }
    val shakeDistance = with(LocalDensity.current) { 3.5.dp.toPx() }

    LaunchedEffect(state, motionEnabled) {
        entryScale.snapTo(if (motionEnabled) 0.72f else 1f)
        if (motionEnabled) entryScale.animateTo(1f, tween(280, easing = FastOutSlowInEasing))
    }
    LaunchedEffect(state, motionEnabled) {
        errorOffset.snapTo(0f)
        if (motionEnabled && state == ConnectionIndicatorState.ERROR) {
            errorOffset.animateTo(
                0f,
                keyframes {
                    durationMillis = 360
                    0f at 0
                    -shakeDistance at 70
                    shakeDistance at 140
                    -(shakeDistance * 0.7f) at 210
                    (shakeDistance * 0.55f) at 280
                    0f at 360
                },
            )
        }
    }

    when (state) {
        ConnectionIndicatorState.CONNECTED -> Box(
            modifier = Modifier.size(26.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Default.Devices,
                contentDescription = null,
                tint = ConnectedGreen,
                modifier = Modifier.size(22.dp),
            )
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = null,
                tint = ConnectedGreen,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .size(11.dp)
                    .scale(entryScale.value),
            )
        }

        ConnectionIndicatorState.SYNCING -> Icon(
            Icons.Default.Sync,
            contentDescription = null,
            tint = SyncingAmber,
            modifier = Modifier
                .size(22.dp)
                .graphicsLayer(rotationZ = rotation),
        )

        ConnectionIndicatorState.STANDALONE -> Box(
            modifier = Modifier.size(26.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Default.PhoneAndroid,
                contentDescription = null,
                tint = StandalonePurple,
                modifier = Modifier.size(22.dp),
            )
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .size(8.dp)
                    .scale(entryScale.value)
                    .background(StandalonePurple, CircleShape),
            )
        }

        ConnectionIndicatorState.ERROR -> Icon(
            Icons.Default.SyncProblem,
            contentDescription = null,
            tint = ErrorRed,
            modifier = Modifier
                .size(22.dp)
                .graphicsLayer(
                    translationX = errorOffset.value,
                    alpha = errorAlpha,
                ),
        )
    }
}

private val ConnectionIndicatorState.accessibilityDescription: String
    get() = when (this) {
        ConnectionIndicatorState.CONNECTED -> "Connected to desktop and up to date"
        ConnectionIndicatorState.SYNCING -> "Synchronizing with desktop"
        ConnectionIndicatorState.STANDALONE -> "Standalone mode"
        ConnectionIndicatorState.ERROR -> "Connection or synchronization problem"
    }
