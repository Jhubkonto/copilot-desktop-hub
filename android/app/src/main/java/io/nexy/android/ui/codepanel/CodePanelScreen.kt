package io.nexy.android.ui.codepanel

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.launch

/**
 * Android-only `/code` panel: raw git housekeeping (branches, fetch, merge, changed files) for
 * every repo discovered under a project's workspace. Typing the desktop equivalents
 * (`/code-branch`, `/code-checkout`, `/code-fetch`, `/code-merge`) is fine on a keyboard but
 * awkward on a phone, so this trades typed commands for taps. The AI workflow itself
 * (/code-change, /code-execute, ...) stays in normal chat on both platforms — this screen is
 * purely for git bookkeeping and to kick off "resolve with AI" when a merge conflicts.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CodePanelScreen(
    projectId: String,
    onBack: () -> Unit,
    onOpenChatForConflictResolution: (conversationId: String, projectId: String) -> Unit,
    vm: CodePanelViewModel = viewModel(factory = remember(projectId) { CodePanelViewModelFactory(projectId) }),
) {
    val state by vm.state.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.actionMessage) {
        state.actionMessage?.let {
            scope.launch { snackbarHostState.showSnackbar(it) }
            vm.consumeActionMessage()
        }
    }
    LaunchedEffect(state.error) {
        state.error?.let {
            scope.launch { snackbarHostState.showSnackbar(it) }
            vm.consumeError()
        }
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(state.selectedRepoRelativePath?.ifBlank { "Repository" } ?: "Code Panel") },
                onBack = if (state.selectedRepoRelativePath != null) {
                    { vm.closeRepoDetail() }
                } else {
                    onBack
                },
                subtitle = if (state.selectedRepoRelativePath == null) "Git repos in this project" else null,
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (state.selectedRepoRelativePath == null) {
                RepoListSection(state = state, onSelectRepo = vm::selectRepo)
            } else {
                RepoDetailSection(
                    vm = vm,
                    state = state,
                    onResolveWithAi = {
                        vm.resolveConflictsWithAi()?.let { (conversationId, pid) ->
                            onOpenChatForConflictResolution(conversationId, pid)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun RepoListSection(state: CodePanelState, onSelectRepo: (String) -> Unit) {
    when {
        state.isLoadingRepos -> Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            CircularProgressIndicator()
        }
        state.workspaceRoot.isNullOrBlank() -> NexyEmptyState(
            title = "No workspace configured",
            detail = "Set up a workspace folder for this project to use git housekeeping.",
        )
        state.repos.isEmpty() -> NexyEmptyState(
            title = "No git repos found",
            detail = "Nothing under this project's workspace looks like a git repository yet.",
        )
        else -> LazyColumn(contentPadding = PaddingValues(16.dp)) {
            items(state.repos, key = { it.relativePath }) { repo ->
                RepoRow(repo = repo, onClick = { onSelectRepo(repo.relativePath) })
                Spacer(modifier = Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun RepoRow(repo: CodePanelRepo, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text(
                    text = repo.relativePath.ifBlank { "(workspace root)" },
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    text = "Branch: ${repo.branch}${if (repo.dirty) " · uncommitted changes" else ""}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun RepoDetailSection(
    vm: CodePanelViewModel,
    state: CodePanelState,
    onResolveWithAi: () -> Unit,
) {
    var newBranchDialogOpen by remember { mutableStateOf(false) }
    var mergeDialogOpen by remember { mutableStateOf(false) }

    LazyColumn(contentPadding = PaddingValues(16.dp)) {
        item {
            Text(
                text = "Current branch: ${state.branches?.current ?: "…"}",
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Fetch latest remote refs, checkout or create a branch, or merge another branch into this one.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(12.dp))
            val mergeCandidateCount = remember(state.branches) {
                val branches = state.branches ?: return@remember 0
                (branches.local + branches.remote).distinct().count { it != branches.current }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { vm.fetch() }, enabled = !state.isActionInProgress) { Text("Fetch") }
                TextButton(onClick = { newBranchDialogOpen = true }, enabled = !state.isActionInProgress) { Text("New branch") }
                TextButton(
                    onClick = { mergeDialogOpen = true },
                    enabled = !state.isActionInProgress && mergeCandidateCount > 0,
                ) { Text("Merge…") }
            }
            if (state.isActionInProgress) {
                Spacer(modifier = Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.height(16.dp).width(16.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Working…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
        }

        if (state.conflict != null) {
            item {
                Card(modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Merge conflict", style = MaterialTheme.typography.titleSmall)
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            "Conflicting files:\n" + state.conflict.conflictedFiles.joinToString("\n") { "• $it" },
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "No automatic resolution runs here — send these files to chat and the AI will propose a fix you review, same as /code-change.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        TextButton(onClick = onResolveWithAi) { Text("Resolve with AI in chat") }
                    }
                }
            }
        }

        item {
            Text("Branches", style = MaterialTheme.typography.titleSmall)
            Text(
                "Tap Checkout to switch branches locally.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
        }
        val branches = state.branches
        if (branches == null) {
            item {
                Row(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
                    CircularProgressIndicator()
                }
            }
        } else {
            items(branches.local, key = { "local-$it" }) { branch ->
                BranchRow(name = branch, isCurrent = branch == branches.current, onCheckout = { vm.checkout(branch) })
            }
            items(branches.remote, key = { "remote-$it" }) { branch ->
                BranchRow(name = branch, isCurrent = false, onCheckout = { vm.checkout(branch) })
            }
        }

        item {
            HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            Text("Changed files", style = MaterialTheme.typography.titleSmall)
            Text(
                "Files with uncommitted changes in this repo.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
        }
        if (state.changedFiles.isEmpty()) {
            item { Text("No uncommitted changes.", style = MaterialTheme.typography.bodySmall) }
        } else {
            items(state.changedFiles) { file ->
                Text(file, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 4.dp))
            }
        }
    }

    if (newBranchDialogOpen) {
        NewBranchDialog(
            onDismiss = { newBranchDialogOpen = false },
            onCreate = { name -> vm.createBranch(name); newBranchDialogOpen = false },
        )
    }
    if (mergeDialogOpen && state.branches != null) {
        MergeBranchDialog(
            branches = state.branches,
            onDismiss = { mergeDialogOpen = false },
            onMerge = { source -> vm.merge(source); mergeDialogOpen = false },
        )
    }
}

@Composable
private fun BranchRow(name: String, isCurrent: Boolean, onCheckout: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = if (isCurrent) "$name (current)" else name,
            style = MaterialTheme.typography.bodyMedium,
        )
        if (!isCurrent) {
            TextButton(onClick = onCheckout) { Text("Checkout") }
        }
    }
}

@Composable
private fun NewBranchDialog(onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New branch") },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Branch name") },
                singleLine = true,
            )
        },
        confirmButton = {
            TextButton(onClick = { if (name.isNotBlank()) onCreate(name.trim()) }, enabled = name.isNotBlank()) {
                Text("Create")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun MergeBranchDialog(branches: CodePanelBranches, onDismiss: () -> Unit, onMerge: (String) -> Unit) {
    val candidates = remember(branches) { (branches.local + branches.remote).distinct().filter { it != branches.current } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Merge into ${branches.current}") },
        text = {
            LazyColumn {
                items(candidates) { branch ->
                    Text(
                        branch,
                        modifier = Modifier.fillMaxWidth().clickable { onMerge(branch) }.padding(vertical = 12.dp),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
