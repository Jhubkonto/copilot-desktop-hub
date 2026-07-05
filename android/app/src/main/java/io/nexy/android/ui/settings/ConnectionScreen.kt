package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.unit.dp
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.data.WsRepository

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionScreen(
    onBack: () -> Unit,
    onForgetServer: () -> Unit,
    onOpenPairingScan: () -> Unit = {},
    vm: SettingsViewModel = viewModel(),
) {
    val profiles by vm.profiles.collectAsState()
    val activeProfileId by vm.activeProfileId.collectAsState()
    val connectionState by vm.connectionState.collectAsState()
    val wolSnackbar by vm.wolSnackbar.collectAsState()
    val capabilities by WsRepository.capabilities.collectAsState()
    val conflicts by WsRepository.syncConflicts.collectAsState()
    val outbox by WsRepository.syncOutbox.collectAsState()
    val syncInProgress by WsRepository.syncInProgress.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var discardOperationId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(wolSnackbar) {
        val msg = wolSnackbar ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(msg)
        vm.clearWolSnackbar()
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Connection", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings",
            )
        },
        snackbarHost = {
            SnackbarHost(snackbarHostState) { data -> Snackbar(snackbarData = data) }
        },
    ) { padding ->
        Column(
            modifier = androidx.compose.ui.Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            ConnectionSection(
                savedEndpoint = vm.savedEndpoint,
                profiles = profiles,
                activeProfileId = activeProfileId,
                connectionState = connectionState,
                onSwitchProfile = { vm.switchProfile(it) },
                onForgetProfile = { vm.forgetProfile(it) },
                onForgetServer = onForgetServer,
                onOpenPairingScan = onOpenPairingScan,
            )
            ActionsSection(
                connectionState = connectionState,
                onDisconnect = { vm.disconnect() },
                onForgetActiveServer = { vm.forgetServer() },
                onForgetServer = onForgetServer,
                showWakeDesktop = connectionState != io.nexy.android.data.ConnectionState.CONNECTED && vm.activeProfileHasWolInfo,
                onWakeDesktop = { vm.wakeDesktop() },
            )
            HorizontalDivider()
            Text(
                "Local data and synchronization",
                style = MaterialTheme.typography.titleSmall,
                modifier = androidx.compose.ui.Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )
            Text(
                buildString {
                    append("${capabilities.pendingChanges} pending")
                    if (syncInProgress) append(" · Synchronizing")
                    if (capabilities.failedChanges > 0) append(" · ${capabilities.failedChanges} failed")
                    if (capabilities.conflicts > 0) append(" · ${capabilities.conflicts} conflicts")
                    capabilities.lastSuccessfulSyncAt?.let { append(" · Last sync ${android.text.format.DateUtils.getRelativeTimeSpanString(it)}") }
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = androidx.compose.ui.Modifier.padding(horizontal = 16.dp),
            )
            TextButton(
                onClick = { WsRepository.retryStandaloneSync() },
                enabled = connectionState == io.nexy.android.data.ConnectionState.CONNECTED,
                modifier = androidx.compose.ui.Modifier.padding(horizontal = 8.dp),
            ) {
                Text("Sync now")
            }
            outbox.filter { it.state == "failed" }.forEach { operation ->
                Column(modifier = androidx.compose.ui.Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                    Text(
                        "${operation.entityType.replaceFirstChar { it.uppercase() }} change needs attention",
                        style = MaterialTheme.typography.labelLarge,
                    )
                    Text(
                        operation.lastError ?: "Synchronization failed after ${operation.attempts} attempts.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                    TextButton(onClick = { WsRepository.retryStandaloneOperation(operation.operationId) }) {
                        Text("Retry change")
                    }
                    TextButton(
                        enabled = connectionState == io.nexy.android.data.ConnectionState.CONNECTED,
                        onClick = { discardOperationId = operation.operationId },
                    ) {
                        Text("Discard local change")
                    }
                }
            }
            discardOperationId?.let { operationId ->
                AlertDialog(
                    onDismissRequest = { discardOperationId = null },
                    title = { Text("Discard local change?") },
                    text = { Text("The desktop version will replace this pending Android change during the next synchronization.") },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                WsRepository.discardStandaloneOperation(operationId)
                                discardOperationId = null
                            },
                        ) { Text("Discard") }
                    },
                    dismissButton = {
                        TextButton(onClick = { discardOperationId = null }) { Text("Cancel") }
                    },
                )
            }
            conflicts.forEach { conflict ->
                Column(modifier = androidx.compose.ui.Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(
                        "${conflict.entityType.replaceFirstChar { it.uppercase() }} conflict",
                        style = MaterialTheme.typography.labelLarge,
                    )
                    Text(
                        "Both Android and desktop changed ${conflict.field}. Choose which version to keep.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Android: ${conflict.remoteValueJson.take(500)}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(
                        "Desktop: ${conflict.localValueJson.take(500)}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    androidx.compose.foundation.layout.Row {
                        TextButton(
                            onClick = { WsRepository.resolveSyncConflict(conflict.id, useAndroidVersion = true) },
                            enabled = connectionState == io.nexy.android.data.ConnectionState.CONNECTED,
                        ) { Text("Use Android") }
                        TextButton(
                            onClick = { WsRepository.resolveSyncConflict(conflict.id, useAndroidVersion = false) },
                            enabled = connectionState == io.nexy.android.data.ConnectionState.CONNECTED,
                        ) { Text("Use desktop") }
                    }
                }
            }
            RemoteDesktopHelpSection()
        }
    }
}
