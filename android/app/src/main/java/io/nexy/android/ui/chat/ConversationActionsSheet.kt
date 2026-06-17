package io.nexy.android.ui.chat

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CallSplit
import androidx.compose.material.icons.filled.Download
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationActionsSheet(
    conversationId: String,
    onDismiss: () -> Unit,
    onForkNavigate: (String) -> Unit,
    vm: ConversationActionsViewModel = viewModel(),
) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current

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

    state.error?.let { error ->
        AlertDialog(
            onDismissRequest = { vm.dismissError() },
            title = { Text("Error") },
            text = { Text(error) },
            confirmButton = { TextButton(onClick = { vm.dismissError() }) { Text("OK") } },
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

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 4.dp))

            ActionRow(
                icon = Icons.AutoMirrored.Filled.CallSplit,
                label = "Fork conversation",
                sublabel = "Continue in a new branch",
                loading = state.isForkInProgress,
                onClick = { vm.fork(conversationId) },
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
