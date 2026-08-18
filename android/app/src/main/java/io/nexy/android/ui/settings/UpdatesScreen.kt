package io.nexy.android.ui.settings

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdatesScreen(
    onBack: () -> Unit,
    vm: SettingsViewModel = viewModel(),
) {
    val androidUpdateManifest by vm.androidUpdateManifest.collectAsStateWithLifecycle()
    val updateInstallState by vm.updateInstallState.collectAsStateWithLifecycle()
    val installVerification by vm.installVerification.collectAsStateWithLifecycle()
    val desktopVersion by vm.serverVersion.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.refreshUpdateManifest() }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Updates", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings",
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            UpdatesSection(
                androidUpdateManifest = androidUpdateManifest,
                clientVersionCode = vm.clientVersionCode,
                runningBuild = vm.runningBuild,
                lastInstallVerification = installVerification,
                updateInstallState = updateInstallState,
                onInstallUpdate = { vm.installUpdate(it) },
            )
        }
    }
}
