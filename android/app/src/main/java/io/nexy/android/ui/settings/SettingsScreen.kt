package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onForgetServer: () -> Unit,
    onOpenAppearance: () -> Unit = {},
    onOpenConnection: () -> Unit = {},
    onOpenModels: () -> Unit = {},
    onOpenNotifications: () -> Unit = {},
    onOpenUpdates: () -> Unit = {},
    onOpenDiagnostics: () -> Unit = {},
    onOpenSelfHeal: () -> Unit = {},
    onOpenProviders: () -> Unit = {},
    onOpenPromptLibrary: () -> Unit = {},
    onOpenGlobalSettings: () -> Unit = {},
    onOpenMcpAndCli: () -> Unit = {},
    onOpenBuildDashboard: () -> Unit = {},
) {
    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Settings", style = MaterialTheme.typography.titleMedium) },
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
            // — General —
            SettingsSectionHeader("General")
            SettingsNavRow(
                title = "Appearance",
                detail = "Light, Dark, or System theme",
                onClick = onOpenAppearance,
            )
            SettingsNavRow(
                title = "Connection",
                detail = "Server profiles and connection status",
                onClick = onOpenConnection,
            )

            // — Configuration —
            SettingsSectionHeader("Configuration")
            SettingsNavRow(
                title = "Global Settings",
                detail = "Default model, temperature, auto-start, clipboard",
                onClick = onOpenGlobalSettings,
            )
            SettingsNavRow(
                title = "Models",
                detail = "Available models from your desktop",
                onClick = onOpenModels,
            )
            SettingsNavRow(
                title = "CLI Models",
                detail = "Claude and Codex CLI model availability",
                onClick = onOpenMcpAndCli,
            )
            SettingsNavRow(
                title = "Notifications",
                detail = "Tool approval push notifications",
                onClick = onOpenNotifications,
            )

            // — Tools —
            SettingsSectionHeader("Tools")
            SettingsNavRow(
                title = "API Providers",
                detail = "Configure BYOK keys stored encrypted on the desktop",
                onClick = onOpenProviders,
            )
            SettingsNavRow(
                title = "Prompt Library",
                detail = "Browse and manage reusable prompt templates",
                onClick = onOpenPromptLibrary,
            )
            SettingsNavRow(
                title = "Self-Heal Reports",
                detail = "Review investigation and fix reports",
                onClick = onOpenSelfHeal,
            )
            SettingsNavRow(
                title = "Updates",
                detail = "App version and OTA install",
                onClick = onOpenUpdates,
            )

            SettingsNavRow(
                title = "MCP Servers",
                detail = "Configured desktop MCP server list",
                onClick = onOpenMcpAndCli,
            )

            // — Developer —
            SettingsSectionHeader("Developer")
            SettingsNavRow(
                title = "Build Dashboard",
                detail = "Build records, preflight, and APK publish/restore",
                onClick = onOpenBuildDashboard,
            )
            SettingsNavRow(
                title = "Diagnostics",
                detail = "Connection info and bug reports",
                onClick = onOpenDiagnostics,
            )

            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant,
                modifier = Modifier.padding(bottom = 24.dp),
            )
        }
    }
}
