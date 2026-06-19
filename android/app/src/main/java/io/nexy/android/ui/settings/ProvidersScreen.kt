package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.ui.components.NexyConfirmDialog
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProvidersScreen(
    onBack: () -> Unit,
    vm: ProvidersViewModel = viewModel(),
) {
    val providers by vm.providers.collectAsState()
    val isLoading by vm.isLoading.collectAsState()
    val error by vm.error.collectAsState()
    val azureEndpoint by vm.azureEndpoint.collectAsState()
    val testResult by vm.testResult.collectAsState()
    val testError by vm.testError.collectAsState()
    val isTesting by vm.isTesting.collectAsState()
    var editingProvider by remember { mutableStateOf<ProviderInfo?>(null) }
    var confirmRemoveProvider by remember { mutableStateOf<ProviderInfo?>(null) }
    var editingAzureEndpoint by remember { mutableStateOf(false) }
    var testingProviderId by remember { mutableStateOf<String?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { vm.refresh() }

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
                scope.launch { snackbarHostState.showSnackbar("${provider.label} key update sent to desktop.") }
            },
        )
    }

    confirmRemoveProvider?.let { provider ->
        NexyConfirmDialog(
            title = "Remove API key",
            message = "Remove the ${provider.label} API key from this desktop? You will need to re-enter it to use this provider.",
            confirmLabel = "Remove",
            destructive = true,
            onConfirm = {
                vm.removeKey(provider.id)
                confirmRemoveProvider = null
                scope.launch { snackbarHostState.showSnackbar("${provider.label} key removal sent to desktop.") }
            },
            onDismiss = { confirmRemoveProvider = null },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("API Providers", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                "Configure API keys for BYOK (Bring Your Own Key) providers. Keys are stored encrypted on the desktop.",
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
                providers.forEach { provider ->
                    ProviderRow(
                        provider = provider,
                        isTesting = isTesting && testingProviderId == provider.id,
                        onSetKey = { editingProvider = provider },
                        onRemoveKey = { confirmRemoveProvider = provider },
                        onTestKey = { key ->
                            testingProviderId = provider.id
                            vm.testKey(provider.id, key, if (provider.id == "azure") azureEndpoint.takeIf { it.isNotBlank() } else null)
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

@Composable
private fun ProviderRow(
    provider: ProviderInfo,
    isTesting: Boolean = false,
    onSetKey: () -> Unit,
    onRemoveKey: () -> Unit,
    onTestKey: ((String) -> Unit)? = null,
) {
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

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.weight(1f).padding(end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                provider.label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (provider.configured) {
                Badge(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.widthIn(min = 88.dp),
                ) {
                    Text(
                        "Configured",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        maxLines = 1,
                        softWrap = false,
                    )
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (provider.configured && onTestKey != null) {
                OutlinedButton(onClick = { showTestDialog = true }, enabled = !isTesting) {
                    Text("Test")
                }
            }
            OutlinedButton(onClick = onSetKey) {
                Text(if (provider.configured) "Update key" else "Set key")
            }
            if (provider.configured) {
                OutlinedButton(
                    onClick = onRemoveKey,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("Remove") }
            }
        }
    }
}

@Composable
private fun AzureEndpointRow(endpoint: String, onEdit: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text("Azure endpoint", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                endpoint.ifBlank { "Not set" },
                style = MaterialTheme.typography.bodySmall,
                color = if (endpoint.isBlank()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        OutlinedButton(onClick = onEdit) { Text("Edit") }
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
                    "Enter your API key. It will be stored encrypted on the desktop and never transmitted back to the phone.",
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
