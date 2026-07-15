package io.nexy.android.ui.codepanel

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CallSplit
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyListRow
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.launch

/**
 * Android-only `/code` panel: raw git housekeeping (branches, fetch, merge, changed files) for
 * every repo discovered under a project's workspace. Typing the desktop equivalents
 * (`/code-branch`, `/code-checkout`, `/code-fetch`, `/code-merge`) is fine on a keyboard but
 * awkward on a phone, so this trades typed commands for taps. The AI workflow itself
 * (/code-change, /code-execute, ...) stays in normal chat on both platforms — this screen is
 * purely for git bookkeeping and to kick off "resolve with AI" when a merge conflicts.
 *
 * Built from the same shared components other screens use (NexyListRow, NexyStatusBadge,
 * NexyPrimaryButton/NexySecondaryButton/NexyGhostButton) rather than ad-hoc Row/TextButton, so
 * this reads as part of the app instead of a bare prototype screen.
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
        else -> LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
            items(state.repos, key = { it.relativePath }) { repo ->
                RepoRow(repo = repo, onClick = { onSelectRepo(repo.relativePath) })
            }
        }
    }
}

@Composable
private fun RepoRow(repo: CodePanelRepo, onClick: () -> Unit) {
    NexyListRow(
        title = repo.relativePath.ifBlank { "(workspace root)" },
        onClick = onClick,
        leading = {
            Icon(
                Icons.AutoMirrored.Filled.CallSplit,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        subtitleContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = repo.branch,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (repo.dirty) {
                    NexyStatusBadge(
                        label = "uncommitted",
                        containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                    )
                }
            }
        },
        trailing = {
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    )
}

@OptIn(ExperimentalLayoutApi::class)
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
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = state.branches?.current ?: "…",
                    style = MaterialTheme.typography.titleMedium,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                NexyStatusBadge(
                    label = "current",
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
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
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NexySecondaryButton(
                    text = "Fetch",
                    onClick = { vm.fetch() },
                    enabled = !state.isActionInProgress,
                    leadingIcon = Icons.Default.Sync,
                )
                NexySecondaryButton(
                    text = "New branch",
                    onClick = { newBranchDialogOpen = true },
                    enabled = !state.isActionInProgress,
                    leadingIcon = Icons.Default.Add,
                )
                NexySecondaryButton(
                    text = "Merge…",
                    onClick = { mergeDialogOpen = true },
                    enabled = !state.isActionInProgress && mergeCandidateCount > 0,
                    leadingIcon = Icons.AutoMirrored.Filled.CallSplit,
                )
            }
            if (state.isActionInProgress) {
                Spacer(modifier = Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.height(16.dp).width(16.dp), strokeWidth = 2.dp)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Working…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider(modifier = Modifier.padding(top = 16.dp))
        }

        if (state.conflict != null) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "Merge conflict",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        state.conflict.conflictedFiles.forEach { path ->
                            Text(
                                "• $path",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                fontFamily = FontFamily.Monospace,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "No automatic resolution runs here — send these files to chat and the AI will propose a fix you review, same as /code-change.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        NexyPrimaryButton(text = "Resolve with AI in chat", onClick = onResolveWithAi)
                    }
                }
            }
        }

        item {
            Text("Branches", style = MaterialTheme.typography.titleSmall)
            Text(
                "Tap a branch to check it out locally.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(4.dp))
        }
        val branches = state.branches
        if (branches == null) {
            item {
                Row(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
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
            Spacer(modifier = Modifier.height(4.dp))
        }
        if (state.changedFiles.isEmpty()) {
            item {
                Text(
                    "No uncommitted changes.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }
        } else {
            items(state.changedFiles, key = { it }) { file -> ChangedFileRow(path = file) }
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
    NexyListRow(
        title = name,
        leading = {
            Icon(
                Icons.AutoMirrored.Filled.CallSplit,
                contentDescription = null,
                tint = if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        },
        trailing = {
            if (isCurrent) {
                NexyStatusBadge(
                    label = "current",
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            } else {
                NexyGhostButton(text = "Checkout", onClick = onCheckout)
            }
        },
    )
}

/** Splits a relative path into a bold filename with its directory as a dimmed, truncated
 *  subtitle — reads much better than one long monospace line for deeply nested paths, and
 *  naturally fixes the "whole path gets clipped instead of truncated" case for long paths. */
@Composable
private fun ChangedFileRow(path: String) {
    val separatorIndex = path.lastIndexOf('/')
    val fileName = if (separatorIndex >= 0) path.substring(separatorIndex + 1) else path
    val directory = if (separatorIndex >= 0) path.substring(0, separatorIndex) else null

    NexyListRow(
        title = fileName,
        subtitle = directory,
        leading = {
            Icon(
                Icons.Default.Description,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        },
    )
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
            NexyPrimaryButton(text = "Create", onClick = { if (name.isNotBlank()) onCreate(name.trim()) }, enabled = name.isNotBlank())
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
                        fontFamily = FontFamily.Monospace,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
