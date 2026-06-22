package io.nexy.android.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import io.nexy.android.ui.components.NexyConfirmDialog
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
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f).padding(end = 12.dp),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
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
    onOpenPairingScan: () -> Unit = {},
) {
    var profileToForget by remember { mutableStateOf<PairedServerProfile?>(null) }

    profileToForget?.let { profile ->
        NexyConfirmDialog(
            title = "Delete saved server?",
            message = "\"${profile.name}\" will be removed from this phone. You can pair it again later from Nexy Desktop.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                val hasRemaining = onForgetProfile(profile.id)
                profileToForget = null
                if (!hasRemaining) onForgetServer()
            },
            onDismiss = { profileToForget = null },
        )
    }

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
                                    onClick = { profileToForget = profile },
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
                ConnectionState.POLLING -> "Searching…" to Color(0xFFF59E0B)
                ConnectionState.DISCONNECTED -> "Disconnected" to Color(0xFFEF4444)
            }
            Text("● $label", color = color, style = MaterialTheme.typography.bodyMedium)
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(
            onClick = onOpenPairingScan,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            shape = MaterialTheme.shapes.small,
        ) {
            Icon(
                Icons.Default.QrCodeScanner,
                contentDescription = null,
                modifier = Modifier.padding(end = 8.dp),
            )
            Text("Scan QR / Add server")
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
                models
                    .filterNot { it.id == "default" }
                    .groupBy { it.vendor?.takeIf { vendor -> vendor.isNotBlank() } ?: "Other" }
                    .toSortedMap()
                    .forEach { (vendor, vendorModels) ->
                        Text(
                            vendor,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurface,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                        vendorModels.sortedBy { it.label.lowercase() }.forEach { model ->
                            Text(
                                model.label,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
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
    refreshed: Boolean = false,
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

            OutlinedButton(onClick = onOpenNotificationSettings, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.small) { Text("Open Android settings") }
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (refreshed) {
            Text("Status updated", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        } else {
            Spacer(Modifier.weight(1f))
        }
        FilledTonalButton(onClick = onRefresh) {
            Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text("Refresh")
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
    var techExpanded by rememberSaveable { mutableStateOf(false) }

    SettingsSectionHeader("Diagnostics")

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SettingsInfoRow("Profile", connectionDiagnostics.profileName)
            SettingsInfoRow("Endpoint", connectionDiagnostics.endpoint)
            SettingsInfoRow("State", connectionStateLabel(connectionDiagnostics.connectionState))
            SettingsInfoRow("Last error", connectionDiagnostics.lastError ?: "None")

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { techExpanded = !techExpanded }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "Technical details",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Icon(
                    if (techExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = if (techExpanded) "Collapse technical details" else "Expand technical details",
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }

            if (techExpanded) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SettingsInfoRow("Scheme", "${connectionDiagnostics.scheme} · ${connectionSchemeDetail(connectionDiagnostics.scheme)}")
                    SettingsInfoRow("Client version", clientVersion)
                    SettingsInfoRow("Server version", connectionDiagnostics.serverVersion ?: "Unknown")
                    SettingsInfoRow("MAC address", connectionDiagnostics.macAddress ?: "Unknown")
                    SettingsInfoRow("Broadcast", connectionDiagnostics.broadcastAddress ?: "Unknown")
                    SettingsInfoRow("mDNS name", connectionDiagnostics.mDnsName ?: "Unknown")
                    SettingsInfoRow("WoL enabled", if (connectionDiagnostics.wolEnabled) "Yes" else "No")
                }
            }

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
    showWakeDesktop: Boolean = false,
    onWakeDesktop: () -> Unit = {},
) {
    var confirmForgetActive by remember { mutableStateOf(false) }

    if (confirmForgetActive) {
        NexyConfirmDialog(
            title = "Forget active server?",
            message = "The active server profile will be removed from this phone. If no saved server remains, you will need to pair again.",
            confirmLabel = "Forget",
            destructive = true,
            onConfirm = {
                val hasRemaining = onForgetActiveServer()
                confirmForgetActive = false
                if (!hasRemaining) onForgetServer()
            },
            onDismiss = { confirmForgetActive = false },
        )
    }

    SettingsSectionHeader("Actions")

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (showWakeDesktop) {
            OutlinedButton(
                onClick = onWakeDesktop,
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.small,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFF59E0B)),
            ) { Text("Wake Desktop") }
        }

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
            onClick = { confirmForgetActive = true },
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.small,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFEF4444)),
        ) { Text("Forget active server") }
    }
}

@Composable
internal fun SettingsNavRow(
    title: String,
    detail: String,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun RemoteDesktopHelpSection() {
    var expanded by remember { mutableStateOf(false) }

    SettingsSectionHeader("Remote Desktop Mode")

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { expanded = !expanded },
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    "How to wake your desktop remotely",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    "Wake-on-LAN, auto-start, and reconnect requirements",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(
                if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                contentDescription = if (expanded) "Collapse" else "Expand",
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (expanded) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            HelpItem(
                title = "Enable Wake-on-LAN on your desktop",
                body = "On Windows: Device Manager → Network Adapters → right-click your LAN adapter → Power Management → check \"Allow this device to wake the computer\". Also enable Wake-on-LAN in BIOS/UEFI.\n\nOn macOS: System Settings → Energy Saver → enable \"Wake for network access\", or run: sudo pmset -a womp 1",
            )
            HelpItem(
                title = "Use a wired (Ethernet) connection",
                body = "Wake-on-LAN is unreliable over Wi-Fi — most routers do not forward UDP broadcast packets to sleeping wireless adapters. A wired Ethernet connection is strongly recommended.",
            )
            HelpItem(
                title = "Enable auto-start on the desktop",
                body = "In the Nexy desktop app → Settings → Mobile → turn on \"Launch at login\". This ensures the WebSocket server restarts automatically after a WoL wake or reboot, so your phone can reconnect without you opening the app.",
            )
            HelpItem(
                title = "How reconnection works",
                body = "When disconnected, Nexy retries with exponential backoff (1 s → 2 s → 4 s → … → 30 s), then switches to slow polling every 60 seconds indefinitely. In polling mode it also listens for the desktop's mDNS broadcast to reconnect automatically if the IP changed. You can also tap \"Wake it up\" in the banner on the home screen to send a magic packet.",
            )
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun HelpItem(title: String, body: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            body,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
