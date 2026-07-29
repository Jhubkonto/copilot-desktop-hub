package io.nexy.android.ui.pairing

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairingStartScreen(
    onScanQr: () -> Unit,
    onManualEntry: () -> Unit,
    onConnected: () -> Unit,
    vm: PairingViewModel = viewModel(),
) {
    val connectionState by vm.connectionState.collectAsStateWithLifecycle()
    val profiles by vm.profiles.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()

    LaunchedEffect(connectionState) {
        if (connectionState == ConnectionState.CONNECTED) onConnected()
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Connect to Nexy Desktop", style = MaterialTheme.typography.titleMedium) },
                showConnectionStatus = false,
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "Connect to Nexy Desktop",
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    "1. Open Nexy on your computer\n2. Go to Settings → Mobile tab\n3. Scan the QR code shown there",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Button(
                onClick = onScanQr,
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.small,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            ) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                Text("Scan QR code", modifier = Modifier.padding(start = 8.dp))
            }

            OutlinedButton(
                onClick = onManualEntry,
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.small,
            ) {
                Icon(Icons.Default.Link, contentDescription = null)
                Text("Enter URL manually", modifier = Modifier.padding(start = 8.dp))
            }

            if (profiles.isNotEmpty()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Text(
                    "Saved servers",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                profiles.forEach { profile ->
                    Surface(
                        color = MaterialTheme.colorScheme.surface,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                            ) {
                                Text(
                                    profile.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    profile.endpoint,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            OutlinedButton(
                                onClick = { vm.connectProfile(profile.id) },
                                shape = MaterialTheme.shapes.small,
                            ) {
                                Text("Connect")
                            }
                            IconButton(onClick = { vm.deleteProfile(profile.id) }) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = "Remove server",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            if (connectionState == ConnectionState.CONNECTING) {
                Text(
                    "Connecting...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            error?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
