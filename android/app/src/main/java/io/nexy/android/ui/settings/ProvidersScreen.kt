package io.nexy.android.ui.settings

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import io.nexy.android.ui.components.NexyTopAppBar
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexySearchField
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProvidersScreen(
    onBack: () -> Unit,
    vm: ProvidersViewModel = viewModel(),
) {
    val providers by vm.providers.collectAsStateWithLifecycle()
    val isLoading by vm.isLoading.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val azureEndpoint by vm.azureEndpoint.collectAsStateWithLifecycle()
    val testResult by vm.testResult.collectAsStateWithLifecycle()
    val testError by vm.testError.collectAsStateWithLifecycle()
    val isTesting by vm.isTesting.collectAsStateWithLifecycle()
    val pendingKeyHandoffRequests by WsRepository.pendingKeyHandoffRequests.collectAsStateWithLifecycle()
    var editingProvider by remember { mutableStateOf<ProviderInfo?>(null) }
    var confirmRemoveProvider by remember { mutableStateOf<ProviderInfo?>(null) }
    var confirmKeyHandoffProviderId by remember { mutableStateOf<String?>(null) }
    var editingAzureEndpoint by remember { mutableStateOf(false) }
    var testingProviderId by remember { mutableStateOf<String?>(null) }
    var searchQuery by remember { mutableStateOf("") }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    val filteredProviders = remember(providers, searchQuery) {
        val q = searchQuery.trim()
        if (q.isBlank()) providers
        else providers.filter { it.label.contains(q, ignoreCase = true) || it.id.contains(q, ignoreCase = true) }
    }

    LaunchedEffect(Unit) { vm.refresh() }

    LaunchedEffect(pendingKeyHandoffRequests) {
        pendingKeyHandoffRequests.keys.firstOrNull()?.let { providerId ->
            if (confirmKeyHandoffProviderId == null) {
                confirmKeyHandoffProviderId = providerId
            }
        }
    }

    testResult?.let { (provider, valid) ->
        AlertDialog(
            onDismissRequest = { vm.dismissTestResult() },
            title = { Text(if (valid) "Key valid" else "Key invalid") },
            text = {
                if (valid) {
                    Text("The $provider API key is valid.")
                } else {
                    Text(testError?.let { "Error: $it" } ?: "The key was rejected by the provider.")
                }
            },
            confirmButton = { TextButton(onClick = { vm.dismissTestResult() }) { Text("OK") } },
        )
    }

    if (editingAzureEndpoint) {
        AzureEndpointDialog(
            current = azureEndpoint,
            onDismiss = { editingAzureEndpoint = false },
            onSave = { endpoint ->
                vm.saveAzureEndpoint(endpoint)
                editingAzureEndpoint = false
                scope.launch { snackbarHostState.showSnackbar("Azure endpoint saved.") }
            },
        )
    }

    editingProvider?.let { provider ->
        SetKeyDialog(
            provider = provider,
            onDismiss = { editingProvider = null },
            onConfirm = { key ->
                vm.setKey(provider.id, key)
                editingProvider = null
                scope.launch { snackbarHostState.showSnackbar("${provider.label} key saved securely on this device.") }
            },
        )
    }

    confirmRemoveProvider?.let { provider ->
        NexyConfirmDialog(
            title = "Remove API key",
            message = "Remove the ${provider.label} API key from this device? If connected, it will also be removed from the paired desktop.",
            confirmLabel = "Remove",
            destructive = true,
            onConfirm = {
                vm.removeKey(provider.id)
                confirmRemoveProvider = null
                scope.launch { snackbarHostState.showSnackbar("${provider.label} key removed.") }
            },
            onDismiss = { confirmRemoveProvider = null },
        )
    }

    confirmKeyHandoffProviderId?.let { providerId ->
        val providerName = pendingKeyHandoffRequests[providerId] ?: providerId
        NexyConfirmDialog(
            title = "Accept API key from desktop?",
            message = "Your desktop is offering to send your $providerName API key to this device. This key will be stored locally and encrypted. Accept this one-time handoff?",
            confirmLabel = "Accept",
            onConfirm = {
                WsRepository.confirmProviderKeyHandoff(providerId)
                confirmKeyHandoffProviderId = null
                scope.launch { snackbarHostState.showSnackbar("Key handoff accepted — waiting for transfer…") }
            },
            onDismiss = {
                WsRepository.rejectProviderKeyHandoff(providerId)
                confirmKeyHandoffProviderId = null
            },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("API Providers", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isLoading,
            onRefresh = { vm.refresh() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            Text(
                "Configure API keys for standalone chat. Keys are encrypted on this device; when connected, updates are also sent to the paired desktop.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            if (providers.isEmpty() && isLoading) {
                CircularProgressIndicator(modifier = Modifier.padding(16.dp))
            } else if (providers.isEmpty()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        error ?: "No providers found.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TextButton(onClick = { vm.refresh() }) { Text("Retry") }
                }
            } else {
                NexySearchField(
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    placeholder = "Search providers",
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                if (filteredProviders.isEmpty()) {
                    NexyEmptyState(
                        title = "No matching providers.",
                        detail = "Try a different name.",
                        modifier = Modifier.padding(24.dp),
                    )
                } else {
                    LazyColumn(modifier = Modifier.weight(1f)) {
                        items(filteredProviders, key = { it.id }) { provider ->
                            ProviderRow(
                                provider = provider,
                                isTesting = isTesting && testingProviderId == provider.id,
                                onSetKey = { editingProvider = provider },
                                onRemoveKey = { confirmRemoveProvider = provider },
                                onTestKey = { key ->
                                    testingProviderId = provider.id
                                    vm.testKey(provider.id, key, if (provider.id == "azure") azureEndpoint.takeIf { it.isNotBlank() } else null)
                                },
                                onRequestFromDesktop = {
                                    WsRepository.confirmProviderKeyHandoff(provider.id)
                                    scope.launch {
                                        snackbarHostState.showSnackbar("Requested — waiting for desktop to approve…")
                                    }
                                },
                            )
                            if (provider.id == "azure" && provider.configured) {
                                AzureEndpointRow(
                                    endpoint = azureEndpoint,
                                    onEdit = { editingAzureEndpoint = true },
                                )
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
            }
        }
        }
    }
}

@Composable
private fun ProviderRow(
    provider: ProviderInfo,
    isTesting: Boolean = false,
    onSetKey: () -> Unit,
    onRemoveKey: () -> Unit,
    onTestKey: ((String) -> Unit)? = null,
    onRequestFromDesktop: () -> Unit = {},
) {
    var showMenu by remember { mutableStateOf(false) }
    var showTestDialog by remember { mutableStateOf(false) }

    if (showTestDialog) {
        TestKeyDialog(
            provider = provider,
            isTesting = isTesting,
            onDismiss = { showTestDialog = false },
            onTest = { key ->
                onTestKey?.invoke(key)
                showTestDialog = false
            },
        )
    }

    io.nexy.android.ui.components.NexyListRow(
        title = provider.label,
        subtitleContent = {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                ProviderStatusBadge(provider = provider)
                if (provider.configuredOnDesktopOnly) {
                    Text(
                        "Configured on desktop only — not usable in standalone mode yet",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        trailing = {
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = "Provider options", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                    if (provider.configuredOnDesktopOnly) {
                        DropdownMenuItem(
                            text = { Text("Request key from desktop") },
                            leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                            onClick = { showMenu = false; onRequestFromDesktop() },
                        )
                    }
                    DropdownMenuItem(
                        text = { Text(if (provider.configured) "Update key on this device" else "Add key on this device") },
                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                        onClick = { showMenu = false; onSetKey() },
                    )
                    if (provider.configured && onTestKey != null) {
                        DropdownMenuItem(
                            text = { Text(if (isTesting) "Testing…" else "Test key") },
                            leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                            enabled = !isTesting,
                            onClick = { showMenu = false; showTestDialog = true },
                        )
                    }
                    if (provider.configured) {
                        DropdownMenuItem(
                            text = { Text("Remove key", color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                            onClick = { showMenu = false; onRemoveKey() },
                        )
                    }
                }
            }
        },
    )
}

@Composable
private fun ProviderStatusBadge(provider: ProviderInfo) {
    val (label, containerColor, contentColor) = when {
        provider.configured -> Triple(
            "Connected",
            MaterialTheme.colorScheme.primary.copy(alpha = 0.15f),
            MaterialTheme.colorScheme.primary,
        )
        provider.configuredOnDesktopOnly -> Triple(
            "Desktop only",
            MaterialTheme.colorScheme.tertiary.copy(alpha = 0.15f),
            MaterialTheme.colorScheme.tertiary,
        )
        else -> Triple(
            "Not set",
            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.15f),
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    io.nexy.android.ui.components.NexyStatusBadge(
        label = label,
        containerColor = containerColor,
        contentColor = contentColor,
    )
}

@Composable
private fun AzureEndpointRow(endpoint: String, onEdit: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 32.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text("Azure endpoint", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    endpoint.ifBlank { "Not set" },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (endpoint.isBlank()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(onClick = onEdit) {
                Icon(Icons.Default.Edit, contentDescription = "Edit endpoint", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SetKeyDialog(
    provider: ProviderInfo,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var key by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Set ${provider.label} API key") },
        text = {
            Column {
                Text(
                    "Enter your API key. It is encrypted on this device. When a desktop is connected, Nexy also sends the update over the authenticated pairing connection.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = key,
                    onValueChange = { key = it },
                    label = { Text("API key") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { if (key.isNotBlank()) onConfirm(key) },
                enabled = key.isNotBlank(),
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

@Composable
private fun TestKeyDialog(
    provider: ProviderInfo,
    isTesting: Boolean,
    onDismiss: () -> Unit,
    onTest: (String) -> Unit,
) {
    var key by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Test ${provider.label} key") },
        text = {
            Column {
                Text(
                    "Enter a key to test. The key is sent directly to the provider and not stored.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = key,
                    onValueChange = { key = it },
                    label = { Text("API key") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { if (key.isNotBlank()) onTest(key) },
                enabled = key.isNotBlank() && !isTesting,
            ) { Text(if (isTesting) "Testing…" else "Test") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

@Composable
private fun AzureEndpointDialog(
    current: String,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var endpoint by remember { mutableStateOf(current) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Azure endpoint") },
        text = {
            Column {
                Text(
                    "Enter the Azure OpenAI endpoint URL (e.g. https://my-resource.openai.azure.com).",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = endpoint,
                    onValueChange = { endpoint = it },
                    label = { Text("Endpoint URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(endpoint) }) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
