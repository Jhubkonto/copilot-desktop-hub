package io.nexy.android.ui.codepanel

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
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
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.theme.GeneratedNexyColors
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Android-only `/code` panel: raw git housekeeping (branches, fetch/pull, push, commit, stash,
 * merge, discard, delete, changed-file diffs) for every repo discovered under a project's
 * workspace. Typing the desktop equivalents (`/code-branch`, `/code-pull`, etc.) is fine on a
 * keyboard but awkward on a phone, so this trades typed commands for taps. The AI workflow itself
 * This screen is purely for Git bookkeeping; AI-driven Code Changes are intentionally absent.
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
    vm: CodePanelViewModel = viewModel(factory = remember(projectId) { CodePanelViewModelFactory(projectId) }),
) {
    val state by vm.state.collectAsStateWithLifecycle()
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

    // This screen has 3 internal drill-down levels (repo list -> repo detail -> file diff) that
    // exist entirely as ViewModel state, not separate NavGraph routes — the in-app back arrow in
    // the TopAppBar above already steps back one level at a time, but without this, the system/
    // gesture back button skips straight past all of it and pops the whole screen in one go.
    BackHandler(enabled = state.diffFile != null) { vm.closeDiff() }
    BackHandler(enabled = state.diffFile == null && state.selectedRepoRelativePath != null) { vm.closeRepoDetail() }

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
                else -> RepoDetailSection(vm = vm, state = state)
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

private data class ActionButtonSpec(
    val text: String,
    val icon: NexyIconName,
    val enabled: Boolean,
    val onClick: () -> Unit,
)

/** Fixed 2-column grid of equal-width action buttons — replaces a `FlowRow`, whose natural
 *  per-item wrapping left some rows with two buttons and others with three, at whatever width
 *  each button's own text happened to need. Every row here has exactly two equal-width slots
 *  (a blank spacer fills the second slot on a trailing odd button), so the whole grid reads as
 *  one uniform block instead of a ragged row of mismatched pill sizes. */
@Composable
private fun ActionButtonGrid(buttons: List<ActionButtonSpec>, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        buttons.chunked(2).forEach { pair ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { button ->
                    NexySecondaryButton(
                        text = button.text,
                        onClick = button.onClick,
                        enabled = button.enabled,
                        leadingNexyIcon = button.icon,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (pair.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
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
            NexyIcon(NexyIconName.Busy, contentDescription = "Loading repositories", tint = MaterialTheme.colorScheme.primary)
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
                    NexyIcon(NexyIconName.Busy, contentDescription = "Initializing repository", modifier = Modifier.size(24.dp), tint = MaterialTheme.colorScheme.primary)
                } else {
                    NexyPrimaryButton(
                        text = "Initialize repository here",
                        onClick = onInitRepo,
                        leadingNexyIcon = NexyIconName.Add,
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
            NexyIcon(
                NexyIconName.Fork,
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
            NexyIcon(
                NexyIconName.ChevronRight,
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
                    val unstagedPaths = remember(state.changedFiles) { state.changedFiles.filterNot { it.staged }.map { it.relativePath }.toSet() }
                    val actionButtons = buildList {
                        add(ActionButtonSpec("Fetch", NexyIconName.Refresh, !state.isActionInProgress) { vm.fetch() })
                        add(ActionButtonSpec("Pull", NexyIconName.Download, !state.isActionInProgress) { vm.pull() })
                        add(ActionButtonSpec("Push", NexyIconName.Upload, !state.isActionInProgress) { vm.pushBranch() })
                        add(ActionButtonSpec("Stage all", NexyIconName.Add, !state.isActionInProgress && unstagedPaths.isNotEmpty()) { vm.stageFiles(unstagedPaths) })
                        add(ActionButtonSpec("Commit…", NexyIconName.Check, !state.isActionInProgress && state.changedFiles.isNotEmpty()) { commitDialogOpen = true })
                        add(ActionButtonSpec("New branch", NexyIconName.Add, !state.isActionInProgress) { newBranchDialogOpen = true })
                        add(ActionButtonSpec("Merge…", NexyIconName.Fork, !state.isActionInProgress && mergeCandidateCount > 0) { mergeDialogOpen = true })
                        add(ActionButtonSpec("Stash", NexyIconName.Archive, !state.isActionInProgress && state.changedFiles.isNotEmpty()) { stashConfirmOpen = true })
                        if (state.stashCount > 0) {
                            add(ActionButtonSpec("Stash pop (${state.stashCount})", NexyIconName.Refresh, !state.isActionInProgress) { vm.stashPop() })
                        }
                    }
                    ActionButtonGrid(buttons = actionButtons)
                    if (state.isActionInProgress) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            NexyIcon(NexyIconName.Busy, contentDescription = null, modifier = Modifier.height(16.dp).width(16.dp), tint = MaterialTheme.colorScheme.primary)
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
                            "Resolve these files in the code panel or a normal CLI-backed project conversation, then retry the Git operation.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
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
                            NexyIcon(NexyIconName.Busy, contentDescription = "Loading branches", tint = MaterialTheme.colorScheme.primary)
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
                            "Tap a file to view its diff, or the checkbox to select it for staging.",
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
                        if (state.selectedChangedFiles.isNotEmpty()) {
                            val selectedStagedCount = state.changedFiles.count { it.relativePath in state.selectedChangedFiles && it.staged }
                            val selectedUnstagedCount = state.selectedChangedFiles.size - selectedStagedCount
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            ) {
                                if (selectedUnstagedCount > 0) {
                                    NexySecondaryButton(
                                        text = "Stage selected (${state.selectedChangedFiles.size})",
                                        onClick = { vm.stageFiles() },
                                        enabled = !state.isActionInProgress,
                                        leadingNexyIcon = NexyIconName.Add,
                                    )
                                }
                                if (selectedStagedCount > 0) {
                                    NexySecondaryButton(
                                        text = "Unstage selected (${state.selectedChangedFiles.size})",
                                        onClick = { vm.unstageFiles() },
                                        enabled = !state.isActionInProgress,
                                        leadingNexyIcon = NexyIconName.Refresh,
                                    )
                                }
                                NexyGhostButton(text = "Clear selection", onClick = { vm.clearFileSelection() })
                            }
                        }
                        state.changedFiles.forEach { file ->
                            ChangedFileRow(
                                file = file,
                                selected = file.relativePath in state.selectedChangedFiles,
                                onToggleSelected = { vm.toggleFileSelection(file.relativePath) },
                                onClick = { vm.openDiff(file.relativePath) },
                                onDiscard = { discardTarget = file.relativePath },
                                onToggleStaged = {
                                    if (file.staged) vm.unstageFiles(setOf(file.relativePath)) else vm.stageFiles(setOf(file.relativePath))
                                },
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
        val stagedCount = state.changedFiles.count { it.staged }
        CommitDialog(
            fileCount = if (stagedCount > 0) stagedCount else state.changedFiles.size,
            onlyStaged = stagedCount > 0,
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
            NexyIcon(
                NexyIconName.Fork,
                contentDescription = null,
                tint = if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        },
        trailing = {
            // Every row reserves the same two fixed-width slots (checkout/current + delete),
            // regardless of which are actually populated — otherwise the current-branch badge
            // (narrow), a plain "Checkout" button (medium), and "Checkout" + delete icon (wide)
            // each land at a different right edge, reading as misaligned/unpolished.
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(modifier = Modifier.width(104.dp), contentAlignment = Alignment.CenterEnd) {
                    if (isCurrent) {
                        NexyStatusBadge(
                            label = "current",
                            containerColor = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    } else {
                        NexyGhostButton(text = "Checkout", onClick = onCheckout)
                    }
                }
                Box(modifier = Modifier.size(32.dp), contentAlignment = Alignment.Center) {
                    if (onDelete != null) {
                        IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                            NexyIcon(
                                NexyIconName.Close,
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
 *  Tapping the row opens the diff; the leading checkbox selects the file for the bulk stage/
 *  unstage actions above, and the trailing icons offer a quick single-file stage/unstage toggle
 *  plus discard, without needing a swipe gesture (which doesn't discover well on first use). */
@Composable
private fun ChangedFileRow(
    file: CodePanelChangedFile,
    selected: Boolean,
    onToggleSelected: () -> Unit,
    onClick: () -> Unit,
    onDiscard: () -> Unit,
    onToggleStaged: () -> Unit,
) {
    val path = file.relativePath
    val separatorIndex = path.lastIndexOf('/')
    val fileName = if (separatorIndex >= 0) path.substring(separatorIndex + 1) else path
    val directory = if (separatorIndex >= 0) path.substring(0, separatorIndex) else null

    NexyListRow(
        title = fileName,
        onClick = onClick,
        leading = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = selected, onCheckedChange = { onToggleSelected() }, modifier = Modifier.size(32.dp))
                NexyIcon(
                    NexyIconName.File,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }
        },
        subtitleContent = if (directory != null || file.staged) {
            {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (directory != null) {
                        Text(
                            text = directory,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                    }
                    if (file.staged) {
                        NexyStatusBadge(
                            label = "staged",
                            containerColor = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                }
            }
        } else null,
        trailing = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onToggleStaged, modifier = Modifier.size(32.dp)) {
                    NexyIcon(
                        if (file.staged) NexyIconName.Close else NexyIconName.Add,
                        contentDescription = if (file.staged) "Unstage" else "Stage",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
                IconButton(onClick = onDiscard, modifier = Modifier.size(32.dp)) {
                    NexyIcon(
                        NexyIconName.Refresh,
                        contentDescription = "Discard changes",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        },
    )
}

/** Diff view for a single changed file, reusing the same red/green unified-diff renderer
 *  ProjectAuditScreen already uses — new files (untracked in git) get a synthetic all-green diff
 *  from the server side rather than an empty view. A change-indicator strip runs alongside it
 *  (see [DiffChangeIndicator]) so the user can see at a glance where the changes fall in a long
 *  file and jump straight there, instead of scrolling blindly. */
@Composable
private fun DiffSection(state: CodePanelState, fileName: String) {
    when {
        state.isLoadingDiff -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            NexyIcon(NexyIconName.Busy, contentDescription = "Loading diff", tint = MaterialTheme.colorScheme.primary)
        }
        state.diffBinary -> NexyEmptyState(
            title = "Binary file",
            detail = "\"$fileName\" can't be shown as a text diff.",
        )
        state.diffText.isNullOrBlank() -> NexyEmptyState(
            title = "No differences",
            detail = "\"$fileName\" has no line-level changes to show.",
        )
        else -> {
            val diffText = state.diffText
            val lines = remember(diffText) { diffText.lines() }
            val scrollState = rememberScrollState()
            Row(modifier = Modifier.fillMaxSize()) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(scrollState),
                ) {
                    NexyDiffContent(diffText = diffText, modifier = Modifier.fillMaxWidth())
                }
                DiffChangeIndicator(
                    lines = lines,
                    scrollState = scrollState,
                    modifier = Modifier
                        .width(16.dp)
                        .fillMaxHeight(),
                )
            }
        }
    }
}

/** A minimap-style scrollbar for the diff view (mirrors the VS Code diff overview ruler): a
 *  colored tick per added/removed line at its proportional position in the file, plus a thumb
 *  showing the currently-visible slice. Tapping or dragging anywhere on the strip jumps the diff
 *  scroll position to that spot, so the user can go straight to a change instead of scrolling
 *  through unchanged context to find it. */
@Composable
private fun DiffChangeIndicator(
    lines: List<String>,
    scrollState: ScrollState,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val trackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
    val thumbColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.25f)
    val addColor = GeneratedNexyColors.SemanticSuccessMain
    val removeColor = MaterialTheme.colorScheme.error

    Canvas(
        modifier = modifier.pointerInput(Unit) {
            fun jumpTo(y: Float) {
                val maxScroll = scrollState.maxValue
                if (maxScroll <= 0) return
                val fraction = (y / size.height.toFloat()).coerceIn(0f, 1f)
                scope.launch { scrollState.scrollTo((fraction * maxScroll).roundToInt()) }
            }
            detectDragGestures(
                onDragStart = { offset -> jumpTo(offset.y) },
                onDrag = { change, _ -> jumpTo(change.position.y) },
            )
        },
    ) {
        drawRect(color = trackColor)

        if (lines.isNotEmpty()) {
            val lineHeight = size.height / lines.size
            val tickHeight = lineHeight.coerceAtLeast(2f)
            lines.forEachIndexed { index, line ->
                val color = when {
                    line.startsWith("+") && !line.startsWith("+++") -> addColor
                    line.startsWith("-") && !line.startsWith("---") -> removeColor
                    else -> null
                } ?: return@forEachIndexed
                drawRect(
                    color = color,
                    topLeft = Offset(0f, index * lineHeight),
                    size = Size(size.width, tickHeight),
                )
            }
        }

        // Thumb: the viewport is this Canvas's own height; the full content is that plus
        // whatever's still scrollable (maxValue) beyond it.
        val maxScroll = scrollState.maxValue
        if (maxScroll > 0) {
            val viewportHeight = size.height
            val contentHeight = viewportHeight + maxScroll
            val thumbHeight = (viewportHeight * viewportHeight / contentHeight).coerceAtLeast(24f)
            val thumbTop = (scrollState.value.toFloat() / maxScroll) * (viewportHeight - thumbHeight)
            drawRect(
                color = thumbColor,
                topLeft = Offset(0f, thumbTop),
                size = Size(size.width, thumbHeight),
            )
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
private fun CommitDialog(fileCount: Int, onlyStaged: Boolean, onDismiss: () -> Unit, onCommit: (String) -> Unit) {
    var message by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Commit changes") },
        text = {
            Column {
                Text(
                    if (onlyStaged) {
                        "Commits the $fileCount file(s) currently staged. Anything not staged is left alone."
                    } else {
                        "Nothing is staged yet, so this stages and commits all $fileCount changed file(s)."
                    },
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
