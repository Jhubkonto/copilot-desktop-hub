package io.nexy.android.ui.chat

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** Streaming content is authoritative and visible immediately. */
@Composable
fun rememberRevealedText(fullText: String): String = fullText

/** Retained compatibility boundary for callers migrated from streamed fades. */
@Composable
fun rememberStreamFadeAlpha(revealTrigger: Any?): Float = 1f

/** No visual transition is applied. */
fun Modifier.streamFade(alpha: Float): Modifier = this
