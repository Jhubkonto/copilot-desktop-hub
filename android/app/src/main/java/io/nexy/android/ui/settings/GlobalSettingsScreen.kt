package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlobalSettingsScreen(onBack: () -> Unit) {
    val connectionState by WsRepository.connectionState.collectAsState()
    val disconnected = connectionState != ConnectionState.CONNECTED

    var defaultModel by remember { mutableStateOf("") }
    var temperature by remember { mutableStateOf("") }
    var maxTokens by remember { mutableStateOf("") }
    var autoStart by remember { mutableStateOf(false) }
    var autoClipboard by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        WsRepository.getSetting("default_model")
        WsRepository.getSetting("default_temperature")
        WsRepository.getSetting("default_max_tokens")
        WsRepository.getSetting("auto_start")
        WsRepository.getSetting("auto_clipboard")
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.SettingValue -> when (event.key) {
                    "default_model" -> defaultModel = event.value.orEmpty()
                    "default_temperature" -> temperature = event.value.orEmpty()
                    "default_max_tokens" -> maxTokens = event.value.orEmpty()
                    "auto_start" -> autoStart = event.value == "true"
                    "auto_clipboard" -> autoClipboard = event.value == "true"
                    else -> {}
                }
                is WsEvent.SettingSet -> when (event.key) {
                    "default_model" -> defaultModel = event.value
                    "default_temperature" -> temperature = event.value
                    "default_max_tokens" -> maxTokens = event.value
                    "auto_start" -> autoStart = event.value == "true"
                    "auto_clipboard" -> autoClipboard = event.value == "true"
                    else -> {}
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Global Settings", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            // — Model —
            GlobalSettingsSectionHeader("Model")

            OutlinedTextField(
                value = defaultModel,
                onValueChange = {
                    defaultModel = it
                    WsRepository.setSetting("default_model", it.trim())
                },
                label = { Text("Default model") },
                placeholder = { Text("e.g. claude-sonnet-4-6") },
                singleLine = true,
                enabled = !disconnected,
                modifier = Modifier.fillMaxWidth(),
            )

            // — Generation —
            GlobalSettingsSectionHeader("Generation")

            OutlinedTextField(
                value = temperature,
                onValueChange = { v ->
                    temperature = v
                    v.toFloatOrNull()?.let { WsRepository.setSetting("default_temperature", v.trim()) }
                },
                label = { Text("Default temperature") },
                placeholder = { Text("0.0 – 1.0") },
                singleLine = true,
                enabled = !disconnected,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = maxTokens,
                onValueChange = { v ->
                    maxTokens = v
                    v.toIntOrNull()?.let { WsRepository.setSetting("default_max_tokens", v.trim()) }
                },
                label = { Text("Default max tokens") },
                placeholder = { Text("256 – 128000") },
                singleLine = true,
                enabled = !disconnected,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )

            // — Behaviour —
            GlobalSettingsSectionHeader("Behaviour")

            GlobalSettingsToggleRow(
                title = "Auto-start",
                subtitle = "Automatically begin a new chat on app launch",
                checked = autoStart,
                enabled = !disconnected,
                onCheckedChange = {
                    autoStart = it
                    WsRepository.setSetting("auto_start", it.toString())
                },
            )

            GlobalSettingsToggleRow(
                title = "Auto-clipboard",
                subtitle = "Paste clipboard content into the composer on focus",
                checked = autoClipboard,
                enabled = !disconnected,
                onCheckedChange = {
                    autoClipboard = it
                    WsRepository.setSetting("auto_clipboard", it.toString())
                },
            )

            if (disconnected) {
                Text(
                    "Not connected — changes will be applied when the desktop reconnects.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun GlobalSettingsSectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun GlobalSettingsToggleRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = { if (enabled) onCheckedChange(it) }, enabled = enabled)
    }
}
