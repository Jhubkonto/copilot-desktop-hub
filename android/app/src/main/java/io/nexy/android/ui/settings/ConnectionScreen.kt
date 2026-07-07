package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.nexy.android.data.BackgroundActivityTracker
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.data.humanizeSyncError
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.home.hasActiveActivity
import io.nexy.android.data.WsRepository
import kotlinx.coroutines.launch

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
    val effectiveMode by vm.effectiveMode.collectAsState()
    val preferStandaloneMode by vm.preferStandaloneMode.collectAsState()
    val wolSnackbar by vm.wolSnackbar.collectAsState()
    val capabilities by WsRepository.capabilities.collectAsState()
    val conflicts by WsRepository.syncConflicts.collectAsState()
    val outbox by WsRepository.syncOutbox.collectAsState()
    val syncInProgress by WsRepository.syncInProgress.collectAsState()
    val activeConversationIds by WsRepository.activeConversationIds.collectAsState()
    val pendingConversationIds by WsRepository.pendingConversationIds.collectAsState()
    val backgroundActivities by BackgroundActivityTracker.activities.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var discardOperationId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(wolSnackbar) {
        val msg = wolSnackbar ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(msg)
        vm.clearWolSnackbar()
    }

    LaunchedEffect(Unit) { WsRepository.sweepOrphanedSyncOperations() }

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
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            ConnectionSection(
                savedEndpoint = vm.savedEndpoint,
                profiles = profiles,
                activeProfileId = activeProfileId,
                connectionState = connectionState,
                preferStandaloneMode = preferStandaloneMode,
                onSetPreferStandaloneMode = { prefer ->
                    if (hasActiveActivity(activeConversationIds, pendingConversationIds, syncInProgress, backgroundActivities)) {
                        scope.launch { snackbarHostState.showSnackbar("Can't switch modes while a chat or generation is in progress") }
                    } else {
                        vm.setPreferStandaloneMode(prefer)
                    }
                },
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
                showWakeDesktop = effectiveMode != EffectiveConnectionMode.CONNECTED &&
                    effectiveMode != EffectiveConnectionMode.STANDALONE_BY_CHOICE &&
                    vm.activeProfileHasWolInfo,
                onWakeDesktop = { vm.wakeDesktop() },
            )
            HorizontalDivider()
            SettingsSectionHeader("Local data and synchronization")
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
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            TextButton(
                onClick = { WsRepository.retryStandaloneSync() },
                enabled = connectionState == ConnectionState.CONNECTED,
                modifier = Modifier.padding(horizontal = 8.dp),
            ) {
                Text("Sync now")
            }
            outbox.filter { it.state == "failed" }.forEach { operation ->
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                    Text(
                        "${operation.entityType.replaceFirstChar { it.uppercase() }} change needs attention",
                        style = MaterialTheme.typography.labelLarge,
                    )
                    Text(
                        operation.lastError?.let { humanizeSyncError(it) } ?: "Synchronization failed after ${operation.attempts} attempts.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                    TextButton(onClick = { WsRepository.retryStandaloneOperation(operation.operationId) }) {
                        Text("Retry change")
                    }
                    TextButton(
                        enabled = connectionState == ConnectionState.CONNECTED,
                        onClick = { discardOperationId = operation.operationId },
                    ) {
                        Text("Discard local change")
                    }
                }
            }
            discardOperationId?.let { operationId ->
                NexyConfirmDialog(
                    title = "Discard local change?",
                    message = "The desktop version will replace this pending Android change during the next synchronization.",
                    confirmLabel = "Discard",
                    destructive = true,
                    onConfirm = {
                        WsRepository.discardStandaloneOperation(operationId)
                        discardOperationId = null
                    },
                    onDismiss = { discardOperationId = null },
                )
            }
            conflicts.forEach { conflict ->
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
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
                    Row {
                        TextButton(
                            onClick = { WsRepository.resolveSyncConflict(conflict.id, useAndroidVersion = true) },
                            enabled = connectionState == ConnectionState.CONNECTED,
                        ) { Text("Use Android") }
                        TextButton(
                            onClick = { WsRepository.resolveSyncConflict(conflict.id, useAndroidVersion = false) },
                            enabled = connectionState == ConnectionState.CONNECTED,
                        ) { Text("Use desktop") }
                    }
                }
            }
            RemoteDesktopHelpSection()
        }
    }
}
