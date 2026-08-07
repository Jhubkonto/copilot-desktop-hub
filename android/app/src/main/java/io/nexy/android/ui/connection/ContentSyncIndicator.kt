package io.nexy.android.ui.connection

import android.animation.ValueAnimator
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.SyncProblem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.nexy.android.data.WsRepository
import io.nexy.android.data.local.ConflictEntity
import io.nexy.android.data.local.OutboxEntity
import io.nexy.android.ui.theme.LocalNexyEightBit

/**
 * Content-sync icon. Reads the app-wide sync signals ([resolveContentSyncState]) and shows a single
 * glyph: a settled check when synced, a spinning arrow while syncing, a problem badge on error.
 * Tapping it always opens the sync-status sheet, which lists any pending / failed / conflicted
 * changes so the user can follow up — the "follow up problems" affordance the connectivity dot
 * intentionally does not carry.
 *
 * @param contentSyncInProgress optional per-screen override forwarded to [resolveContentSyncState],
 *   letting a screen (e.g. a chat reconciling its history) force the syncing state.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContentSyncIndicator(
    contentSyncInProgress: Boolean? = null,
    modifier: Modifier = Modifier,
) {
    val syncInProgress by WsRepository.syncInProgress.collectAsStateWithLifecycle()
    val capabilities by WsRepository.capabilities.collectAsStateWithLifecycle()
    val outbox by WsRepository.syncOutbox.collectAsStateWithLifecycle()
    val conflicts by WsRepository.syncConflicts.collectAsStateWithLifecycle()
    val state = resolveContentSyncState(
        syncInProgress = syncInProgress,
        pendingChanges = capabilities.pendingChanges,
        failedChanges = capabilities.failedChanges,
        conflicts = capabilities.conflicts,
        contentSyncInProgress = contentSyncInProgress,
    )
    val presentation = getContentSyncPresentation(state)
    var showSheet by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .size(48.dp)
            .clickable { showSheet = true }
            .semantics {
                contentDescription = presentation.accessibilityDescription
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        ContentSyncGlyph(state, presentation.color)
    }

    if (showSheet) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        SyncStatusSheet(
            pending = outbox.filter { it.state == "pending" },
            failed = outbox.filter { it.state == "failed" },
            conflicts = conflicts,
            sheetState = sheetState,
            onDismiss = { showSheet = false },
        )
    }
}

@Composable
private fun ContentSyncGlyph(state: ContentSyncState, color: Color) {
    // Motion is theme-aware (see no-visual-motion policy): the retro theme spins a touch faster to
    // match its snappier feel. The spin only runs while syncing — a busy indicator, not decoration.
    val eightBit = LocalNexyEightBit.current
    val motionEnabled = !LocalInspectionMode.current && ValueAnimator.areAnimatorsEnabled()
    val transition = rememberInfiniteTransition(label = "content-sync-motion")
    val rotation by transition.animateFloat(
        initialValue = 0f,
        targetValue = if (motionEnabled && state == ContentSyncState.SYNCING) 360f else 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(if (eightBit) 1_200 else 1_600, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "content-sync-rotation",
    )
    when (state) {
        ContentSyncState.SYNCED -> Icon(
            Icons.Default.CheckCircle,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(22.dp),
        )
        ContentSyncState.SYNCING -> Icon(
            Icons.Default.Sync,
            contentDescription = null,
            tint = color,
            modifier = Modifier
                .size(22.dp)
                .graphicsLayer(rotationZ = rotation),
        )
        ContentSyncState.ERROR -> Icon(
            Icons.Default.SyncProblem,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(22.dp),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SyncStatusSheet(
    pending: List<OutboxEntity>,
    failed: List<OutboxEntity>,
    conflicts: List<ConflictEntity>,
    sheetState: SheetState,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Text(
            "Sync status",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
        )
        // One-line summary carried over from the home-screen banner so the outstanding count is
        // legible before scanning the itemized sections below.
        val summary = buildString {
            if (pending.isNotEmpty()) {
                append(if (pending.size == 1) "Syncing 1 change…" else "Syncing ${pending.size} changes…")
            }
            if (failed.isNotEmpty()) {
                if (isNotEmpty()) append(" · ")
                append(if (failed.size == 1) "1 change failed to sync" else "${failed.size} changes failed to sync")
            }
            if (conflicts.isNotEmpty()) {
                if (isNotEmpty()) append(" · ")
                append(if (conflicts.size == 1) "1 conflict to resolve" else "${conflicts.size} conflicts to resolve")
            }
        }
        if (summary.isNotEmpty()) {
            Text(
                summary,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
            )
        }
        if (pending.isEmpty() && failed.isEmpty() && conflicts.isEmpty()) {
            Text(
                "Everything is up to date.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 24.dp),
            ) {
                if (conflicts.isNotEmpty()) {
                    item { SyncSectionHeader("Conflicts", conflicts.size, MaterialTheme.colorScheme.error) }
                    items(conflicts, key = { it.id }) { conflict ->
                        SyncConflictRow(
                            conflict = conflict,
                            onResolve = { useAndroidVersion ->
                                WsRepository.resolveSyncConflict(conflict.id, useAndroidVersion)
                            },
                        )
                    }
                }
                if (failed.isNotEmpty()) {
                    item { SyncSectionHeader("Failed", failed.size, MaterialTheme.colorScheme.error) }
                    items(failed, key = { it.operationId }) { op ->
                        SyncProblemRow(
                            title = "${operationLabel(op.operation)} ${entityLabel(op.entityType)}",
                            detail = op.lastError ?: "Failed after ${op.attempts} attempts",
                        )
                    }
                }
                if (pending.isNotEmpty()) {
                    item { SyncSectionHeader("Pending", pending.size, MaterialTheme.colorScheme.primary) }
                    items(pending, key = { it.operationId }) { op ->
                        SyncProblemRow(
                            title = "${operationLabel(op.operation)} ${entityLabel(op.entityType)}",
                            detail = "Waiting to sync",
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SyncSectionHeader(label: String, count: Int, color: Color) {
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    Text(
        "$label · $count",
        style = MaterialTheme.typography.labelMedium,
        color = color,
        fontWeight = FontWeight.Medium,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
    )
}

@Composable
private fun SyncConflictRow(conflict: ConflictEntity, onResolve: (useAndroidVersion: Boolean) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 8.dp),
    ) {
        Text(
            entityLabel(conflict.entityType),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            "This ${conflict.entityType} was changed here and on the desktop. Keep which version?",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TextButton(onClick = { onResolve(false) }) { Text("Use desktop") }
            TextButton(onClick = { onResolve(true) }) { Text("Keep this device") }
        }
    }
}

@Composable
private fun SyncProblemRow(title: String, detail: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp),
    ) {
        Text(
            title,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            detail,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun entityLabel(entityType: String): String =
    entityType.replace('_', ' ').replaceFirstChar { it.uppercase() }

private fun operationLabel(operation: String): String =
    operation.replace('_', ' ').replaceFirstChar { it.uppercase() }
