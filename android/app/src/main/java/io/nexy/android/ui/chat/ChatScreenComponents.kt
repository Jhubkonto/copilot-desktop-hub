package io.nexy.android.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.ModelOption
import io.nexy.android.data.model.PromptEntry
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyDangerButton
import io.nexy.android.ui.components.NexyPrimaryButton
import kotlin.math.roundToInt

@Composable
fun AttachmentChip(attachment: PendingAttachment, onRemove: () -> Unit) {
    val thumbnail = remember(attachment.dataUrl) {
        if (attachment.isImage && attachment.dataUrl != null) decodeDataUrl(attachment.dataUrl) else null
    }
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (thumbnail != null) {
                Image(
                    bitmap = thumbnail.asImageBitmap(),
                    contentDescription = attachment.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(28.dp)
                        .clip(RoundedCornerShape(10.dp)),
                )
            } else {
                Icon(
                    if (attachment.isImage) Icons.Default.Image else Icons.Default.AttachFile,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp).padding(start = 4.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                attachment.name,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 120.dp),
            )
            IconButton(onClick = onRemove, modifier = Modifier.size(20.dp)) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Remove",
                    modifier = Modifier.size(12.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
fun ModelSheetItem(
    label: String,
    vendor: String?,
    selected: Boolean,
    unavailable: Boolean = false,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (selected) MaterialTheme.colorScheme.onPrimaryContainer
                            else if (unavailable) MaterialTheme.colorScheme.onSurfaceVariant
                            else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!vendor.isNullOrBlank()) {
                    Text(
                        vendor,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (unavailable) {
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                ) {
                    Text(
                        "Not installed",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            } else if (selected) {
                Text(
                    "Selected",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * Reusable model-picker bottom sheet content — extracted from ChatScreen's inline model sheet so
 * non-chat screens (e.g. Revise Plan on a Code Changes request) can offer the same searchable,
 * vendor-grouped model list instead of a plain text field for the model id.
 */
@Composable
fun ModelPickerSheet(
    title: String,
    models: List<ModelOption>,
    cliStatus: Map<String, CliInstallInfo>,
    selectedModelId: String?,
    subtitle: String? = null,
    emptyStateText: String = "No models available yet.",
    onSelect: (String?) -> Unit,
) {
    var modelQuery by remember { mutableStateOf("") }

    val vendorUnavailable: (String) -> Boolean = { vendor ->
        val cliKey = vendor.removeSuffix(" CLI").lowercase()
        val info = cliStatus[cliKey]
        info != null && !info.installed
    }

    data class ModelItem(val model: ModelOption, val unavailable: Boolean)
    data class HeaderItem(val vendor: String, val unavailable: Boolean)

    val query = modelQuery.trim().lowercase()
    val sheetItems: List<Any> = buildList {
        val grouped = models.filterNot { it.id == "default" }.groupBy { it.vendor ?: "" }
        val hasVendorGroups = grouped.any { it.key.isNotBlank() }
        if (hasVendorGroups) {
            grouped.forEach { (vendor, vendorModels) ->
                val groupUnavailable = vendor.isNotBlank() && vendorUnavailable(vendor)
                val filtered = if (query.isEmpty()) vendorModels
                               else vendorModels.filter { it.label.lowercase().contains(query) }
                if (filtered.isNotEmpty()) {
                    if (vendor.isNotBlank()) add(HeaderItem(vendor, groupUnavailable))
                    filtered.forEach { add(ModelItem(it, groupUnavailable)) }
                }
            }
        } else {
            models.forEach { model ->
                if (query.isEmpty() || model.label.lowercase().contains(query)) {
                    val modelUnavailable = model.vendor != null && vendorUnavailable(model.vendor)
                    add(ModelItem(model, modelUnavailable))
                }
            }
        }
    }

    val showDefault = query.isEmpty() || "default model".contains(query)

    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
                )
            }
            OutlinedTextField(
                value = modelQuery,
                onValueChange = { modelQuery = it },
                placeholder = { Text("Search models…", style = MaterialTheme.typography.bodyMedium) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(20.dp)) },
                trailingIcon = {
                    if (modelQuery.isNotEmpty()) {
                        IconButton(onClick = { modelQuery = "" }) {
                            Icon(Icons.Default.Close, contentDescription = "Clear", modifier = Modifier.size(18.dp))
                        }
                    }
                },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                shape = MaterialTheme.shapes.medium,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 4.dp))
        }

        if (showDefault) {
            item {
                ModelSheetItem(
                    label = "Default model",
                    vendor = null,
                    selected = selectedModelId == null || selectedModelId == "default" || selectedModelId.isBlank(),
                ) {
                    onSelect(null)
                }
            }
        }

        if (models.isEmpty()) {
            item {
                Text(
                    emptyStateText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }
        } else {
            items(sheetItems) { item ->
                when (item) {
                    is HeaderItem -> Text(
                        item.vendor,
                        style = MaterialTheme.typography.labelMedium,
                        color = if (item.unavailable) MaterialTheme.colorScheme.error
                                else MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                    )
                    is ModelItem -> ModelSheetItem(
                        label = item.model.label,
                        vendor = null,
                        selected = item.model.id == selectedModelId,
                        unavailable = item.unavailable,
                    ) {
                        onSelect(item.model.id)
                    }
                }
            }

            if (sheetItems.isEmpty() && !showDefault) {
                item {
                    Text(
                        "No models match \"$modelQuery\"",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                    )
                }
            }
        }
    }
}

/**
 * Reusable prompt-library bottom sheet content — extracted from ChatScreen's inline "Insert
 * Prompt" sheet so non-chat screens (e.g. Revise Plan) can offer the same saved-prompt insertion
 * instead of missing the feature entirely.
 */
@Composable
fun PromptLibrarySheetContent(
    promptEntries: List<PromptEntry>,
    onInsert: (body: String) -> Unit,
) {
    Text(
        "Insert Prompt",
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
    )
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    if (promptEntries.isEmpty()) {
        Text(
            "No saved prompts. Create some in the Prompt Library.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
        )
    } else {
        promptEntries.forEach { prompt ->
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onInsert(prompt.body) },
                color = MaterialTheme.colorScheme.surface,
            ) {
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)) {
                    Text(prompt.title, style = MaterialTheme.typography.bodyLarge)
                    if (prompt.description.isNotBlank()) {
                        Text(
                            prompt.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
fun EmptyChatContent(agentLabel: String?, projectLabel: String?) {
    // Sequenced entrance: title fades in (0ms), detail slides up (300ms delay), hint at 450ms
    val titleAlpha = remember { Animatable(0f) }
    val detailAlpha = remember { Animatable(0f) }
    val detailOffsetPx = remember { Animatable(40f) }
    val hintAlpha = remember { Animatable(0f) }
    val hintOffsetPx = remember { Animatable(40f) }

    LaunchedEffect(Unit) {
        titleAlpha.animateTo(1f, animationSpec = tween(durationMillis = 300))
        detailAlpha.animateTo(1f, animationSpec = tween(durationMillis = 250))
        detailOffsetPx.animateTo(0f, animationSpec = tween(durationMillis = 250))
        hintAlpha.animateTo(1f, animationSpec = tween(durationMillis = 250))
        hintOffsetPx.animateTo(0f, animationSpec = tween(durationMillis = 250))
    }

    val detail = when {
        agentLabel != null && projectLabel != null -> "$agentLabel · $projectLabel"
        agentLabel != null -> agentLabel
        projectLabel != null -> projectLabel
        else -> null
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 96.dp, start = 24.dp, end = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "Start a new conversation",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.alpha(titleAlpha.value),
        )
        if (detail != null) {
            Text(
                detail,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .alpha(detailAlpha.value)
                    .offset { IntOffset(0, detailOffsetPx.value.roundToInt()) },
            )
        }
        Text(
            "Ask a question or attach a file to begin.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
            modifier = Modifier
                .alpha(hintAlpha.value)
                .offset { IntOffset(0, hintOffsetPx.value.roundToInt()) },
        )
    }
}

@Composable
fun ToolApprovalCard(
    approval: WsEvent.ToolApprovalRequest,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "Tool approval requested",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Text(
                approval.toolName,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            if (approval.args.isNotEmpty()) {
                val argsText = approval.args.entries
                    .take(6)
                    .joinToString("\n") { (k, v) -> "$k: $v" }
                Text(
                    argsText,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.8f),
                    maxLines = 8,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                NexyDangerButton(
                    text = "Deny",
                    onClick = onDeny,
                    modifier = Modifier.weight(1f),
                )
                NexyPrimaryButton(
                    text = "Approve",
                    onClick = onApprove,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}
