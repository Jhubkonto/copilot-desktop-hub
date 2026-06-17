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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onForgetServer: () -> Unit,
    onOpenSelfHeal: () -> Unit = {},
    onOpenProviders: () -> Unit = {},
    onOpenFeatureGenerator: () -> Unit = {},
    onOpenProjectGenerator: () -> Unit = {},
    onOpenArtifacts: () -> Unit = {},
    onOpenPromptLibrary: () -> Unit = {},
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
    val bugReportState by vm.bugReportState.collectAsState()
    val serverVersion by vm.serverVersion.collectAsState()
    val lastError by vm.lastError.collectAsState()
    val activeProfile = profiles.firstOrNull { it.id == activeProfileId }
    val connectionDiagnostics = buildConnectionDiagnostics(
        activeProfile = activeProfile,
        connectionState = connectionState,
        serverVersion = serverVersion,
        lastError = lastError,
    )

    LaunchedEffect(Unit) {
        vm.refreshModels()
        vm.refreshUpdateManifest()
        vm.refreshNotificationDiagnostics()
    }

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
            AppearanceSection(
                themePreference = themePreference,
                onSetTheme = { vm.setThemePreference(it) },
            )

            // — Connection —
            ConnectionSection(
                savedEndpoint = vm.savedEndpoint,
                profiles = profiles,
                activeProfileId = activeProfileId,
                connectionState = connectionState,
                onSwitchProfile = { vm.switchProfile(it) },
                onForgetProfile = { vm.forgetProfile(it) },
                onForgetServer = onForgetServer,
            )

            // — Models —
            ModelsSection(
                models = models,
                modelSource = modelSource,
                onRefresh = { vm.refreshModels() },
            )

            // — Notifications —
            NotificationsSection(
                notificationDiagnostics = notificationDiagnostics,
                onOpenNotificationSettings = { vm.openNotificationSettings() },
                onRefresh = { vm.refreshNotificationDiagnostics() },
            )

            // — Updates —
            UpdatesSection(
                androidUpdateManifest = androidUpdateManifest,
                clientVersionCode = vm.clientVersionCode,
                updateInstallState = updateInstallState,
                onRefresh = { vm.refreshUpdateManifest() },
                onInstallUpdate = { vm.installUpdate(it) },
            )

            // — Tools (nav rows) —
            SettingsSectionHeader("Tools")
            Text(
                "Manage providers, prompts, artifacts, and automated workflows.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
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
                title = "Project Generator",
                detail = "LLM-assisted project scaffolding with agents and milestones",
                onClick = onOpenProjectGenerator,
            )
            SettingsNavRow(
                title = "Feature Generator",
                detail = "Plan, review, apply, and commit generated changes",
                onClick = onOpenFeatureGenerator,
            )
            SettingsNavRow(
                title = "Artifacts",
                detail = "Browse generated project artifacts",
                onClick = onOpenArtifacts,
            )
            SettingsNavRow(
                title = "Self-Heal Reports",
                detail = "Review investigation and fix reports",
                onClick = onOpenSelfHeal,
            )

            // — Developer —
            SettingsSectionHeader("Developer")
            DiagnosticsSection(
                connectionDiagnostics = connectionDiagnostics,
                clientVersion = vm.clientVersion,
                bugReportState = bugReportState,
                onRequestBugReport = { vm.requestBugReport() },
            )
            ActionsSection(
                connectionState = connectionState,
                onDisconnect = { vm.disconnect() },
                onForgetActiveServer = { vm.forgetServer() },
                onForgetServer = onForgetServer,
            )

            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant,
                modifier = Modifier.padding(bottom = 24.dp),
            )
        }
    }
}
