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
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelsScreen(
    onBack: () -> Unit,
    vm: SettingsViewModel = viewModel(),
) {
    val models by vm.models.collectAsStateWithLifecycle()
    val modelSource by vm.modelSource.collectAsStateWithLifecycle()
    val effectiveMode by vm.effectiveMode.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.refreshModels() }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Models", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
    ) { padding ->
        Column(
            modifier = androidx.compose.ui.Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            ModelsSection(
                models = models,
                modelSource = modelSource,
                effectiveMode = effectiveMode,
            )
        }
    }
}
