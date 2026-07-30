package io.nexy.android.ui.voice

data class NormalizedDockPosition(val x: Float, val y: Float) {
    fun clamped(): NormalizedDockPosition = NormalizedDockPosition(
        x = if (x.isFinite()) x.coerceIn(0f, 1f) else 1f,
        y = if (y.isFinite()) y.coerceIn(0f, 1f) else 1f,
    )
}

data class VoiceDockSafeBounds(
    val widthPx: Float,
    val heightPx: Float,
    val dockWidthPx: Float,
    val dockHeightPx: Float,
    val leftInsetPx: Float = 0f,
    val topInsetPx: Float = 0f,
    val rightInsetPx: Float = 0f,
    val bottomInsetPx: Float = 0f,
    val imeHeightPx: Float = 0f,
    val composerHeightPx: Float = 0f,
)

data class DockPixelPosition(val x: Float, val y: Float)

enum class VoiceDockOrientation { PORTRAIT, LANDSCAPE }

fun voiceDockOrientation(widthPx: Float, heightPx: Float): VoiceDockOrientation =
    if (widthPx > heightPx) VoiceDockOrientation.LANDSCAPE else VoiceDockOrientation.PORTRAIT

fun NormalizedDockPosition.toPixels(bounds: VoiceDockSafeBounds): DockPixelPosition {
    val safe = clamped()
    val horizontalSpace = (
        bounds.widthPx - bounds.leftInsetPx - bounds.rightInsetPx - bounds.dockWidthPx
    ).coerceAtLeast(0f)
    val avoidedBottom = maxOf(bounds.bottomInsetPx, bounds.imeHeightPx) + bounds.composerHeightPx
    val verticalSpace = (
        bounds.heightPx - bounds.topInsetPx - avoidedBottom - bounds.dockHeightPx
    ).coerceAtLeast(0f)
    return DockPixelPosition(
        x = bounds.leftInsetPx + safe.x * horizontalSpace,
        y = bounds.topInsetPx + safe.y * verticalSpace,
    )
}

fun DockPixelPosition.toNormalized(bounds: VoiceDockSafeBounds): NormalizedDockPosition {
    val horizontalSpace = (
        bounds.widthPx - bounds.leftInsetPx - bounds.rightInsetPx - bounds.dockWidthPx
    ).coerceAtLeast(0f)
    val avoidedBottom = maxOf(bounds.bottomInsetPx, bounds.imeHeightPx) + bounds.composerHeightPx
    val verticalSpace = (
        bounds.heightPx - bounds.topInsetPx - avoidedBottom - bounds.dockHeightPx
    ).coerceAtLeast(0f)
    return NormalizedDockPosition(
        x = if (horizontalSpace == 0f) 0f else (x - bounds.leftInsetPx) / horizontalSpace,
        y = if (verticalSpace == 0f) 0f else (y - bounds.topInsetPx) / verticalSpace,
    ).clamped()
}
