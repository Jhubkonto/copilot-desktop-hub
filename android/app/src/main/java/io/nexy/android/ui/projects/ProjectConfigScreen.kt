package io.nexy.android.ui.projects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.launch

private val instructionModeOptions = listOf(
    "prepend" to "Prepend",
    "append" to "Append",
    "replace" to "Replace",
    "standalone" to "Standalone",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectConfigScreen(
    projectId: String,
    onBack: () -> Unit,
) {
    val projects by WsRepository.projects.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    val project = projects.find { it.id == projectId }

    var instructions by remember { mutableStateOf("") }
    var rootDirectory by remember { mutableStateOf("") }
    var instructionMode by remember { mutableStateOf("prepend") }
    var orchestrationEnabled by remember { mutableStateOf(false) }
    var defaultModel by remember { mutableStateOf("") }
    var instructionModeExpanded by remember { mutableStateOf(false) }

    var loaded by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(projectId) {
        loaded = false
        WsRepository.getProjectConfig(projectId)
    }

    LaunchedEffect(projectId) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.ProjectConfig -> if (event.id == projectId) {
                    instructions = event.config.instructions
                    rootDirectory = event.config.rootDirectory.orEmpty()
                    instructionMode = event.config.instructionMode
                    orchestrationEnabled = event.config.orchestrationEnabled
                    defaultModel = event.config.defaultModel.orEmpty()
                    loaded = true
                }
                is WsEvent.ProjectConfigUpdated -> if (event.id == projectId) {
                    saving = false
                    scope.launch { snackbarHostState.showSnackbar("Settings saved.") }
                }
                else -> {}
            }
        }
    }

    val disconnected = connectionState != ConnectionState.CONNECTED
    val instructionModeLabel = instructionModeOptions.find { it.first == instructionMode }?.second ?: "Prepend"

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Text(
                        project?.name?.let { "Configure: $it" } ?: "Project Settings",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                    )
                },
                onBack = onBack,
            )
        },
    ) { padding ->
        if (project == null) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Project not found.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onBack) { Text("Go back") }
            }
            return@Scaffold
        }

        if (!loaded) {
            Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (disconnected) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text(
                        "Not connected to desktop. Changes cannot be saved.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }

            SectionHeader("Instructions")

            OutlinedTextField(
                value = instructions,
                onValueChange = { instructions = it },
                label = { Text("Project instructions") },
                placeholder = { Text("Guidelines appended to every chat in this project") },
                enabled = !saving && !disconnected,
                minLines = 4,
                maxLines = 12,
                modifier = Modifier.fillMaxWidth(),
            )

            ExposedDropdownMenuBox(
                expanded = instructionModeExpanded,
                onExpandedChange = { if (!saving && !disconnected) instructionModeExpanded = it },
            ) {
                OutlinedTextField(
                    value = instructionModeLabel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Instruction mode") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = instructionModeExpanded) },
                    enabled = !saving && !disconnected,
                    modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                )
                ExposedDropdownMenu(
                    expanded = instructionModeExpanded,
                    onDismissRequest = { instructionModeExpanded = false },
                ) {
                    instructionModeOptions.forEach { (value, label) ->
                        DropdownMenuItem(
                            text = { Text(label) },
                            onClick = { instructionMode = value; instructionModeExpanded = false },
                        )
                    }
                }
            }

            SectionHeader("Paths")

            OutlinedTextField(
                value = rootDirectory,
                onValueChange = { rootDirectory = it },
                label = { Text("Root directory (optional)") },
                placeholder = { Text("e.g. /home/user/my-project") },
                singleLine = true,
                enabled = !saving && !disconnected,
                modifier = Modifier.fillMaxWidth(),
            )

            SectionHeader("Model")

            OutlinedTextField(
                value = defaultModel,
                onValueChange = { defaultModel = it },
                label = { Text("Default model (optional)") },
                placeholder = { Text("e.g. claude-sonnet-4-6") },
                singleLine = true,
                enabled = !saving && !disconnected,
                modifier = Modifier.fillMaxWidth(),
            )

            SectionHeader("Orchestration")

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("Orchestration", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Allow a leader agent to delegate tasks to others",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = orchestrationEnabled,
                    onCheckedChange = { if (!saving && !disconnected) orchestrationEnabled = it },
                    enabled = !saving && !disconnected,
                )
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            Button(
                onClick = {
                    if (saving || disconnected) return@Button
                    saving = true
                    WsRepository.updateProjectConfig(
                        id = projectId,
                        instructions = instructions.trim(),
                        rootDirectory = rootDirectory.trim().ifBlank { null },
                        instructionMode = instructionMode,
                        orchestrationEnabled = orchestrationEnabled,
                        defaultModel = defaultModel.trim().ifBlank { null },
                    )
                },
                enabled = !saving && !disconnected,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (saving) "Saving…" else "Save settings")
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
