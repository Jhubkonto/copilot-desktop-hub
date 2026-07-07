package io.nexy.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.ui.components.NexyEmptyState
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyStatusBadge
import io.nexy.android.ui.components.NexyTopAppBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CliModelsScreen(onBack: () -> Unit) {
    val connectionState by WsRepository.connectionState.collectAsState()
    val cliStatus by WsRepository.cliStatus.collectAsState()
    val disconnected = connectionState != ConnectionState.CONNECTED

    LaunchedEffect(Unit) {
        WsRepository.getCliStatus()
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("CLI Models", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Configuration",
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                "CLI backends run on your desktop. Nexy checks which ones are installed so they can be selected as agent backends.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            if (disconnected) {
                NexyEmptyState(
                    title = "Not connected to desktop",
                    detail = "Connect to your desktop to see CLI model availability.",
                    modifier = Modifier.padding(vertical = 32.dp),
                )
            } else if (cliStatus.isEmpty()) {
                NexyEmptyState(
                    title = "Loading…",
                    modifier = Modifier.padding(vertical = 32.dp),
                )
            } else {
                val sorted = cliStatus.entries.sortedBy { it.key }
                sorted.forEach { (name, info) ->
                    CliModelRow(name = name, info = info)
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                NexySecondaryButton(
                    text = "Refresh",
                    onClick = { WsRepository.getCliStatus() },
                    enabled = !disconnected,
                    leadingIcon = Icons.Default.Refresh,
                )
            }
        }
    }
}

@Composable
internal fun CliModelRow(name: String, info: CliInstallInfo) {
    io.nexy.android.ui.components.NexyListRow(
        title = name,
        subtitleContent = {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                CliStatusBadge(installed = info.installed)
                val detail = listOfNotNull(info.version?.let { "v$it" }, info.path).joinToString(" · ")
                if (detail.isNotEmpty()) {
                    Text(
                        detail,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
    )
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun CliStatusBadge(installed: Boolean) {
    val (label, containerColor, contentColor) = if (installed) {
        Triple(
            "Installed",
            MaterialTheme.colorScheme.primary.copy(alpha = 0.15f),
            MaterialTheme.colorScheme.primary,
        )
    } else {
        Triple(
            "Not found",
            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.15f),
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    NexyStatusBadge(label = label, containerColor = containerColor, contentColor = contentColor)
}
