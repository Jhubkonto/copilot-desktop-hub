package io.nexy.android.ui.codepanel

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyDiffContent
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexyGhostButton
import io.nexy.android.ui.components.NexyListRow
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.launch

/**
 * Android-only `/code` panel: raw git housekeeping (branches, fetch/pull, push, commit, stash,
 * merge, discard, delete, changed-file diffs) for every repo discovered under a project's
 * workspace. Typing the desktop equivalents (`/code-branch`, `/code-pull`, etc.) is fine on a
 * keyboard but awkward on a phone, so this trades typed commands for taps. The AI workflow itself
 * (/code-change, /code-execute, ...) stays in normal chat on both platforms — this screen is
 * purely for git bookkeeping and to kick off "resolve with AI" when a merge conflicts.
 *
 * Built from the same shared components other screens use (NexyListRow, NexyStatusBadge,
 * NexyPrimaryButton/NexySecondaryButton/NexyGhostButton/NexyDangerButton, NexyConfirmDialog,
 * NexyDiffContent — the same red/green diff renderer ProjectAuditScreen uses) rather than ad-hoc
 * Row/TextButton, so this reads as part of the app instead of a bare prototype screen.
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

    val diffFile = state.diffFile
    val fileName = diffFile?.substringAfterLast('/')

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        fileName ?: state.selectedRepoRelativePath?.ifBlank { "Repository" } ?: "Code Panel",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                onBack = when {
                    diffFile != null -> { { vm.closeDiff() } }
                    state.selectedRepoRelativePath != null -> { { vm.closeRepoDetail() } }
                    else -> onBack
                },
                subtitle = when {
                    diffFile != null -> diffFile.substringBeforeLast('/', "").ifBlank { null }
                    state.selectedRepoRelativePath == null -> "Git repos in this project"
                    else -> null
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                diffFile != null -> DiffSection(state = state, fileName = fileName ?: diffFile)
                state.selectedRepoRelativePath == null -> RepoListSection(
                    state = state,
                    onSelectRepo = vm::selectRepo,
                    onInitRepo = { vm.initRepo() },
                )
                else -> RepoDetailSection(
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

/** Consistent section title used across the branches/changed-files/actions groups below, so the
 *  panel reads as one uniformly-styled screen instead of ad-hoc text sizes per section. */
@Composable
private fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = modifier)
}

/** Consistent card container for grouped content (actions, branches, changed files) — gives the
 *  panel clear visual sections instead of one long undifferentiated list. */
@Composable
private fun SectionCard(modifier: Modifier = Modifier, content: ColumnScopeContent) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        shape = MaterialTheme.shapes.medium,
    ) {
        Column(content = { content() })
    }
}

private typealias ColumnScopeContent = @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit

@Composable
private fun RepoListSection(state: CodePanelState, onSelectRepo: (String) -> Unit, onInitRepo: () -> Unit) {
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
            action = {
                if (state.isInitializingRepo) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                } else {
                    NexyPrimaryButton(
                        text = "Initialize repository here",
                        onClick = onInitRepo,
                        leadingIcon = Icons.Default.Add,
                    )
                }
            },
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
    var commitDialogOpen by remember { mutableStateOf(false) }
    var stashConfirmOpen by remember { mutableStateOf(false) }
    var discardTarget by remember { mutableStateOf<String?>(null) }
    var deleteBranchTarget by remember { mutableStateOf<String?>(null) }

    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
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
        }

        item {
            val mergeCandidateCount = remember(state.branches) {
                val branches = state.branches ?: return@remember 0
                (branches.local + branches.remote).distinct().count { it != branches.current }
            }
            SectionCard {
                Column(modifier = Modifier.padding(16.dp)) {
                    SectionTitle("Actions")
                    Spacer(modifier = Modifier.height(10.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        NexySecondaryButton(
                            text = "Fetch",
                            onClick = { vm.fetch() },
                            enabled = !state.isActionInProgress,
                            leadingIcon = Icons.Default.Sync,
                        )
                        NexySecondaryButton(
                            text = "Pull",
                            onClick = { vm.pull() },
                            enabled = !state.isActionInProgress,
                            leadingIcon = Icons.Default.ArrowDownward,
                        )
                        NexySecondaryButton(
                            text = "Push",
                            onClick = { vm.pushBranch() },
                            enabled = !state.isActionInProgress,
                            leadingIcon = Icons.Default.ArrowUpward,
                        )
                        NexySecondaryButton(
                            text = "Commit…",
                            onClick = { commitDialogOpen = true },
                            enabled = !state.isActionInProgress && state.changedFiles.isNotEmpty(),
                            leadingIcon = Icons.Default.CheckCircle,
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
                        NexySecondaryButton(
                            text = "Stash",
                            onClick = { stashConfirmOpen = true },
                            enabled = !state.isActionInProgress && state.changedFiles.isNotEmpty(),
                            leadingIcon = Icons.Default.Inventory2,
                        )
                        if (state.stashCount > 0) {
                            NexySecondaryButton(
                                text = "Stash pop (${state.stashCount})",
                                onClick = { vm.stashPop() },
                                enabled = !state.isActionInProgress,
                                leadingIcon = Icons.Default.RestartAlt,
                            )
                        }
                    }
                    if (state.isActionInProgress) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(modifier = Modifier.height(16.dp).width(16.dp), strokeWidth = 2.dp)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Working…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    state.credentials?.let { creds ->
                        Spacer(modifier = Modifier.height(10.dp))
                        HorizontalDivider()
                        Spacer(modifier = Modifier.height(10.dp))
                        Text(
                            text = if (creds.remoteUrl == null) {
                                "No remote configured — nothing to push to yet."
                            } else if (creds.methods.isEmpty()) {
                                "Push auth for ${creds.host ?: "this remote"}: nothing detected. Sign in with your provider's CLI or configure a credential helper before pushing."
                            } else {
                                "Push auth for ${creds.host ?: "this remote"}: ${creds.methods.joinToString("; ")}"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        if (state.conflict != null) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
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
            SectionCard {
                Column(modifier = Modifier.padding(vertical = 8.dp)) {
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                        SectionTitle("Branches")
                        Text(
                            "Tap a branch to check it out locally.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    val branches = state.branches
                    if (branches == null) {
                        Row(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
                            CircularProgressIndicator()
                        }
                    } else {
                        branches.local.forEach { branch ->
                            BranchRow(
                                name = branch,
                                isCurrent = branch == branches.current,
                                onCheckout = { vm.checkout(branch) },
                                onDelete = if (branch != branches.current) { { deleteBranchTarget = branch } } else null,
                            )
                        }
                        branches.remote.forEach { branch ->
                            BranchRow(name = branch, isCurrent = false, onCheckout = { vm.checkout(branch) }, onDelete = null)
                        }
                    }
                }
            }
        }

        item {
            SectionCard {
                Column(modifier = Modifier.padding(vertical = 8.dp)) {
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                        SectionTitle("Changed files")
                        Text(
                            "Tap a file to view its diff. Files with uncommitted changes in this repo.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (state.changedFiles.isEmpty()) {
                        Text(
                            "No uncommitted changes.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    } else {
                        state.changedFiles.forEach { file ->
                            ChangedFileRow(
                                path = file,
                                onClick = { vm.openDiff(file) },
                                onDiscard = { discardTarget = file },
                            )
                        }
                    }
                }
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
    if (commitDialogOpen) {
        CommitDialog(
            fileCount = state.changedFiles.size,
            onDismiss = { commitDialogOpen = false },
            onCommit = { message -> vm.commit(message); commitDialogOpen = false },
        )
    }
    if (stashConfirmOpen) {
        NexyConfirmDialog(
            title = "Stash changes?",
            message = "Shelves all ${state.changedFiles.size} changed file(s) so the working tree is clean. Restore them any time with Stash pop.",
            confirmLabel = "Stash",
            onConfirm = { vm.stash(); stashConfirmOpen = false },
            onDismiss = { stashConfirmOpen = false },
        )
    }
    discardTarget?.let { path ->
        NexyConfirmDialog(
            title = "Discard changes?",
            message = "This permanently reverts \"$path\" to its last-committed state. This can't be undone.",
            confirmLabel = "Discard",
            destructive = true,
            onConfirm = { vm.discardFile(path); discardTarget = null },
            onDismiss = { discardTarget = null },
        )
    }
    deleteBranchTarget?.let { branch ->
        NexyConfirmDialog(
            title = "Delete branch?",
            message = "Deletes the local branch \"$branch\". Git will refuse if it has unmerged commits.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = { vm.deleteBranch(branch); deleteBranchTarget = null },
            onDismiss = { deleteBranchTarget = null },
        )
    }
}

@Composable
private fun BranchRow(name: String, isCurrent: Boolean, onCheckout: () -> Unit, onDelete: (() -> Unit)?) {
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
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (isCurrent) {
                    NexyStatusBadge(
                        label = "current",
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                } else {
                    NexyGhostButton(text = "Checkout", onClick = onCheckout)
                    if (onDelete != null) {
                        IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Delete branch",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }
        },
    )
}

/** Splits a relative path into a bold filename with its directory as a dimmed, truncated
 *  subtitle — reads much better than one long monospace line for deeply nested paths, and
 *  naturally fixes the "whole path gets clipped instead of truncated" case for long paths.
 *  Tapping the row opens the diff; a trailing icon offers "discard" without needing a swipe
 *  gesture, which doesn't discover well on a first-time screen. */
@Composable
private fun ChangedFileRow(path: String, onClick: () -> Unit, onDiscard: () -> Unit) {
    val separatorIndex = path.lastIndexOf('/')
    val fileName = if (separatorIndex >= 0) path.substring(separatorIndex + 1) else path
    val directory = if (separatorIndex >= 0) path.substring(0, separatorIndex) else null

    NexyListRow(
        title = fileName,
        subtitle = directory,
        onClick = onClick,
        leading = {
            Icon(
                Icons.Default.Description,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        },
        trailing = {
            IconButton(onClick = onDiscard, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Default.RestartAlt,
                    contentDescription = "Discard changes",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
            }
        },
    )
}

/** Diff view for a single changed file, reusing the same red/green unified-diff renderer
 *  ProjectAuditScreen already uses — new files (untracked in git) get a synthetic all-green diff
 *  from the server side rather than an empty view. */
@Composable
private fun DiffSection(state: CodePanelState, fileName: String) {
    when {
        state.isLoadingDiff -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        state.diffBinary -> NexyEmptyState(
            title = "Binary file",
            detail = "\"$fileName\" can't be shown as a text diff.",
        )
        state.diffText.isNullOrBlank() -> NexyEmptyState(
            title = "No differences",
            detail = "\"$fileName\" has no line-level changes to show.",
        )
        else -> Column(modifier = Modifier.fillMaxSize()) {
            NexyDiffContent(diffText = state.diffText, modifier = Modifier.fillMaxWidth())
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
            NexyPrimaryButton(text = "Create", onClick = { if (name.isNotBlank()) onCreate(name.trim()) }, enabled = name.isNotBlank())
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun CommitDialog(fileCount: Int, onDismiss: () -> Unit, onCommit: (String) -> Unit) {
    var message by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Commit changes") },
        text = {
            Column {
                Text(
                    "Stages and commits all $fileCount changed file(s).",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it },
                    label = { Text("Commit message") },
                )
            }
        },
        confirmButton = {
            NexyPrimaryButton(text = "Commit", onClick = { if (message.isNotBlank()) onCommit(message.trim()) }, enabled = message.isNotBlank())
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
