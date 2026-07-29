package io.nexy.android.ui.debrief

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserException
import org.xmlpull.v1.XmlPullParserFactory

/**
 * Hand-rolled validator + renderer for model-generated story-beat SVGs, mirroring the closed
 * grammar enforced on desktop by src/renderer/lib/story-svg.ts (sanitizeStorySvg). Android has
 * no DOM/SVG parser available, so this walks the markup with the platform's built-in
 * XmlPullParser instead and draws matching primitives on a Compose Canvas. Any element, attr,
 * or size outside the allowlist below fails validation and the caller should fall back to the
 * beat's mood emoji — exactly like the desktop fallback path.
 */
private object StorySvgGrammar {
    // Mirrors story-svg.ts ALLOWED_TAGS.
    val ALLOWED_TAGS = setOf("svg", "g", "circle", "rect", "line", "path", "polygon", "polyline")

    // Mirrors story-svg.ts ALLOWED_COLOR_VALUES.
    val ALLOWED_COLOR_VALUES = setOf("currentcolor", "var(--story-accent)", "none")

    // Mirrors story-svg.ts MAX_ELEMENTS.
    const val MAX_ELEMENTS = 12

    // Mirrors story-svg.ts MAX_LENGTH.
    const val MAX_LENGTH = 4000

    const val EXPECTED_VIEW_BOX = "0 0 100 100"
}

/** One parsed, grammar-validated SVG primitive ready to be drawn. */
internal sealed class StorySvgNode {
    data class Circle(val cx: Float, val cy: Float, val r: Float, val fill: String?, val stroke: String?) : StorySvgNode()
    data class Rect(val x: Float, val y: Float, val width: Float, val height: Float, val fill: String?, val stroke: String?) : StorySvgNode()
    data class Line(val x1: Float, val y1: Float, val x2: Float, val y2: Float, val stroke: String?) : StorySvgNode()
    data class PathNode(val d: String, val fill: String?, val stroke: String?) : StorySvgNode()
    data class Polygon(val points: List<Offset>, val fill: String?, val stroke: String?) : StorySvgNode()
    data class Polyline(val points: List<Offset>, val fill: String?, val stroke: String?) : StorySvgNode()
}

/**
 * Parses and validates [raw] against the same closed grammar as story-svg.ts. Returns the list
 * of drawable primitives (never including the `svg`/`g` wrapper elements themselves) or null if
 * the markup is empty, oversized, malformed, or uses any tag/attribute/value outside the
 * allowlist — mirroring sanitizeStorySvg()'s null-on-any-violation behavior.
 */
internal fun parseStorySvg(raw: String): List<StorySvgNode>? {
    if (raw.isBlank() || raw.length > StorySvgGrammar.MAX_LENGTH) return null

    val nodes = mutableListOf<StorySvgNode>()
    var elementCount = 0
    var sawSvgRoot = false

    try {
        val factory = XmlPullParserFactory.newInstance()
        factory.isNamespaceAware = false
        val parser = factory.newPullParser()
        parser.setInput(raw.reader())

        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG) {
                val tag = parser.name.lowercase()
                elementCount++
                if (elementCount > StorySvgGrammar.MAX_ELEMENTS) return null
                if (tag !in StorySvgGrammar.ALLOWED_TAGS) return null

                // Validate attributes against the closed grammar regardless of tag.
                var fill: String? = null
                var stroke: String? = null
                for (i in 0 until parser.attributeCount) {
                    val name = parser.getAttributeName(i).lowercase()
                    val value = parser.getAttributeValue(i)
                    if (name.startsWith("on")) return null
                    if (name == "style" && value.contains("url(", ignoreCase = true)) return null
                    if (name == "fill" || name == "stroke") {
                        val normalized = value.trim().lowercase()
                        if (normalized.isNotEmpty() && normalized !in StorySvgGrammar.ALLOWED_COLOR_VALUES) return null
                        if (name == "fill") fill = normalized.ifEmpty { null }
                        if (name == "stroke") stroke = normalized.ifEmpty { null }
                    }
                }

                when (tag) {
                    "svg" -> {
                        if (sawSvgRoot) return null // only one root svg allowed
                        sawSvgRoot = true
                        val viewBox = parser.getAttributeValue(null, "viewBox")
                        if (viewBox != StorySvgGrammar.EXPECTED_VIEW_BOX) return null
                        if (parser.getAttributeValue(null, "width") != null) return null
                        if (parser.getAttributeValue(null, "height") != null) return null
                    }
                    "g" -> { /* pure grouping — no drawable geometry of its own */ }
                    "circle" -> {
                        val cx = parser.getAttributeValue(null, "cx")?.toFloatOrNull() ?: return null
                        val cy = parser.getAttributeValue(null, "cy")?.toFloatOrNull() ?: return null
                        val r = parser.getAttributeValue(null, "r")?.toFloatOrNull() ?: return null
                        nodes += StorySvgNode.Circle(cx, cy, r, fill, stroke)
                    }
                    "rect" -> {
                        val x = parser.getAttributeValue(null, "x")?.toFloatOrNull() ?: 0f
                        val y = parser.getAttributeValue(null, "y")?.toFloatOrNull() ?: 0f
                        val w = parser.getAttributeValue(null, "width")?.toFloatOrNull() ?: return null
                        val h = parser.getAttributeValue(null, "height")?.toFloatOrNull() ?: return null
                        nodes += StorySvgNode.Rect(x, y, w, h, fill, stroke)
                    }
                    "line" -> {
                        val x1 = parser.getAttributeValue(null, "x1")?.toFloatOrNull() ?: return null
                        val y1 = parser.getAttributeValue(null, "y1")?.toFloatOrNull() ?: return null
                        val x2 = parser.getAttributeValue(null, "x2")?.toFloatOrNull() ?: return null
                        val y2 = parser.getAttributeValue(null, "y2")?.toFloatOrNull() ?: return null
                        nodes += StorySvgNode.Line(x1, y1, x2, y2, stroke)
                    }
                    "path" -> {
                        val d = parser.getAttributeValue(null, "d") ?: return null
                        nodes += StorySvgNode.PathNode(d, fill, stroke)
                    }
                    "polygon" -> {
                        val points = parsePoints(parser.getAttributeValue(null, "points")) ?: return null
                        nodes += StorySvgNode.Polygon(points, fill, stroke)
                    }
                    "polyline" -> {
                        val points = parsePoints(parser.getAttributeValue(null, "points")) ?: return null
                        nodes += StorySvgNode.Polyline(points, fill, stroke)
                    }
                }
            }
            event = parser.next()
        }
    } catch (e: XmlPullParserException) {
        return null
    } catch (e: Exception) {
        return null
    }

    if (!sawSvgRoot) return null
    return nodes
}

private fun parsePoints(raw: String?): List<Offset>? {
    if (raw.isNullOrBlank()) return null
    val tokens = raw.trim().split(Regex("[\\s,]+")).mapNotNull { it.toFloatOrNull() }
    if (tokens.isEmpty() || tokens.size % 2 != 0) return null
    return tokens.chunked(2).map { (x, y) -> Offset(x, y) }
}

/** Very small subset of SVG path-data parsing: enough for the simple M/L/C/Z beats the story
 * system prompt produces. Unsupported commands abort the path (return what's drawn so far)
 * rather than throwing, since a partially-drawn icon is preferable to crashing the screen. */
private fun buildComposePath(d: String): Path {
    val path = Path()
    val tokens = Regex("([MLCZmlcz])|(-?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)").findAll(d).map { it.value }.toList()
    var i = 0
    var cx = 0f
    var cy = 0f
    fun nextFloat(): Float? = tokens.getOrNull(i++)?.toFloatOrNull()
    while (i < tokens.size) {
        when (tokens[i++]) {
            "M", "m" -> {
                val x = nextFloat() ?: break
                val y = nextFloat() ?: break
                cx = x; cy = y
                path.moveTo(x, y)
            }
            "L", "l" -> {
                val x = nextFloat() ?: break
                val y = nextFloat() ?: break
                cx = x; cy = y
                path.lineTo(x, y)
            }
            "C", "c" -> {
                val x1 = nextFloat() ?: break
                val y1 = nextFloat() ?: break
                val x2 = nextFloat() ?: break
                val y2 = nextFloat() ?: break
                val x = nextFloat() ?: break
                val y = nextFloat() ?: break
                path.cubicTo(x1, y1, x2, y2, x, y)
                cx = x; cy = y
            }
            "Z", "z" -> path.close()
            else -> { /* not a command token — number consumed without a leading command, skip */ }
        }
    }
    return path
}

/**
 * Draws a validated set of [StorySvgNode]s scaled from the 0..100 SVG viewBox coordinate space
 * onto the full Canvas size. `currentcolor` and `var(--story-accent)` both map to the theme
 * accent color, matching how desktop's CSS resolves them to --story-accent.
 */
@Composable
internal fun StorySvgCanvas(nodes: List<StorySvgNode>, accentColor: Color, modifier: Modifier = Modifier) {
    fun resolveColor(value: String?): Color? = when (value) {
        null, "" -> null
        "none" -> null
        "currentcolor", "var(--story-accent)" -> accentColor
        else -> null
    }

    Canvas(modifier = modifier) {
        val viewBoxScale = size.minDimension / 100f
        fun sx(v: Float) = v * viewBoxScale
        fun sy(v: Float) = v * viewBoxScale

        nodes.forEach { node ->
            when (node) {
                is StorySvgNode.Circle -> {
                    val fillColor = resolveColor(node.fill)
                    val strokeColor = resolveColor(node.stroke)
                    if (fillColor != null) {
                        drawCircle(color = fillColor, radius = sx(node.r), center = Offset(sx(node.cx), sy(node.cy)), style = Fill)
                    }
                    if (strokeColor != null) {
                        drawCircle(color = strokeColor, radius = sx(node.r), center = Offset(sx(node.cx), sy(node.cy)), style = Stroke(width = sx(1.5f)))
                    }
                    if (fillColor == null && strokeColor == null) {
                        drawCircle(color = accentColor, radius = sx(node.r), center = Offset(sx(node.cx), sy(node.cy)), style = Stroke(width = sx(1.5f)))
                    }
                }
                is StorySvgNode.Rect -> {
                    val fillColor = resolveColor(node.fill)
                    val strokeColor = resolveColor(node.stroke)
                    val topLeft = Offset(sx(node.x), sy(node.y))
                    val rectSize = androidx.compose.ui.geometry.Size(sx(node.width), sy(node.height))
                    if (fillColor != null) drawRect(color = fillColor, topLeft = topLeft, size = rectSize, style = Fill)
                    if (strokeColor != null) drawRect(color = strokeColor, topLeft = topLeft, size = rectSize, style = Stroke(width = sx(1.5f)))
                    if (fillColor == null && strokeColor == null) drawRect(color = accentColor, topLeft = topLeft, size = rectSize, style = Stroke(width = sx(1.5f)))
                }
                is StorySvgNode.Line -> {
                    val strokeColor = resolveColor(node.stroke) ?: accentColor
                    drawLine(color = strokeColor, start = Offset(sx(node.x1), sy(node.y1)), end = Offset(sx(node.x2), sy(node.y2)), strokeWidth = sx(1.5f))
                }
                is StorySvgNode.PathNode -> {
                    val fillColor = resolveColor(node.fill)
                    val strokeColor = resolveColor(node.stroke)
                    val scaledPath = Path().apply {
                        addPath(buildComposePath(node.d))
                    }
                    // Scale the path from the 0..100 viewBox space to canvas pixels via the draw
                    // transform rather than rewriting coordinates.
                    scale(viewBoxScale, viewBoxScale, Offset.Zero) {
                        if (fillColor != null) drawPath(scaledPath, color = fillColor, style = Fill)
                        if (strokeColor != null) drawPath(scaledPath, color = strokeColor, style = Stroke(width = 1.5f))
                        if (fillColor == null && strokeColor == null) drawPath(scaledPath, color = accentColor, style = Stroke(width = 1.5f))
                    }
                }
                is StorySvgNode.Polygon -> {
                    val fillColor = resolveColor(node.fill)
                    val strokeColor = resolveColor(node.stroke)
                    val p = Path().apply {
                        node.points.forEachIndexed { idx, pt ->
                            if (idx == 0) moveTo(sx(pt.x), sy(pt.y)) else lineTo(sx(pt.x), sy(pt.y))
                        }
                        close()
                    }
                    if (fillColor != null) drawPath(p, color = fillColor, style = Fill)
                    if (strokeColor != null) drawPath(p, color = strokeColor, style = Stroke(width = sx(1.5f)))
                    if (fillColor == null && strokeColor == null) drawPath(p, color = accentColor, style = Stroke(width = sx(1.5f)))
                }
                is StorySvgNode.Polyline -> {
                    val strokeColor = resolveColor(node.stroke) ?: accentColor
                    val p = Path().apply {
                        node.points.forEachIndexed { idx, pt ->
                            if (idx == 0) moveTo(sx(pt.x), sy(pt.y)) else lineTo(sx(pt.x), sy(pt.y))
                        }
                    }
                    drawPath(p, color = strokeColor, style = Stroke(width = sx(1.5f)))
                }
            }
        }
    }
}

/**
 * Composable entry point used by DebriefScreen's story-beat list: validates [svg] against the
 * closed grammar and renders it on a Canvas, or returns false (drawing nothing) so the caller
 * falls back to the beat's mood emoji — mirroring the desktop fallback in DebriefArtifactCard.
 */
@Composable
internal fun rememberStorySvgNodes(svg: String): List<StorySvgNode>? {
    return remember(svg) { parseStorySvg(svg) }
}
