package io.nexy.android.ui.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.home.projectColor
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName

/**
 * Project landing surface: the verbs you come to a project to *do* (Files, Wiki,
 * Artifacts, Workflows) plus Settings, as a grid of tappable cards. Chats are intentionally
 * omitted — tapping the project in the Home list already opens its conversations. This replaces
 * the old model of landing directly on the settings form and hunting for those actions inside a
 * collapsed "Project Tools" accordion.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectHomeScreen(
    projectId: String,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenFiles: () -> Unit,
    onOpenWiki: () -> Unit,
    onOpenArtifacts: () -> Unit,
    onOpenWorkflow: () -> Unit,
) {
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val project = projects.find { it.id == projectId }
    val accent = projectColor(project?.color ?: "blue")

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        project?.name ?: "Project",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                onBack = onBack,
            )
        },
    ) { padding ->
        if (project == null) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Project not found.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onBack) { Text("Go back") }
            }
            return@Scaffold
        }

        val tools = listOf(
            ProjectTool("Files", "Browse folders, read docs", NexyIconName.Folder, onOpenFiles),
            ProjectTool("Wiki", "Notes & knowledge", NexyIconName.File, onOpenWiki),
            ProjectTool("Artifacts", "Generated from chats", NexyIconName.Artifact, onOpenArtifacts),
            ProjectTool("Workflows", "Goal → self-running plan", NexyIconName.Workflow, onOpenWorkflow),
            ProjectTool("Settings", "Model, sources, instructions", NexyIconName.Settings, onOpenSettings),
        )

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Text(
                    "Everything for this project in one place. Tap a tile to jump in.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp),
                )
            }
            items(tools, key = { it.title }) { tool -> ProjectToolCard(tool, accent) }
        }
    }
}

private data class ProjectTool(
    val title: String,
    val subtitle: String,
    val icon: NexyIconName,
    val onClick: () -> Unit,
)

@Composable
private fun ProjectToolCard(tool: ProjectTool, accent: androidx.compose.ui.graphics.Color) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .height(112.dp)
            .clickable(onClick = tool.onClick),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .background(accent.copy(alpha = 0.15f), RoundedCornerShape(9.dp)),
                contentAlignment = Alignment.Center,
            ) {
                NexyIcon(
                    name = tool.icon,
                    contentDescription = null,
                    modifier = Modifier.size(19.dp),
                    tint = accent,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(
                    tool.title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    tool.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
