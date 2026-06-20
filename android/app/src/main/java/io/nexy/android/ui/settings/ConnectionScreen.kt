package io.nexy.android.ui.settings

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
fun ConnectionScreen(
    onBack: () -> Unit,
    onForgetServer: () -> Unit,
    vm: SettingsViewModel = viewModel(),
) {
    val profiles by vm.profiles.collectAsState()
    val activeProfileId by vm.activeProfileId.collectAsState()
    val connectionState by vm.connectionState.collectAsState()

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Connection", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings",
            )
        },
    ) { padding ->
        Column(
            modifier = androidx.compose.ui.Modifier
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
            ActionsSection(
                connectionState = connectionState,
                onDisconnect = { vm.disconnect() },
                onForgetActiveServer = { vm.forgetServer() },
                onForgetServer = onForgetServer,
            )
        }
    }
}
