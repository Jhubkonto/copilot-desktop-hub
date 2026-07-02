package io.nexy.android.ui.remoteedit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.CODE_CHANGE_REQUEST_TYPE_LABELS
import io.nexy.android.data.model.CodeChangeRequestType
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteEditStartScreen(
    prefillDescription: String = "",
    onBack: () -> Unit,
    onReportCreated: (String) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf(prefillDescription) }
    var requestType by remember { mutableStateOf(CodeChangeRequestType.EDIT) }
    var customTypeLabel by remember { mutableStateOf("") }
    var typeMenuExpanded by remember { mutableStateOf(false) }
    var isSubmitting by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val isCustomType = requestType == CodeChangeRequestType.CUSTOM
    val canSubmit = description.isNotBlank() && (!isCustomType || customTypeLabel.isNotBlank()) && !isSubmitting

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.ErrorReportCaptured -> {
                    isSubmitting = false
                    onReportCreated(event.reportId)
                }
                is WsEvent.ErrorReportError -> {
                    isSubmitting = false
                    snackbarHostState.showSnackbar(event.message)
                }
                else -> {}
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("New code change") },
                onBack = onBack,
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "Describe the intended outcome. Nexy will plan the change against the connected desktop workspace and stage a patch for review.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ExposedDropdownMenuBox(
                expanded = typeMenuExpanded,
                onExpandedChange = { typeMenuExpanded = it },
            ) {
                OutlinedTextField(
                    value = CODE_CHANGE_REQUEST_TYPE_LABELS.getValue(requestType),
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Type") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = typeMenuExpanded) },
                    modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                )
                ExposedDropdownMenu(
                    expanded = typeMenuExpanded,
                    onDismissRequest = { typeMenuExpanded = false },
                ) {
                    CodeChangeRequestType.entries.forEach { type ->
                        DropdownMenuItem(
                            text = { Text(CODE_CHANGE_REQUEST_TYPE_LABELS.getValue(type)) },
                            onClick = { requestType = type; typeMenuExpanded = false },
                        )
                    }
                }
            }
            if (isCustomType) {
                OutlinedTextField(
                    value = customTypeLabel,
                    onValueChange = { customTypeLabel = it },
                    label = { Text("Label this request type…") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Title (optional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text("Description") },
                minLines = 5,
                maxLines = 10,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    if (canSubmit) {
                        isSubmitting = true
                        val effectiveTitle = title.trim().ifBlank { description.trim().take(80) }
                        WsRepository.createRemoteEditReport(
                            title = effectiveTitle,
                            description = description.trim(),
                            requestType = requestType,
                            customTypeLabel = if (isCustomType) customTypeLabel.trim() else null,
                        )
                    }
                },
                enabled = canSubmit,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (isSubmitting) "Creating request…" else "Create change request")
            }
        }
    }
}
