package io.nexy.android.ui.share

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.share.ShareIntentRepository
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.home.projectColor

@Composable
fun ShareToChatScreen(
    batchId: String,
    onBack: () -> Unit,
    onSelectConversation: (String) -> Unit,
    onNewChat: (String?) -> Unit,
) {
    val context = LocalContext.current
    val batch = remember(batchId) { ShareIntentRepository.load(context, batchId) }
    val conversations by WsRepository.conversations.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    var selectedTab by remember { mutableStateOf(0) }
    var selectedProject by remember { mutableStateOf<Project?>(null) }
    var query by remember { mutableStateOf("") }

    val filteredConversations = remember(conversations, query, selectedProject) {
        val needle = query.trim()
        val scoped = selectedProject?.let { project -> conversations.filter { it.project_id == project.id } } ?: conversations
        scoped
            .filterNot { it.archived }
            .filter {
                needle.isBlank() || it.title.contains(needle, ignoreCase = true) ||
                    it.project_name?.contains(needle, ignoreCase = true) == true ||
                    it.agent_name?.contains(needle, ignoreCase = true) == true
            }
            .sortedWith(compareByDescending<Conversation> { it.pinned }.thenByDescending { it.updated_at })
    }
    val filteredProjects = remember(projects, query) {
        val needle = query.trim()
        projects.filter { needle.isBlank() || it.name.contains(needle, ignoreCase = true) }
            .sortedByDescending { it.chatCount }
    }

    LaunchedEffect(Unit) { WsRepository.listConversations() }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(selectedProject?.name ?: "Share to chat") },
                onBack = {
                    val project = selectedProject
                    if (project != null) {
                        selectedProject = null
                    } else {
                        ShareIntentRepository.discard(context, batchId)
                        onBack()
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            val accepted = batch?.attachments?.size ?: 0
            val description = buildString {
                if (accepted > 0) append("$accepted file${if (accepted == 1) "" else "s"}")
                if (!batch?.text.isNullOrBlank()) append(if (isNotEmpty()) " + shared text" else "Shared text")
                if ((batch?.rejectedCount ?: 0) > 0) append(" · ${batch?.rejectedCount} skipped")
            }
            Text(
                description.ifBlank { "Shared content" },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.secondary,
            )

            if (selectedProject == null) {
                PrimaryTabRow(selectedTabIndex = selectedTab) {
                    listOf("Chats", "Projects").forEachIndexed { index, title ->
                        Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = { Text(title, style = MaterialTheme.typography.labelLarge) },
                        )
                    }
                }
            }

            NexySearchField(
                query,
                { query = it },
                if (selectedProject == null && selectedTab == 1) "Search projects" else "Search conversations",
            )

            when {
                selectedProject == null && selectedTab == 1 -> LazyColumn(Modifier.fillMaxSize()) {
                    items(filteredProjects, key = { it.id }) { project ->
                        ProjectRow(project = project, onClick = { selectedProject = project; query = "" })
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    if (filteredProjects.isEmpty()) {
                        item {
                            Text(
                                if (query.isBlank()) "No projects yet." else "No matching projects.",
                                modifier = Modifier.padding(24.dp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        val project = selectedProject
                        ListItem(
                            headlineContent = { Text(if (project != null) "New chat in ${project.name}" else "New chat") },
                            supportingContent = { Text("Review the attachments before sending") },
                            leadingContent = { Icon(Icons.Default.Add, contentDescription = null) },
                            modifier = Modifier.clickable { onNewChat(project?.id) },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    items(filteredConversations, key = { it.id }) { conversation ->
                        ListItem(
                            headlineContent = { Text(conversation.title.ifBlank { "Chat" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            supportingContent = {
                                val scope = conversation.project_name ?: conversation.agent_name ?: conversation.last_message
                                if (!scope.isNullOrBlank()) Text(scope, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            },
                            trailingContent = {
                                if (conversation.pinned) Icon(Icons.Default.PushPin, contentDescription = "Pinned")
                            },
                            modifier = Modifier.clickable { onSelectConversation(conversation.id) },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    if (filteredConversations.isEmpty()) {
                        item {
                            Text(
                                if (query.isBlank()) "No conversations yet." else "No matching conversations.",
                                modifier = Modifier.padding(24.dp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectRow(project: Project, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().height(64.dp).clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(4.dp).fillMaxHeight().background(projectColor(project.color)))
        Column(modifier = Modifier.padding(horizontal = 16.dp)) {
            Text(project.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${project.chatCount} chat${if (project.chatCount == 1) "" else "s"}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
