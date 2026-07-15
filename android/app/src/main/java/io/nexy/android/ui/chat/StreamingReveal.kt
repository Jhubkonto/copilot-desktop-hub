package io.nexy.android.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import kotlinx.coroutines.delay
import kotlin.math.min

// Mirrors the desktop client's char-per-frame pacing (src/shared/chat-animation.ts:
// revealFrameSize) — targets a fixed total reveal duration regardless of chunk size, bounded so
// short bursts don't crawl and long ones don't dump instantly.
private const val TARGET_REVEAL_MS = 2800
private const val MIN_CHARS_PER_TICK = 2
private const val MAX_CHARS_PER_TICK = 64
private const val TICK_MS = 16L

/**
 * Incrementally reveals a growing string instead of snapping to the latest chunk on every
 * update — the Android counterpart of the desktop client's useStreamingQueue. [fullText] is
 * expected to only grow (streamed content) or reset to a shorter/empty string (a new message
 * starting), which is treated as an immediate snap rather than an animated "un-reveal".
 */
@Composable
fun rememberRevealedText(fullText: String): String {
    var revealedLen by remember { mutableStateOf(fullText.length) }
    var revealed by remember { mutableStateOf(fullText) }

    LaunchedEffect(fullText) {
        if (fullText.length < revealedLen) {
            revealedLen = fullText.length
            revealed = fullText
            return@LaunchedEffect
        }
        while (revealedLen < fullText.length) {
            val backlog = fullText.length - revealedLen
            val perTick = ((backlog.toFloat() / TARGET_REVEAL_MS) * TICK_MS)
                .toInt()
                .coerceIn(MIN_CHARS_PER_TICK, MAX_CHARS_PER_TICK)
            revealedLen = min(fullText.length, revealedLen + perTick)
            revealed = fullText.substring(0, revealedLen)
            delay(TICK_MS)
        }
    }
    return revealed
}

/**
 * A soft opacity dip-and-recover triggered each time [revealTrigger] changes (e.g. the revealed
 * length from [rememberRevealedText]) — the Compose counterpart of the desktop client's
 * `.stream-fade-in` CSS animation, giving newly-revealed text a gentle fade instead of popping
 * straight to full opacity.
 */
@Composable
fun rememberStreamFadeAlpha(revealTrigger: Any?): Float {
    val alpha = remember { Animatable(1f) }
    LaunchedEffect(revealTrigger) {
        alpha.snapTo(0.55f)
        alpha.animateTo(1f, animationSpec = tween(180))
    }
    return alpha.value
}

fun Modifier.streamFade(alpha: Float): Modifier = this.alpha(alpha)
