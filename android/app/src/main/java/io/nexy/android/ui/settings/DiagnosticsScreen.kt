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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiagnosticsScreen(
    onBack: () -> Unit,
    onForgetServer: () -> Unit,
    vm: SettingsViewModel = viewModel(),
) {
    val connectionState by vm.connectionState.collectAsStateWithLifecycle()
    val profiles by vm.profiles.collectAsStateWithLifecycle()
    val activeProfileId by vm.activeProfileId.collectAsStateWithLifecycle()
    val serverVersion by vm.serverVersion.collectAsStateWithLifecycle()
    val lastError by vm.lastError.collectAsStateWithLifecycle()

    val activeProfile = profiles.firstOrNull { it.id == activeProfileId }
    val connectionDiagnostics = buildConnectionDiagnostics(
        activeProfile = activeProfile,
        connectionState = connectionState,
        serverVersion = serverVersion,
        lastError = lastError,
    )

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Diagnostics", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Developer",
            )
        },
    ) { padding ->
        Column(
            modifier = androidx.compose.ui.Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            DiagnosticsSection(
                connectionDiagnostics = connectionDiagnostics,
                clientVersion = vm.clientVersion,
            )
        }
    }
}
