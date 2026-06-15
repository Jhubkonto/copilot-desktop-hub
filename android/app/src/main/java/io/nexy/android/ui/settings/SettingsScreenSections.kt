package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.PairedServerProfile
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.ui.model.emptyModelListDetail
import io.nexy.android.ui.model.modelSourceDetail
import io.nexy.android.ui.model.modelSourceTitle
import io.nexy.android.ui.theme.ThemePreference

@Composable
fun SettingsSectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    )
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun SettingsInfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(start = 12.dp).weight(1f),
            maxLines = 2,
        )
    }
}

@Composable
fun ConnectionSection(
    savedEndpoint: String?,
    profiles: List<PairedServerProfile>,
    activeProfileId: String?,
    connectionState: ConnectionState,
    onSwitchProfile: (String) -> Unit,
    onForgetProfile: (String) -> Boolean,
    onForgetServer: () -> Unit,
) {
    SettingsSectionHeader("Connection")

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text("Server", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(savedEndpoint ?: "Not configured", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

    if (profiles.isNotEmpty()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            profiles.forEach { profile ->
                Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(profile.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
                            Text(profile.endpoint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (profile.id == activeProfileId) {
                                Text("Active profile", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                            }
                        }
                        if (profile.id != activeProfileId) {
                            Row(modifier = Modifier.padding(start = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { onSwitchProfile(profile.id) }, shape = MaterialTheme.shapes.small) { Text("Use") }
                                OutlinedButton(
                                    onClick = {
                                        val hasRemaining = onForgetProfile(profile.id)
                                        if (!hasRemaining) onForgetServer()
                                    },
                                    shape = MaterialTheme.shapes.small,
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFEF4444)),
                                ) { Text("Delete") }
                            }
                        }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text("Status", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val (label, color) = when (connectionState) {
                ConnectionState.CONNECTED -> "Connected" to Color(0xFF22C55E)
                ConnectionState.CONNECTING -> "Connecting…" to Color(0xFFF59E0B)
                ConnectionState.DISCONNECTED -> "Disconnected" to Color(0xFFEF4444)
            }
            Text("● $label", color = color, style = MaterialTheme.typography.bodyMedium)
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun ModelsSection(
    models: List<ModelOption>,
    modelSource: ModelListSource?,
    onRefresh: () -> Unit,
) {
    SettingsSectionHeader("Models")

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(modelSourceTitle(modelSource), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
                    Text(modelSourceDetail(modelSource, models.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, contentDescription = "Refresh models") }
            }

            if (models.isEmpty()) {
                Text(emptyModelListDetail(modelSource), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text("${models.size} available model${if (models.size == 1) "" else "s"}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                models.take(4).forEach { model ->
                    Text(listOfNotNull(model.label, model.vendor).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (models.size > 4) {
                    Text("+${models.size - 4} more", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun NotificationsSection(
    notificationDiagnostics: NotificationDiagnostics,
    onOpenNotificationSettings: () -> Unit,
    onRefresh: () -> Unit,
) {
    SettingsSectionHeader("Notifications")

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                approvalNotificationStatusLabel(notificationDiagnostics),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = if (notificationDiagnostics.approvalNotificationsEnabled) MaterialTheme.colorScheme.onSurface else Color(0xFFEF4444),
            )
            Text(approvalNotificationStatusDetail(notificationDiagnostics), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                SettingsInfoRow("Permission", notificationPermissionLabel(notificationDiagnostics))
                SettingsInfoRow("App notifications", if (notificationDiagnostics.appNotificationsEnabled) "Enabled" else "Disabled")
                SettingsInfoRow("Tool approvals channel", if (notificationDiagnostics.approvalChannelEnabled) "Enabled" else "Disabled")
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onOpenNotificationSettings, modifier = Modifier.weight(1f), shape = MaterialTheme.shapes.small) { Text("Open Android settings") }
                OutlinedButton(onClick = onRefresh, shape = MaterialTheme.shapes.small) { Text("Refresh") }
            }
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun AppearanceSection(
    themePreference: ThemePreference,
    onSetTheme: (ThemePreference) -> Unit,
) {
    SettingsSectionHeader("Appearance")

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Theme", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
            Text("Choose how Nexy appears on this device. System follows Android's current theme.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ThemePreference.entries.forEach { preference ->
                    OutlinedButton(
                        onClick = { onSetTheme(preference) },
                        modifier = Modifier.weight(1f),
                        shape = MaterialTheme.shapes.small,
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = if (themePreference == preference) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                            contentColor = if (themePreference == preference) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
                        ),
                    ) { Text(preference.label) }
                }
            }
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun UpdatesSection(
    androidUpdateManifest: AndroidUpdateManifest?,
    clientVersionCode: Long,
    updateInstallState: UpdateInstallState,
    onRefresh: () -> Unit,
    onInstallUpdate: (AndroidUpdateManifest) -> Unit,
) {
    val updateCanInstall = canInstallUpdate(androidUpdateManifest, clientVersionCode)

    SettingsSectionHeader("Updates")

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        updateStatusLabel(androidUpdateManifest, clientVersionCode),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = if (updateCanInstall) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    )
                    Text(updateStatusDetail(androidUpdateManifest, clientVersionCode), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, contentDescription = "Refresh update manifest") }
            }

            androidUpdateManifest?.let { manifest ->
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    SettingsInfoRow("Version", "v${manifest.versionName} (${manifest.versionCode})")
                    SettingsInfoRow("Commit", manifest.commitSha ?: "Unknown")
                    SettingsInfoRow("Checksum", checksumPreview(manifest.checksum))
                    SettingsInfoRow("Source desktop", sourceDesktopLabel(manifest.artifactUrl))
                    SettingsInfoRow("Artifact", manifest.artifactUrl)
                    SettingsInfoRow("Published", publishedAtLabel(manifest.publishedAt))
                    if (manifest.changelog.isNotBlank()) {
                        SettingsInfoRow("Notes", manifest.changelog)
                    }
                }
                if (updateCanInstall) {
                    OutlinedButton(
                        onClick = { onInstallUpdate(manifest) },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !updateInstallState.installing,
                        shape = MaterialTheme.shapes.small,
                    ) {
                        Text(if (updateInstallState.installing) "Preparing update..." else "Install update")
                    }
                }
            }

            updateInstallState.message?.let { message ->
                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
            updateInstallState.error?.let { error ->
                Text(error, style = MaterialTheme.typography.bodySmall, color = Color(0xFFEF4444))
            }
            if (androidUpdateManifest != null) {
                Text(
                    "To roll back: on the desktop, open Settings → Android → Published History and click Restore. Then uninstall the current app from Android Settings and tap Install update here.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                )
            }
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun DiagnosticsSection(
    connectionDiagnostics: ConnectionDiagnostics,
    clientVersion: String,
    bugReportState: BugReportRequestState,
    onRequestBugReport: () -> Unit,
) {
    SettingsSectionHeader("Diagnostics")

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SettingsInfoRow("Profile", connectionDiagnostics.profileName)
            SettingsInfoRow("Endpoint", connectionDiagnostics.endpoint)
            SettingsInfoRow("Scheme", "${connectionDiagnostics.scheme} · ${connectionSchemeDetail(connectionDiagnostics.scheme)}")
            SettingsInfoRow("State", connectionStateLabel(connectionDiagnostics.connectionState))
            SettingsInfoRow("Client version", clientVersion)
            SettingsInfoRow("Server version", connectionDiagnostics.serverVersion ?: "Unknown")
            SettingsInfoRow("Last error", connectionDiagnostics.lastError ?: "None")
            OutlinedButton(
                onClick = onRequestBugReport,
                modifier = Modifier.fillMaxWidth(),
                enabled = connectionDiagnostics.connectionState == ConnectionState.CONNECTED && !bugReportState.requesting,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(if (bugReportState.requesting) "Requesting report..." else "Report bug to desktop")
            }
            bugReportState.message?.let { message ->
                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
            bugReportState.error?.let { error ->
                Text(error, style = MaterialTheme.typography.bodySmall, color = Color(0xFFEF4444))
            }
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun ActionsSection(
    connectionState: ConnectionState,
    onDisconnect: () -> Unit,
    onForgetActiveServer: () -> Boolean,
    onForgetServer: () -> Unit,
) {
    SettingsSectionHeader("Actions")

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OutlinedButton(
            onClick = onDisconnect,
            modifier = Modifier.fillMaxWidth(),
            enabled = connectionState != ConnectionState.DISCONNECTED,
            shape = MaterialTheme.shapes.small,
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurface,
                disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        ) { Text("Disconnect") }

        OutlinedButton(
            onClick = {
                val hasRemaining = onForgetActiveServer()
                if (!hasRemaining) onForgetServer()
            },
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.small,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFEF4444)),
        ) { Text("Forget active server") }
    }
}
