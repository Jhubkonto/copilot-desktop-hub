package io.nexy.android.ui.fileviewer

import android.graphics.Color as AndroidColor
import android.text.method.LinkMovementMethod
import android.widget.TextView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tables.TableTheme
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.linkify.LinkifyPlugin
import io.noties.markwon.syntax.Prism4jTheme
import io.noties.markwon.syntax.SyntaxHighlightPlugin
import io.noties.prism4j.Prism4j
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar
import io.noties.markwon.Markwon
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.async
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

@Composable
fun MarkdownViewerScreen(path: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val colorScheme = MaterialTheme.colorScheme
    val markwon = remember(context, colorScheme) {
        val prism4j = Prism4j(io.nexy.android.GrammarLocatorDef())
        val codeTheme = object : Prism4jTheme {
            override fun background(): Int = 0xFF1E1F2E.toInt()
            override fun textColor(): Int = 0xFFE8EAF6.toInt()
            override fun apply(language: String, syntax: Prism4j.Syntax, builder: android.text.SpannableStringBuilder, start: Int, end: Int) = Unit
        }
        val dip = io.noties.markwon.utils.Dip.create(context)
        val tableTheme = TableTheme.emptyBuilder()
            .tableBorderColor(colorScheme.outlineVariant.toArgb())
            .tableBorderWidth(dip.toPx(1))
            .tableCellPadding(dip.toPx(8))
            .tableHeaderRowBackgroundColor(colorScheme.surfaceVariant.toArgb())
            .tableEvenRowBackgroundColor(colorScheme.surface.toArgb())
            .tableOddRowBackgroundColor(colorScheme.surfaceVariant.copy(alpha = 0.3f).toArgb())
            .build()
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(tableTheme))
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(SyntaxHighlightPlugin.create(prism4j, codeTheme))
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(TaskListPlugin.create(colorScheme.primary.toArgb(), colorScheme.onPrimary.toArgb(), colorScheme.outline.toArgb()))
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder.linkColor(colorScheme.primary.toArgb())
                        .codeTextColor(colorScheme.onSurfaceVariant.toArgb())
                        .codeBackgroundColor(colorScheme.surfaceVariant.toArgb())
                        .blockQuoteColor(colorScheme.outline.toArgb())
                }
            })
            .build()
    }
    val onSurfaceArgb = colorScheme.onSurface.toArgb()
    var content by remember(path) { mutableStateOf<String?>(null) }
    var error by remember(path) { mutableStateOf<String?>(null) }
    var truncated by remember(path) { mutableStateOf(false) }
    var reloadKey by remember(path) { mutableStateOf(0) }

    LaunchedEffect(path, reloadKey) {
        content = null
        error = null
        truncated = false
        // Subscribe before sending. SharedFlow does not replay, so sending first can lose a
        // very fast desktop response and leave the viewer stuck on its loading state.
        val requestId = UUID.randomUUID().toString()
        val response = async {
            withTimeoutOrNull(15_000) {
                WsRepository.events
                    .filterIsInstance<WsEvent.FsFileContent>()
                    .first { it.path == path && it.requestId == requestId }
            }
        }
        WsRepository.readFile(path, requestId)
        val event = response.await()
        if (event == null) {
            error = "The desktop did not respond. Check the connection and try again."
        } else {
            error = event.error
            content = event.content.takeIf { event.error == null }
            truncated = event.truncated
        }
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(path.substringAfterLast('/').substringAfterLast('\\')) },
                onBack = onBack,
            )
        },
    ) { padding ->
        when {
            error != null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                androidx.compose.foundation.layout.Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                    androidx.compose.material3.TextButton(onClick = { reloadKey++ }) { Text("Retry") }
                }
            }
            content == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text("Loading document…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> androidx.compose.foundation.layout.Column(
                Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            ) {
                if (truncated) {
                    Text("This document is very large; only the first 500 KB is shown.", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 12.dp))
                }
                AndroidView(
                    modifier = Modifier.fillMaxWidth().wrapContentHeight(),
                    factory = {
                        TextView(context).apply {
                            setTextColor(AndroidColor.TRANSPARENT)
                            setTextIsSelectable(true)
                            movementMethod = LinkMovementMethod.getInstance()
                            textSize = 15f
                        }
                    },
                    update = { view ->
                        view.setTextColor(onSurfaceArgb)
                        markwon.setMarkdown(view, content.orEmpty())
                    },
                )
            }
        }
    }
}
