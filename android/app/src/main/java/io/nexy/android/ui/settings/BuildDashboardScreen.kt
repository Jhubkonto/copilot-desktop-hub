package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.BuildRecord
import io.nexy.android.data.model.PreflightCheck
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyTopAppBar
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BuildDashboardScreen(onBack: () -> Unit) {
    val connectionState by WsRepository.connectionState.collectAsState()
    val buildRecords by WsRepository.buildRecords.collectAsState()
    val disconnected = connectionState != ConnectionState.CONNECTED

    var desktopRecords by remember { mutableStateOf<List<BuildRecord>>(emptyList()) }
    var androidRecords by remember { mutableStateOf<List<BuildRecord>>(emptyList()) }
    var preflightChecks by remember { mutableStateOf<List<PreflightCheck>?>(null) }
    var signingChecks by remember { mutableStateOf<List<PreflightCheck>?>(null) }
    var isRunningPreflight by remember { mutableStateOf(false) }
    var isValidatingSigning by remember { mutableStateOf(false) }
    var isPublishing by remember { mutableStateOf(false) }
    var publishResult by remember { mutableStateOf<String?>(null) }
    var confirmAction by remember { mutableStateOf<(() -> Unit)?>(null) }
    var confirmTitle by remember { mutableStateOf("") }
    var confirmMessage by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        WsRepository.getBuildRecords(platform = null)
        WsRepository.getBuildWorkspaceInfo()
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.BuildRecords -> {
                    desktopRecords = event.records.filter { it.platform != "android" }
                    androidRecords = event.records.filter { it.platform == "android" }
                }
                is WsEvent.BuildPreflightResult -> {
                    isRunningPreflight = false
                    preflightChecks = event.checks
                }
                is WsEvent.AndroidSigningValidation -> {
                    isValidatingSigning = false
                    signingChecks = event.checks
                }
                is WsEvent.AndroidPublishResult -> {
                    isPublishing = false
                    publishResult = if (event.published) "Published v${event.manifest?.versionName} (${event.manifest?.versionCode})" else "Publish failed: ${event.error}"
                }
                is WsEvent.AndroidRestoreResult -> {
                    isPublishing = false
                    publishResult = if (event.restored) "Restored v${event.manifest?.versionName}" else "Restore failed: ${event.error}"
                }
                else -> {}
            }
        }
    }

    val dt = confirmAction
    if (dt != null) {
        NexyConfirmDialog(
            title = confirmTitle,
            message = confirmMessage,
            confirmLabel = "Proceed",
            destructive = false,
            onConfirm = { dt(); confirmAction = null },
            onDismiss = { confirmAction = null },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Build Dashboard", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                actions = {
                    IconButton(onClick = { WsRepository.getBuildRecords() }, enabled = !disconnected) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                },
            )
        },
    ) { padding ->
        if (disconnected) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Not connected to desktop.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            return@Scaffold
        }

        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)) {
            item {
                Spacer(Modifier.height(12.dp))
                SectionHeader("Desktop Build Preflight")
                Spacer(Modifier.height(8.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = {
                            isRunningPreflight = true
                            preflightChecks = null
                            WsRepository.runBuildPreflight()
                        },
                        enabled = !isRunningPreflight,
                        modifier = Modifier.weight(1f),
                    ) {
                        if (isRunningPreflight) CircularProgressIndicator(modifier = Modifier.padding(end = 6.dp), strokeWidth = 2.dp)
                        Text("Run preflight")
                    }
                }
                preflightChecks?.let { checks ->
                    Spacer(Modifier.height(8.dp))
                    CheckList(checks)
                }
                Spacer(Modifier.height(16.dp))
            }

            item {
                SectionHeader("Android Build Actions")
                Spacer(Modifier.height(8.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = {
                            isValidatingSigning = true
                            signingChecks = null
                            WsRepository.validateAndroidSigning()
                        },
                        enabled = !isValidatingSigning,
                        modifier = Modifier.weight(1f),
                    ) {
                        if (isValidatingSigning) CircularProgressIndicator(modifier = Modifier.padding(end = 6.dp), strokeWidth = 2.dp)
                        Text("Validate signing")
                    }
                    Button(
                        onClick = {
                            confirmTitle = "Publish Android update?"
                            confirmMessage = "This copies the latest release APK from your workspace to the local update feed and restarts the feed server."
                            confirmAction = {
                                isPublishing = true
                                publishResult = null
                                WsRepository.publishAndroidUpdate()
                            }
                        },
                        enabled = !isPublishing,
                        modifier = Modifier.weight(1f),
                    ) {
                        if (isPublishing) CircularProgressIndicator(modifier = Modifier.padding(end = 6.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                        Text("Publish APK")
                    }
                }
                signingChecks?.let { checks ->
                    Spacer(Modifier.height(8.dp))
                    CheckList(checks)
                }
                publishResult?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall, color = if (it.startsWith("Published") || it.startsWith("Restored")) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                }
                Spacer(Modifier.height(16.dp))
            }

            item {
                SectionHeader("Desktop Build Records (${desktopRecords.size})")
                Spacer(Modifier.height(4.dp))
            }
            if (desktopRecords.isEmpty()) {
                item { Text("No desktop build records.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp)) }
            } else {
                items(desktopRecords) { record ->
                    BuildRecordCard(record)
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }

            item {
                Spacer(Modifier.height(16.dp))
                SectionHeader("Android Build Records (${androidRecords.size})")
                Spacer(Modifier.height(4.dp))
            }
            if (androidRecords.isEmpty()) {
                item { Text("No Android build records.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp)) }
            } else {
                items(androidRecords) { record ->
                    BuildRecordCard(record, showRestore = record.status == "success" && record.command.contains("Release", ignoreCase = true), onRestore = {
                        confirmTitle = "Restore this build?"
                        confirmMessage = "This will restore the archived APK for v${record.version ?: record.versionCode} to the update feed."
                        confirmAction = {
                            isPublishing = true
                            publishResult = null
                            WsRepository.restoreAndroidVersion(record.versionCode ?: 0)
                        }
                    })
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun CheckList(checks: List<PreflightCheck>) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        checks.forEach { check ->
            val color = when (check.status) {
                "ok" -> MaterialTheme.colorScheme.primary
                "fail" -> MaterialTheme.colorScheme.error
                else -> MaterialTheme.colorScheme.tertiary
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(check.label, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                Text(check.status.uppercase(), style = MaterialTheme.typography.labelSmall, color = color)
            }
            if (check.detail.isNotBlank()) {
                Text(check.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun BuildRecordCard(
    record: BuildRecord,
    showRestore: Boolean = false,
    onRestore: (() -> Unit)? = null,
) {
    val statusColor = when (record.status) {
        "success" -> MaterialTheme.colorScheme.primary
        "failed" -> MaterialTheme.colorScheme.error
        "running" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val fmt = SimpleDateFormat("MM/dd HH:mm", Locale.getDefault())
    val startStr = fmt.format(Date(record.startedAt))

    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(record.command, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text(record.status, style = MaterialTheme.typography.labelSmall, color = statusColor)
        }
        val meta = listOfNotNull(
            record.branch?.let { "branch: $it" },
            record.version?.let { "v$it" } ?: record.versionCode?.let { "vc$it" },
            startStr,
        ).joinToString("  ·  ")
        if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (record.exitCode != null && record.status != "success") {
            Text("exit code: ${record.exitCode}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
        if (showRestore && onRestore != null) {
            Spacer(Modifier.height(2.dp))
            TextButton(onClick = onRestore, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                Text("Restore to feed", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
