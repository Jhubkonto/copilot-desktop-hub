package io.nexy.android.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Switch
import androidx.compose.material3.Slider
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import io.nexy.android.ui.theme.NexySurfaceShape as RectangleShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.data.PairedServerProfile
import io.nexy.android.data.humanizeSyncError
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyDangerButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStaticProgressRecord
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.model.partitionModelsByAvailability
import io.nexy.android.ui.model.emptyModelListDetail
import io.nexy.android.ui.model.modelSourceDetail
import io.nexy.android.ui.model.modelSourceTitle
import io.nexy.android.ui.theme.ThemePreference
import io.nexy.android.ui.theme.UiStylePreference

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
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(0.35f).padding(end = 12.dp),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(0.65f, fill = true),
            maxLines = Int.MAX_VALUE,
        )
    }
}

@Composable
fun ConnectionSection(
    savedEndpoint: String?,
    profiles: List<PairedServerProfile>,
    activeProfileId: String?,
    connectionState: ConnectionState,
    preferStandaloneMode: Boolean = false,
    onSetPreferStandaloneMode: (Boolean) -> Unit = {},
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
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Server", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(savedEndpoint ?: "Not configured", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            }
            io.nexy.android.ui.connection.StandaloneModeToggle(
                isStandaloneModeEnabled = preferStandaloneMode,
                onToggle = onSetPreferStandaloneMode,
            )
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
                                NexySecondaryButton(text = "Use", onClick = { onSwitchProfile(profile.id) })
                                NexyDangerButton(text = "Delete", onClick = { profileToForget = profile })
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
            val presentation = io.nexy.android.ui.connection.getConnectionStatePresentation(connectionState)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                NexyIcon(
                    name = if (connectionState == ConnectionState.CONNECTED) NexyIconName.Check else NexyIconName.Error,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = presentation.color,
                )
                Text(presentation.label, color = presentation.color, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        NexySecondaryButton(
            text = "Scan QR / Add server",
            onClick = onOpenPairingScan,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            leadingNexyIcon = NexyIconName.Scan,
        )
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun ModelGroupList(models: List<ModelOption>) {
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

@Composable
fun ModelsSection(
    models: List<ModelOption>,
    modelSource: ModelListSource?,
    effectiveMode: EffectiveConnectionMode,
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
            }

            if (models.isEmpty()) {
                Text(emptyModelListDetail(modelSource), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text("${models.size} available model${if (models.size == 1) "" else "s"}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                val availabilityGroups = partitionModelsByAvailability(models, effectiveMode)
                if (availabilityGroups != null) {
                    Text(
                        "Available now",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    if (availabilityGroups.availableNow.isEmpty()) {
                        Text(
                            "No API-backed models available in standalone mode. Add a provider key in API Providers.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        ModelGroupList(availabilityGroups.availableNow)
                    }
                    if (availabilityGroups.requiresDesktop.isNotEmpty()) {
                        Text(
                            "Requires desktop connection",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                        ModelGroupList(availabilityGroups.requiresDesktop)
                    }
                } else {
                    ModelGroupList(models)
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
                color = if (notificationDiagnostics.approvalNotificationsEnabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error,
            )
            Text(approvalNotificationStatusDetail(notificationDiagnostics), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                SettingsInfoRow("Permission", notificationPermissionLabel(notificationDiagnostics))
                SettingsInfoRow("App notifications", if (notificationDiagnostics.appNotificationsEnabled) "Enabled" else "Disabled")
                SettingsInfoRow("Tool approvals channel", if (notificationDiagnostics.approvalChannelEnabled) "Enabled" else "Disabled")
            }

            NexySecondaryButton(text = "Open Android settings", onClick = onOpenNotificationSettings, modifier = Modifier.fillMaxWidth())
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun AppearanceSection(
    themePreference: ThemePreference,
    onSetTheme: (ThemePreference) -> Unit,
    uiStylePreference: UiStylePreference,
    onSetUiStyle: (UiStylePreference) -> Unit,
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
            Text("UI style", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
            Text("Choose the visual language independently from light and dark mode.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                UiStylePreference.entries.forEach { preference ->
                    OutlinedButton(
                        onClick = { onSetUiStyle(preference) },
                        modifier = Modifier.weight(1f),
                        shape = MaterialTheme.shapes.small,
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = if (uiStylePreference == preference) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                            contentColor = if (uiStylePreference == preference) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
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
    runningBuild: RunningBuildIdentity,
    lastInstallVerification: String?,
    updateInstallState: UpdateInstallState,
    onInstallUpdate: (AndroidUpdateManifest) -> Unit,
) {
    val updateCanInstall = canInstallUpdate(androidUpdateManifest, clientVersionCode)
    var detailsExpanded by rememberSaveable { mutableStateOf(false) }

    SettingsSectionHeader("Updates")

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Status hero card
            Surface(
                shape = RectangleShape,
                color = if (updateCanInstall) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        NexyIcon(
                            name = when {
                                androidUpdateManifest == null -> NexyIconName.Error
                                updateCanInstall -> NexyIconName.Download
                                else -> NexyIconName.Check
                            },
                            contentDescription = null,
                            modifier = Modifier.size(28.dp),
                            tint = if (updateCanInstall) {
                                MaterialTheme.colorScheme.onPrimaryContainer
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                updateStatusLabel(androidUpdateManifest, clientVersionCode),
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = if (updateCanInstall) {
                                    MaterialTheme.colorScheme.onPrimaryContainer
                                } else {
                                    MaterialTheme.colorScheme.onSurface
                                },
                            )
                            Text(
                                updateStatusDetail(androidUpdateManifest, clientVersionCode),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    androidUpdateManifest?.takeIf { updateCanInstall }?.let { manifest ->
                        FilledTonalButton(
                            onClick = { onInstallUpdate(manifest) },
                            enabled = !updateInstallState.installing,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            NexyIcon(NexyIconName.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                if (updateInstallState.installing) "Preparing update…"
                                else "Install v${manifest.versionName} (build ${manifest.versionCode})",
                            )
                        }
                    }

                    if (updateInstallState.installing) {
                        val progress = updateInstallState.downloadProgress
                        if (progress != null) {
                            LinearProgressIndicator(
                                progress = { progress },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        } else {
                            NexyStaticProgressRecord(modifier = Modifier.fillMaxWidth())
                        }
                    }
                    updateInstallState.message?.let { message ->
                        Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                    }
                    updateInstallState.error?.let { error ->
                        Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                    Text(
                        "Running ${runningBuild.versionName} · build ${runningBuild.versionCode} · ${runningBuild.shortBuildId}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    lastInstallVerification?.let { result ->
                        Text(
                            result,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (result.startsWith("Verified")) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.error
                            },
                        )
                    }
                }
            }

            // Collapsible release details
            androidUpdateManifest?.let { manifest ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { detailsExpanded = !detailsExpanded }
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        "Release details",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    NexyIcon(
                        name = if (detailsExpanded) NexyIconName.ChevronUp else NexyIconName.ChevronDown,
                        contentDescription = if (detailsExpanded) "Collapse release details" else "Expand release details",
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                if (detailsExpanded) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        SettingsInfoRow("Version", "v${manifest.versionName} (${manifest.versionCode})")
                        SettingsInfoRow("Installed", "build $clientVersionCode")
                        SettingsInfoRow("Running build ID", runningBuild.buildId)
                        SettingsInfoRow(
                            "Running source",
                            "${runningBuild.commitSha}${if (runningBuild.sourceDirty) " (dirty)" else ""}",
                        )
                        SettingsInfoRow("Published build ID", manifest.buildId ?: "Legacy manifest")
                        SettingsInfoRow("Commit", manifest.commitSha ?: "Unknown")
                        SettingsInfoRow("Checksum", checksumPreview(manifest.checksum))
                        SettingsInfoRow("Source desktop", sourceDesktopLabel(manifest.artifactUrl))
                        SettingsInfoRow("Artifact", manifest.artifactUrl)
                        SettingsInfoRow("Published", publishedAtLabel(manifest.publishedAt))
                        if (manifest.changelog.isNotBlank()) {
                            SettingsInfoRow("Notes", manifest.changelog)
                        }
                    }
                    Text(
                        "Updates are published from Nexy Desktop to the local network feed and checked when this screen opens. " +
                            "To roll back, restore an older version from desktop Settings → Developer → Android, uninstall this app, then install the update here.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun DiagnosticsSection(
    connectionDiagnostics: ConnectionDiagnostics,
    clientVersion: String,
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
            SettingsInfoRow("Last error", connectionDiagnostics.lastError?.let { humanizeSyncError(it) } ?: "None")

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
                NexyIcon(
                    name = if (techExpanded) NexyIconName.ChevronUp else NexyIconName.ChevronDown,
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

    SettingsSectionHeader("Connection Actions")

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (showWakeDesktop) {
            OutlinedButton(
                onClick = onWakeDesktop,
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.small,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.tertiary),
            ) { Text("Wake Desktop") }
        }

        NexySecondaryButton(
            text = "Disconnect",
            onClick = onDisconnect,
            modifier = Modifier.fillMaxWidth(),
            enabled = connectionState != ConnectionState.DISCONNECTED,
        )
    }

    SettingsSectionHeader("Server Management")

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        NexyDangerButton(
            text = "Forget active server",
            onClick = { confirmForgetActive = true },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
internal fun SettingsNavRow(
    title: String,
    detail: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick),
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
                    color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            NexyIcon(
                name = NexyIconName.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (enabled) 1f else 0.35f),
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
            NexyIcon(
                name = if (expanded) NexyIconName.ChevronUp else NexyIconName.ChevronDown,
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
fun VoiceDockSettingsSection(
    enabled: Boolean,
    onEnabledChanged: (Boolean) -> Unit,
) {
    SettingsSectionHeader("Voice input")

    Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onEnabledChanged(!enabled) }
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                Text(
                    "Voice Dock",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    "Float a movable microphone in chat. Hold or tap to record until you stop, then edit the transcript before sending.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = enabled, onCheckedChange = onEnabledChanged)
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
