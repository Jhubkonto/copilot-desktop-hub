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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(
    onBack: () -> Unit,
    vm: SettingsViewModel = viewModel(),
) {
    val notificationDiagnostics by vm.notificationDiagnostics.collectAsStateWithLifecycle()
    val readAloudEnabled by vm.readAloudEnabled.collectAsStateWithLifecycle()
    val voiceDockEnabled by vm.voiceDockEnabled.collectAsStateWithLifecycle()
    val spokenOutputEnabled by vm.spokenOutputEnabled.collectAsStateWithLifecycle()
    val spokenOutputSettings by vm.spokenOutputSettings.collectAsStateWithLifecycle()
    val spokenVoices by vm.spokenVoices.collectAsStateWithLifecycle()
    var refreshed by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.refreshNotificationDiagnostics() }

    LaunchedEffect(refreshed) {
        if (refreshed) {
            delay(2000)
            refreshed = false
        }
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Notifications", style = MaterialTheme.typography.titleMedium) },
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
            NotificationsSection(
                notificationDiagnostics = notificationDiagnostics,
                onOpenNotificationSettings = { vm.openNotificationSettings() },
                onRefresh = {
                    vm.refreshNotificationDiagnostics()
                    refreshed = true
                },
                refreshed = refreshed,
            )
            ReadAloudSection(
                readAloudEnabled = readAloudEnabled,
                onReadAloudEnabledChanged = { vm.setReadAloudEnabled(it) },
            )
            SpokenOutputSettingsSection(
                enabled = spokenOutputEnabled,
                settings = spokenOutputSettings,
                voices = spokenVoices,
                onEnabledChanged = vm::setSpokenOutputEnabled,
                onSettingsChanged = vm::setSpokenOutputSettings,
            )
            VoiceDockSettingsSection(
                enabled = voiceDockEnabled,
                onEnabledChanged = vm::setVoiceDockEnabled,
            )
        }
    }
}
