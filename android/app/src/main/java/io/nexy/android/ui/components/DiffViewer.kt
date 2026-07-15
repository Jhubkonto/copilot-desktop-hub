package io.nexy.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import org.json.JSONArray

@Composable
fun NexyDiffContent(
    diffText: String,
    modifier: Modifier = Modifier,
) {
    // SelectionContainer enables the standard Android long-press-to-select/copy gesture on the
    // diff text — without it, Text is display-only and the content can't be copied out.
    SelectionContainer {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(8.dp),
        ) {
            diffText.lines().forEach { line ->
                val bg = when {
                    line.startsWith("+") -> Color(0xFF22C55E).copy(alpha = 0.12f)
                    line.startsWith("-") -> Color(0xFFEF4444).copy(alpha = 0.12f)
                    line.startsWith("@@") -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.4f)
                    else -> Color.Transparent
                }
                val textColor = when {
                    line.startsWith("+") -> Color(0xFF22C55E)
                    line.startsWith("-") -> Color(0xFFEF4444)
                    line.startsWith("@@") -> MaterialTheme.colorScheme.onSecondaryContainer
                    else -> MaterialTheme.colorScheme.onSurface
                }
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(bg),
                ) {
                    Text(
                        text = line,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = textColor,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                }
            }
        }
    }
}

fun renderDiffHunks(hunksJson: String): String {
    return try {
        val hunks = JSONArray(hunksJson)
        buildString {
            for (i in 0 until hunks.length()) {
                val hunk = hunks.getJSONObject(i)
                val header = hunk.optString("header")
                if (header.isNotBlank()) appendLine(header)
                val lines = hunk.optJSONArray("lines")
                if (lines != null) {
                    for (j in 0 until lines.length()) {
                        val lineObj = lines.optJSONObject(j)
                        if (lineObj != null) {
                            val kind = lineObj.optString("kind", " ")
                            val content = lineObj.optString("content", "")
                            val prefix = when (kind) {
                                "add" -> "+"
                                "del" -> "-"
                                else -> " "
                            }
                            appendLine("$prefix$content")
                        } else {
                            appendLine(lines.optString(j, ""))
                        }
                    }
                }
            }
        }.trimEnd()
    } catch (_: Exception) {
        hunksJson
    }
}
