package io.nexy.android.ui.chat

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CallSplit
import androidx.compose.material.icons.filled.Compress
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.NexyInfoDialog
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationActionsSheet(
    conversationId: String,
    onDismiss: () -> Unit,
    onForkNavigate: (String) -> Unit,
    onImportNavigate: (String) -> Unit,
    vm: ConversationActionsViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    val conversations by WsRepository.conversations.collectAsState()
    var showRatingPicker by remember { mutableStateOf(false) }
    val currentRating = conversations.firstOrNull { it.id == conversationId }?.rating

    LaunchedEffect(conversationId, conversations) {
        vm.initPin(conversations, conversationId)
    }

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val json = context.contentResolver.openInputStream(uri)?.use { it.reader().readText() } ?: return@rememberLauncherForActivityResult
        vm.importJson(json)
    }

    LaunchedEffect(state.exportedContent) {
        val exported = state.exportedContent ?: return@LaunchedEffect
        val file = File(context.cacheDir, exported.fileName)
        file.writeText(exported.content, Charsets.UTF_8)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.provider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = exported.mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Share conversation"))
        vm.clearExport()
    }

    LaunchedEffect(state.forkedConversationId) {
        val forkedId = state.forkedConversationId ?: return@LaunchedEffect
        vm.clearFork()
        onDismiss()
        onForkNavigate(forkedId)
    }

    LaunchedEffect(state.importedConversationId) {
        val importedId = state.importedConversationId ?: return@LaunchedEffect
        vm.clearImport()
        onDismiss()
        onImportNavigate(importedId)
    }

    state.compressionDraft?.let { draft ->
        AlertDialog(
            onDismissRequest = { vm.dismissCompression() },
            title = { Text("Compress conversation") },
            text = {
                Column {
                    Text(
                        "Summarise ${draft.summarizedMessageCount} messages, keeping ${draft.retainedMessageCount} recent turns.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (draft.sections.goals.isNotEmpty() || draft.sections.recentContextNotes.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "The desktop will generate a structured summary. Tap Compress to apply it.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { vm.saveCompression(conversationId) },
                    enabled = !state.compressionSaving,
                ) {
                    if (state.compressionSaving) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Text("Compress")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { vm.dismissCompression() }) { Text("Cancel") }
            },
        )
    }

    state.error?.let { error ->
        NexyInfoDialog(
            title = "Error",
            message = error,
            onDismiss = { vm.dismissError() },
        )
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(),
    ) {
        Column(modifier = Modifier.padding(bottom = 24.dp)) {
            Text(
                "Conversation Actions",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            ActionRow(
                icon = Icons.Default.Download,
                label = "Export as JSON",
                sublabel = "Full conversation data",
                loading = state.isExporting,
                onClick = { vm.exportJson(conversationId) },
            )

            ActionRow(
                icon = Icons.Default.Download,
                label = "Export as Markdown",
                sublabel = "Human-readable transcript",
                loading = state.isExporting,
                onClick = { vm.exportMarkdown(conversationId) },
            )

            ActionRow(
                icon = Icons.Default.Upload,
                label = "Import JSON",
                sublabel = "Restore a previously exported conversation",
                loading = state.isImporting,
                onClick = { importLauncher.launch("application/json") },
            )

            ActionRow(
                icon = Icons.Default.PushPin,
                label = if (state.isPinned) "Unpin conversation" else "Pin conversation",
                sublabel = if (state.isPinned) "Remove from pinned chats" else "Keep at top of chat list",
                loading = state.isPinning,
                onClick = { vm.togglePin(conversationId) },
            )

            ActionRow(
                icon = Icons.Default.Star,
                label = if (currentRating != null) "Rated $currentRating/5" else "Rate conversation",
                sublabel = "Tell Nexy how this conversation went",
                loading = false,
                onClick = { showRatingPicker = !showRatingPicker },
            )
            if (showRatingPicker) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    for (star in 1..5) {
                        Icon(
                            imageVector = if (currentRating != null && star <= currentRating) Icons.Default.Star else Icons.Default.StarBorder,
                            contentDescription = "$star star${if (star == 1) "" else "s"}",
                            tint = MaterialTheme.colorScheme.tertiary,
                            modifier = Modifier
                                .size(28.dp)
                                .clickable {
                                    WsRepository.setConversationRating(conversationId, star)
                                    showRatingPicker = false
                                },
                        )
                    }
                }
            }

            ActionRow(
                icon = Icons.Default.Compress,
                label = "Compress conversation",
                sublabel = "Summarise old messages to free up context",
                loading = state.compressionDraftLoading,
                onClick = { vm.prepareCompression(conversationId) },
            )

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 4.dp))

            ActionRow(
                icon = Icons.AutoMirrored.Filled.CallSplit,
                label = "Fork conversation",
                sublabel = "Continue in a new branch",
                loading = state.isForkInProgress,
                onClick = { vm.fork(conversationId) },
            )

            ActionRow(
                icon = Icons.Default.Archive,
                label = "Archive conversation",
                sublabel = "Hide from the active conversation list",
                loading = false,
                onClick = {
                    WsRepository.archiveConversation(conversationId)
                    onDismiss()
                },
            )

            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun ActionRow(
    icon: ImageVector,
    label: String,
    sublabel: String,
    loading: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = !loading, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
        Column(modifier = Modifier.weight(1f).padding(start = 16.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(sublabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        }
    }
}
