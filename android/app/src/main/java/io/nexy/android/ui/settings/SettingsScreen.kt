package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.ui.model.emptyModelListDetail
import io.nexy.android.ui.model.modelSourceDetail
import io.nexy.android.ui.model.modelSourceTitle
import io.nexy.android.ui.theme.ThemePreference

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onForgetServer: () -> Unit,
    vm: SettingsViewModel = viewModel(),
) {
    val connectionState by vm.connectionState.collectAsState()
    val profiles by vm.profiles.collectAsState()
    val activeProfileId by vm.activeProfileId.collectAsState()
    val models by vm.models.collectAsState()
    val modelSource by vm.modelSource.collectAsState()
    val notificationDiagnostics by vm.notificationDiagnostics.collectAsState()
    val themePreference by vm.themePreference.collectAsState()
    val androidUpdateManifest by vm.androidUpdateManifest.collectAsState()
    val updateInstallState by vm.updateInstallState.collectAsState()
    val serverVersion by vm.serverVersion.collectAsState()
    val lastError by vm.lastError.collectAsState()
    val savedEndpoint = vm.savedEndpoint
    val clientVersionCode = vm.clientVersionCode
    val activeProfile = profiles.firstOrNull { it.id == activeProfileId }
    val connectionDiagnostics = buildConnectionDiagnostics(
        activeProfile = activeProfile,
        connectionState = connectionState,
        serverVersion = serverVersion,
        lastError = lastError,
    )
    val updateCanInstall = canInstallUpdate(androidUpdateManifest, clientVersionCode)

    LaunchedEffect(Unit) {
        vm.refreshModels()
        vm.refreshUpdateManifest()
        vm.refreshNotificationDiagnostics()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings", style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                    navigationIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            SettingsSectionHeader("Connection")

            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        "Server",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        savedEndpoint ?: "Not configured",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            if (profiles.isNotEmpty()) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    profiles.forEach { profile ->
                        Surface(
                            color = MaterialTheme.colorScheme.surface,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(
                                    modifier = Modifier.weight(1f),
                                    verticalArrangement = Arrangement.spacedBy(2.dp),
                                ) {
                                    Text(
                                        profile.name,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Medium,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        profile.endpoint,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    if (profile.id == activeProfileId) {
                                        Text(
                                            "Active profile",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                                if (profile.id != activeProfileId) {
                                    Row(
                                        modifier = Modifier.padding(start = 12.dp),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        OutlinedButton(
                                            onClick = { vm.switchProfile(profile.id) },
                                            shape = MaterialTheme.shapes.small,
                                        ) {
                                            Text("Use")
                                        }
                                        OutlinedButton(
                                            onClick = {
                                                val hasRemainingProfiles = vm.forgetProfile(profile.id)
                                                if (!hasRemainingProfiles) onForgetServer()
                                            },
                                            shape = MaterialTheme.shapes.small,
                                            colors = ButtonDefaults.outlinedButtonColors(
                                                contentColor = Color(0xFFEF4444),
                                            ),
                                        ) {
                                            Text("Delete")
                                        }
                                    }
                                }
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }

            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        "Status",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    val (label, color) = when (connectionState) {
                        ConnectionState.CONNECTED -> "Connected" to Color(0xFF22C55E)
                        ConnectionState.CONNECTING -> "Connecting…" to Color(0xFFF59E0B)
                        ConnectionState.DISCONNECTED -> "Disconnected" to Color(0xFFEF4444)
                    }
                    Text(
                        "● $label",
                        color = color,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            SettingsSectionHeader("Models")

            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(
                                modelSourceTitle(modelSource),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                modelSourceDetail(modelSource, models.size),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(onClick = { vm.refreshModels() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh models")
                        }
                    }

                    if (models.isEmpty()) {
                        Text(
                            emptyModelListDetail(modelSource),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        Text(
                            "${models.size} available model${if (models.size == 1) "" else "s"}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        models.take(4).forEach { model ->
                            Text(
                                listOfNotNull(model.label, model.vendor).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (models.size > 4) {
                            Text(
                                "+${models.size - 4} more",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            SettingsSectionHeader("Notifications")

            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        approvalNotificationStatusLabel(notificationDiagnostics),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = if (notificationDiagnostics.approvalNotificationsEnabled) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            Color(0xFFEF4444)
                        },
                    )
                    Text(
                        approvalNotificationStatusDetail(notificationDiagnostics),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        NotificationInfoRow(
                            label = "Permission",
                            value = notificationPermissionLabel(notificationDiagnostics),
                        )
                        NotificationInfoRow(
                            label = "App notifications",
                            value = if (notificationDiagnostics.appNotificationsEnabled) "Enabled" else "Disabled",
                        )
                        NotificationInfoRow(
                            label = "Tool approvals channel",
                            value = if (notificationDiagnostics.approvalChannelEnabled) "Enabled" else "Disabled",
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(
                            onClick = { vm.openNotificationSettings() },
                            modifier = Modifier.weight(1f),
                            shape = MaterialTheme.shapes.small,
                        ) {
                            Text("Open Android settings")
                        }
                        OutlinedButton(
                            onClick = { vm.refreshNotificationDiagnostics() },
                            shape = MaterialTheme.shapes.small,
                        ) {
                            Text("Refresh")
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            SettingsSectionHeader("Appearance")

            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        "Theme",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        "Choose how Nexy appears on this device. System follows Android's current theme.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ThemePreference.entries.forEach { preference ->
                            OutlinedButton(
                                onClick = { vm.setThemePreference(preference) },
                                modifier = Modifier.weight(1f),
                                shape = MaterialTheme.shapes.small,
                                colors = ButtonDefaults.outlinedButtonColors(
                                    containerColor = if (themePreference == preference) {
                                        MaterialTheme.colorScheme.primaryContainer
                                    } else {
                                        Color.Transparent
                                    },
                                    contentColor = if (themePreference == preference) {
                                        MaterialTheme.colorScheme.onPrimaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onSurface
                                    },
                                ),
                            ) {
                                Text(preference.label)
                            }
                        }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            SettingsSectionHeader("Updates")

            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(
                                updateStatusLabel(androidUpdateManifest, clientVersionCode),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                                color = if (updateCanInstall) {
                                    MaterialTheme.colorScheme.primary
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
                        IconButton(onClick = { vm.refreshUpdateManifest() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh update manifest")
                        }
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
                                onClick = { vm.installUpdate(manifest) },
                                modifier = Modifier.fillMaxWidth(),
                                enabled = !updateInstallState.installing,
                                shape = MaterialTheme.shapes.small,
                            ) {
                                Text(if (updateInstallState.installing) "Preparing update..." else "Install update")
                            }
                        }
                    }
                    updateInstallState.message?.let { message ->
                        Text(
                            message,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    updateInstallState.error?.let { error ->
                        Text(
                            error,
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFFEF4444),
                        )
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            SettingsSectionHeader("Diagnostics")

            Surface(
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    SettingsInfoRow("Profile", connectionDiagnostics.profileName)
                    SettingsInfoRow("Endpoint", connectionDiagnostics.endpoint)
                    SettingsInfoRow(
                        "Scheme",
                        "${connectionDiagnostics.scheme} · ${connectionSchemeDetail(connectionDiagnostics.scheme)}",
                    )
                    SettingsInfoRow("State", connectionStateLabel(connectionDiagnostics.connectionState))
                    SettingsInfoRow("Client version", vm.clientVersion)
                    SettingsInfoRow("Server version", connectionDiagnostics.serverVersion ?: "Unknown")
                    SettingsInfoRow("Last error", connectionDiagnostics.lastError ?: "None")
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            SettingsSectionHeader("Actions")

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(
                    onClick = { vm.disconnect() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = connectionState != ConnectionState.DISCONNECTED,
                    shape = MaterialTheme.shapes.small,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.onSurface,
                        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                ) {
                    Text("Disconnect")
                }

                OutlinedButton(
                    onClick = {
                        val hasRemainingProfiles = vm.forgetServer()
                        if (!hasRemainingProfiles) onForgetServer()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.small,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Color(0xFFEF4444),
                    ),
                ) {
                    Text("Forget active server")
                }
            }
        }
    }
}

@Composable
private fun SettingsSectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    )
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun NotificationInfoRow(label: String, value: String) {
    SettingsInfoRow(label, value)
}

@Composable
private fun SettingsInfoRow(label: String, value: String) {
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
