package io.nexy.android.ui.projectpeek

import android.app.Application
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.ProjectPeekEntry
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.NexyTopAppBar
import java.text.DateFormat
import java.util.Date

@Composable
fun ProjectPeekScreen(
    projectId: String,
    onBack: () -> Unit,
    onPreview: (sourceId: String, entry: ProjectPeekEntry) -> Unit,
    vm: ProjectPeekViewModel? = null,
) {
    val application = LocalContext.current.applicationContext as Application
    val model = vm ?: viewModel(factory = remember(projectId, application) {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>) =
                ProjectPeekViewModel(application, projectId) as T
        }
    })
    BackHandler(enabled = model.state.value.relativePath.isNotBlank()) { model.goUp() }
    val state by model.state.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    Scaffold(topBar = {
        NexyTopAppBar(
            titleContent = { Text("Project Peek") },
            onBack = onBack,
            actions = { if (state.relativePath.isNotBlank()) TextButton(onClick = model::goUp) { Text("Up") } },
        )
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (state.sources.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    state.sources.forEach { source ->
                            TextButton(onClick = { model.selectSource(source.id) }, enabled = source.id != state.sourceId) {
                            Text(if (source.isPrimary) "${source.label} · Primary" else source.label, maxLines = 1)
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    listOf("all" to "All", "documents" to "Documents", "images" to "Images", "recent" to "Recently changed").forEach { (value, label) ->
                        TextButton(onClick = { model.setFilter(value) }, enabled = state.filter != value) { Text(label) }
                    }
                }
                if (state.relativePath.isNotBlank()) {
                    Text(state.relativePath, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                }
                HorizontalDivider()
            }
            when {
                connectionState != ConnectionState.CONNECTED -> CenterMessage("Connect to your paired desktop to browse project files")
                state.loading -> CenterMessage("Loading project files…")
                state.error != null -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(state.error.orEmpty(), color = MaterialTheme.colorScheme.error)
                    Button(onClick = model::retry) { Text("Retry") }
                }
                state.truncated -> Text("Showing the first 1,000 files in this folder.", modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (connectionState == ConnectionState.CONNECTED) {
                if (!state.loading && state.error == null && state.entries.isEmpty()) CenterMessage("This folder has no matching files")
                else if (!state.loading && state.error == null) LazyColumn(Modifier.fillMaxSize()) {
                    items(state.entries, key = { it.relativePath }) { entry ->
                        ProjectPeekRow(entry, onClick = {
                            if (entry.isDirectory) model.open(entry.relativePath)
                            else state.sourceId?.let { onPreview(it, entry) }
                        })
                    }
                }
            }
        }
    }
}

@Composable private fun CenterMessage(message: String) = androidx.compose.foundation.layout.Box(
    Modifier.fillMaxSize(), contentAlignment = Alignment.Center,
) { Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant) }

@Composable private fun ProjectPeekRow(entry: ProjectPeekEntry, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp)) {
        Text(if (entry.isDirectory) "📁  ${entry.name}" else entry.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (!entry.isDirectory) Text(
            "${entry.category} · ${entry.sizeBytes} bytes · ${entry.gitState} · ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(entry.modifiedAt))}",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
