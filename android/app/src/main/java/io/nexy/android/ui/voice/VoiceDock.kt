package io.nexy.android.ui.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.nexy.android.data.PreferenceStore
import io.nexy.android.data.VoiceDockPreferenceOrientation
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.roundToInt

private sealed interface VoiceGestureIntent {
    data object Released : VoiceGestureIntent
    data class Drag(
        val change: PointerInputChange,
        val dragAmount: Offset,
    ) : VoiceGestureIntent
    data object Held : VoiceGestureIntent
}

private suspend fun AwaitPointerEventScope.awaitReleaseOrDrag(
    down: PointerInputChange,
): VoiceGestureIntent {
    var dragAmount = Offset.Zero
    while (true) {
        val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
            ?: return VoiceGestureIntent.Released
        if (!change.pressed) return VoiceGestureIntent.Released
        dragAmount += change.positionChange()
        if (dragAmount.getDistance() > viewConfiguration.touchSlop) {
            return VoiceGestureIntent.Drag(change, dragAmount)
        }
    }
}

@Composable
fun VoiceDock(
    state: VoiceDockUiState,
    preferences: PreferenceStore,
    onStartRecording: () -> Unit,
    onStopRecording: () -> Unit,
    onCancelRecording: () -> Unit,
    onDock: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val haptics = LocalHapticFeedback.current
    var dockSize by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    var tapMode by remember { mutableStateOf(preferences.isVoiceDockTapMode()) }
    var showHint by remember { mutableStateOf(!preferences.hasShownVoiceDockHint()) }
    val currentState by rememberUpdatedState(state)
    val currentOnStartRecording by rememberUpdatedState(onStartRecording)
    val currentOnStopRecording by rememberUpdatedState(onStopRecording)
    val currentOnCancelRecording by rememberUpdatedState(onCancelRecording)

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val widthPx = constraints.maxWidth.toFloat()
        val heightPx = constraints.maxHeight.toFloat()
        val orientation = voiceDockOrientation(widthPx, heightPx)
        val preferenceOrientation = if (orientation == VoiceDockOrientation.PORTRAIT) {
            VoiceDockPreferenceOrientation.PORTRAIT
        } else {
            VoiceDockPreferenceOrientation.LANDSCAPE
        }
        val initial = remember(preferenceOrientation) {
            preferences.getVoiceDockPosition(preferenceOrientation).let {
                NormalizedDockPosition(it.first, it.second)
            }
        }
        var normalizedPosition by remember(preferenceOrientation) { mutableStateOf(initial) }
        val safeDrawing = WindowInsets.safeDrawing
        val ime = WindowInsets.ime
        val bounds = VoiceDockSafeBounds(
            widthPx = widthPx,
            heightPx = heightPx,
            dockWidthPx = dockSize.width.toFloat(),
            dockHeightPx = dockSize.height.toFloat(),
            leftInsetPx = safeDrawing.getLeft(density, layoutDirection).toFloat(),
            topInsetPx = safeDrawing.getTop(density).toFloat(),
            rightInsetPx = safeDrawing.getRight(density, layoutDirection).toFloat(),
            bottomInsetPx = safeDrawing.getBottom(density).toFloat(),
            imeHeightPx = ime.getBottom(density).toFloat(),
        )
        val pixelPosition = normalizedPosition.toPixels(bounds)
        val moveDockBy: (Float, Float) -> Unit = { deltaX, deltaY ->
            val current = normalizedPosition.toPixels(bounds)
            normalizedPosition = DockPixelPosition(
                current.x + deltaX,
                current.y + deltaY,
            ).toNormalized(bounds)
        }
        val finishDockMove = {
            preferences.setVoiceDockPosition(
                preferenceOrientation,
                normalizedPosition.x,
                normalizedPosition.y,
            )
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }

        Surface(
            modifier = Modifier
                .offset { IntOffset(pixelPosition.x.roundToInt(), pixelPosition.y.roundToInt()) }
                .onSizeChanged { dockSize = it }
                .alpha(if (state.busy) 0.98f else 0.72f),
            shape = RoundedCornerShape(28.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            tonalElevation = 6.dp,
            shadowElevation = 8.dp,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                val toggleRecording = {
                    showHint = false
                    preferences.setVoiceDockHintShown()
                    if (currentState.recording) {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        currentOnStopRecording()
                    } else if (!currentState.busy) {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        currentOnStartRecording()
                    }
                }
                Row(
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(width = 32.dp, height = 120.dp)
                            .semantics {
                                contentDescription = "Move microphone"
                                role = Role.Button
                            }
                            .pointerInput(bounds, preferenceOrientation) {
                                detectDragGestures(
                                    onDragStart = {
                                        showHint = false
                                        preferences.setVoiceDockHintShown()
                                    },
                                    onDragEnd = {
                                        preferences.setVoiceDockPosition(
                                            preferenceOrientation,
                                            normalizedPosition.x,
                                            normalizedPosition.y,
                                        )
                                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    },
                                ) { change, dragAmount ->
                                    change.consume()
                                    moveDockBy(dragAmount.x, dragAmount.y)
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Default.DragHandle,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Box(
                        modifier = Modifier
                            .size(60.dp)
                            .background(
                                color = if (state.recording) MaterialTheme.colorScheme.error
                                else MaterialTheme.colorScheme.primary,
                                shape = CircleShape,
                            )
                            .semantics {
                                role = Role.Button
                                contentDescription = voiceDockStateLabel(state, tapMode)
                                onClick {
                                    toggleRecording()
                                    true
                                }
                            }
                            .pointerInput(tapMode, bounds, preferenceOrientation) {
                                awaitEachGesture {
                                    val down = awaitFirstDown(requireUnconsumed = false)
                                    val intent = if (tapMode) {
                                        awaitReleaseOrDrag(down)
                                    } else {
                                        withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                                            awaitReleaseOrDrag(down)
                                        } ?: VoiceGestureIntent.Held
                                    }

                                    when (intent) {
                                        VoiceGestureIntent.Released -> {
                                            if (tapMode) toggleRecording()
                                        }
                                        is VoiceGestureIntent.Drag -> {
                                            showHint = false
                                            preferences.setVoiceDockHintShown()
                                            intent.change.consume()
                                            moveDockBy(intent.dragAmount.x, intent.dragAmount.y)
                                            var change = awaitPointerEvent().changes
                                                .firstOrNull { it.id == down.id }
                                            while (change != null && change.pressed) {
                                                val currentChange = change
                                                val delta = currentChange.positionChange()
                                                if (delta.x != 0f || delta.y != 0f) {
                                                    currentChange.consume()
                                                    moveDockBy(delta.x, delta.y)
                                                }
                                                change = awaitPointerEvent().changes
                                                    .firstOrNull { it.id == down.id }
                                                    ?: break
                                            }
                                            finishDockMove()
                                        }
                                        VoiceGestureIntent.Held -> {
                                            showHint = false
                                            preferences.setVoiceDockHintShown()
                                            if (!currentState.busy) {
                                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                                currentOnStartRecording()
                                                if (waitForUpOrCancellation() != null) {
                                                    currentOnStopRecording()
                                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                                } else {
                                                    currentOnCancelRecording()
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (state.busy && !state.recording) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(22.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        } else {
                            Icon(
                                if (state.recording) Icons.Default.Stop else Icons.Default.Mic,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onPrimary,
                                modifier = Modifier.size(28.dp),
                            )
                        }
                        if (state.recording) {
                            Box(
                                modifier = Modifier
                                    .align(Alignment.BottomCenter)
                                    .size(width = (10 + state.recorder.level * 36).dp, height = 3.dp)
                                    .background(Color.White.copy(alpha = 0.9f), RoundedCornerShape(2.dp)),
                            )
                        }
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        IconButton(
                            onClick = if (state.recording) onCancelRecording else {
                                {
                                    tapMode = !tapMode
                                    preferences.setVoiceDockTapMode(tapMode)
                                }
                            },
                            modifier = Modifier.size(44.dp),
                        ) {
                            Icon(
                                if (state.recording) Icons.Default.Close else Icons.Default.TouchApp,
                                contentDescription = if (state.recording) "Cancel recording"
                                else if (tapMode) "Use hold to record" else "Use tap to record",
                                modifier = Modifier.size(24.dp),
                            )
                        }
                        IconButton(
                            onClick = {
                                normalizedPosition = NormalizedDockPosition(1f, 0.72f)
                                preferences.resetVoiceDockPosition(preferenceOrientation)
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            },
                            modifier = Modifier.size(44.dp),
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = "Reset microphone position", modifier = Modifier.size(21.dp))
                        }
                        IconButton(
                            onClick = {
                                if (state.busy) onCancelRecording()
                                preferences.setVoiceDockFloating(false)
                                onDock()
                            },
                            modifier = Modifier.size(44.dp),
                        ) {
                            Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Dock microphone", modifier = Modifier.size(22.dp))
                        }
                    }
                }
                if (showHint) {
                    Surface(
                        color = MaterialTheme.colorScheme.inverseSurface,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text(
                            "Drag the grip or microphone to move. ${if (tapMode) "Tap" else "Hold still"} to record.",
                            modifier = Modifier
                                .padding(horizontal = 8.dp, vertical = 5.dp)
                                .semantics {
                                onClick {
                                    showHint = false
                                    preferences.setVoiceDockHintShown()
                                    true
                                }
                                },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.inverseOnSurface,
                        )
                    }
                }
            }
        }
    }
}
