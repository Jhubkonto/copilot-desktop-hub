package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onForgetServer: () -> Unit,
    onOpenSelfHeal: () -> Unit = {},
    onOpenProviders: () -> Unit = {},
    onOpenFeatureGenerator: () -> Unit = {},
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
            ConnectionSection(
                savedEndpoint = vm.savedEndpoint,
                profiles = profiles,
                activeProfileId = activeProfileId,
                connectionState = connectionState,
                onSwitchProfile = { vm.switchProfile(it) },
                onForgetProfile = { vm.forgetProfile(it) },
                onForgetServer = onForgetServer,
            )

            ModelsSection(
                models = models,
                modelSource = modelSource,
                onRefresh = { vm.refreshModels() },
            )

            NotificationsSection(
                notificationDiagnostics = notificationDiagnostics,
                onOpenNotificationSettings = { vm.openNotificationSettings() },
                onRefresh = { vm.refreshNotificationDiagnostics() },
            )

            AppearanceSection(
                themePreference = themePreference,
                onSetTheme = { vm.setThemePreference(it) },
            )

            UpdatesSection(
                androidUpdateManifest = androidUpdateManifest,
                clientVersionCode = vm.clientVersionCode,
                updateInstallState = updateInstallState,
                onRefresh = { vm.refreshUpdateManifest() },
                onInstallUpdate = { vm.installUpdate(it) },
            )

            AdvancedToolsSection(
                onOpenProviders = onOpenProviders,
                onOpenFeatureGenerator = onOpenFeatureGenerator,
                onOpenArtifacts = onOpenArtifacts,
                onOpenPromptLibrary = onOpenPromptLibrary,
                onOpenSelfHeal = onOpenSelfHeal,
            )

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
        }
    }
}
