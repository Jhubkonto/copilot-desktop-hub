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
fun AppearanceScreen(
    onBack: () -> Unit,
    vm: SettingsViewModel = viewModel(),
) {
    val themePreference by vm.themePreference.collectAsState()

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Appearance", style = MaterialTheme.typography.titleMedium) },
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
            AppearanceSection(
                themePreference = themePreference,
                onSetTheme = { vm.setThemePreference(it) },
            )
        }
    }
}
