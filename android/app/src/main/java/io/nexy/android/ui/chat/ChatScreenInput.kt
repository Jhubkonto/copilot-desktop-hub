package io.nexy.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Screenshot
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatInputBar(
    input: String,
    onInputChange: (String) -> Unit,
    attachments: List<PendingAttachment>,
    onRemoveAttachment: (String) -> Unit,
    canSend: Boolean,
    onSend: () -> Unit,
    onAttachFile: () -> Unit,
    onCaptureScreen: () -> Unit = {},
    onInsertPrompt: () -> Unit = {},
    onShowInspector: () -> Unit = {},
    isListening: Boolean = false,
    onVoiceInput: () -> Unit = {},
) {
    val attachSheetState = rememberModalBottomSheetState()
    var showAttachSheet by remember { mutableStateOf(false) }

    if (showAttachSheet) {
        ModalBottomSheet(
            onDismissRequest = { showAttachSheet = false },
            sheetState = attachSheetState,
        ) {
            ListItem(
                headlineContent = { Text("Attach File") },
                leadingContent = { Icon(Icons.Default.AttachFile, contentDescription = null) },
                modifier = Modifier.clickable { showAttachSheet = false; onAttachFile() },
            )
            ListItem(
                headlineContent = { Text("Latest Screenshot") },
                leadingContent = { Icon(Icons.Default.Screenshot, contentDescription = null) },
                modifier = Modifier.clickable { showAttachSheet = false; onCaptureScreen() },
            )
            ListItem(
                headlineContent = { Text("Insert Prompt") },
                leadingContent = { Icon(Icons.Default.TextFields, contentDescription = null) },
                modifier = Modifier.clickable { showAttachSheet = false; onInsertPrompt() },
            )
            ListItem(
                headlineContent = { Text("Context Inspector") },
                leadingContent = { Icon(Icons.Default.Info, contentDescription = null) },
                modifier = Modifier.clickable { showAttachSheet = false; onShowInspector() },
            )
            Spacer(Modifier.padding(bottom = 8.dp))
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .imePadding()
            .navigationBarsPadding()
            .padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            tonalElevation = 2.dp,
            color = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            Column {
                if (attachments.isNotEmpty()) {
                    LazyRow(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 12.dp, end = 12.dp, top = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(attachments, key = { it.id }) { att ->
                            AttachmentChip(att, onRemove = { onRemoveAttachment(att.id) })
                        }
                    }
                }

                val textColor = MaterialTheme.colorScheme.onSurface
                val hintColor = MaterialTheme.colorScheme.onSurfaceVariant
                val cursorColor = MaterialTheme.colorScheme.primary
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 4.dp),
                ) {
                    if (input.isEmpty()) {
                        Text("Message…", style = MaterialTheme.typography.bodyMedium, color = hintColor)
                    }
                    BasicTextField(
                        value = input,
                        onValueChange = onInputChange,
                        modifier = Modifier.fillMaxWidth(),
                        textStyle = MaterialTheme.typography.bodyMedium.copy(color = textColor),
                        maxLines = 5,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                        cursorBrush = SolidColor(cursorColor),
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(
                        onClick = { showAttachSheet = true },
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = "Attach or insert",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = onVoiceInput, modifier = Modifier.size(36.dp)) {
                        Icon(
                            Icons.Default.Mic,
                            contentDescription = if (isListening) "Stop voice input" else "Start voice input",
                            tint = if (isListening) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .alpha(if (canSend) 1f else 0.38f)
                            .background(
                                color = if (canSend) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f),
                                shape = CircleShape,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        IconButton(
                            onClick = { if (canSend) onSend() },
                            enabled = canSend,
                            modifier = Modifier.size(40.dp),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.Send,
                                contentDescription = "Send",
                                tint = if (canSend) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatRefreshableContent(
    isRefreshing: Boolean,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit,
    content: @Composable () -> Unit,
) {
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        modifier = modifier,
    ) {
        content()
    }
}
