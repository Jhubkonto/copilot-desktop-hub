package io.nexy.android.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.nexy.android.data.local.LocalBackupManager
import io.nexy.android.ui.components.NexyDangerButton
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexySecondaryButton
import io.nexy.android.ui.components.NexyTopAppBar
import java.time.LocalDate
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackupRecoveryScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val manager = remember(context) { LocalBackupManager(context) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var passphrase by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream"),
    ) { uri ->
        if (uri != null) scope.launch {
            busy = true
            runCatching { manager.exportTo(uri, passphrase.toCharArray()) }
                .onSuccess { snackbar.showSnackbar("Encrypted backup created.") }
                .onFailure { snackbar.showSnackbar(it.message ?: "Backup failed.") }
            busy = false
        }
    }
    val restoreLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) scope.launch {
            busy = true
            runCatching { manager.restoreFrom(uri, passphrase.toCharArray()) }
                .onSuccess { snackbar.showSnackbar("Backup restored. Cached screens will refresh automatically.") }
                .onFailure { snackbar.showSnackbar(it.message ?: "Restore failed.") }
            busy = false
        }
    }
    val rawRecoveryLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream"),
    ) { uri ->
        if (uri != null) scope.launch {
            busy = true
            runCatching { manager.exportRawRecoveryCopy(uri, passphrase.toCharArray()) }
                .onSuccess { snackbar.showSnackbar("Encrypted raw recovery copy created.") }
                .onFailure { snackbar.showSnackbar(it.message ?: "Recovery export failed.") }
            busy = false
        }
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Backup and recovery", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings",
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "Included: conversations, reusable content, drafts, attachment files, and pending sync state.\n\nExcluded: API keys, pairing secrets, and other device-specific secrets.\n\nBackup files are encrypted with your passphrase and stored using your system's file picker (you choose the location).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = passphrase,
                onValueChange = { passphrase = it },
                label = { Text("Backup passphrase") },
                supportingText = { Text("At least 8 characters. Nexy cannot recover a forgotten passphrase.") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            NexyPrimaryButton(
                text = if (busy) "Working…" else "Create encrypted backup",
                enabled = !busy && passphrase.length >= 8,
                onClick = { exportLauncher.launch("nexy-standalone-${LocalDate.now()}.nexybackup") },
                modifier = Modifier.fillMaxWidth(),
            )
            NexySecondaryButton(
                text = if (busy) "Working…" else "Check local database integrity",
                enabled = !busy,
                onClick = {
                    scope.launch {
                        busy = true
                        runCatching { manager.integrityStatus() }
                            .onSuccess { snackbar.showSnackbar("Local database integrity check passed.") }
                            .onFailure { snackbar.showSnackbar(it.message ?: "Integrity check failed.") }
                        busy = false
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )
            NexyDangerButton(
                text = if (busy) "Working…" else "Restore encrypted backup",
                enabled = !busy && passphrase.length >= 8,
                onClick = { restoreLauncher.launch(arrayOf("application/octet-stream", "*/*")) },
                modifier = Modifier.fillMaxWidth(),
            )
            NexySecondaryButton(
                text = if (busy) "Working…" else "Export raw recovery copy",
                enabled = !busy && passphrase.length >= 8,
                onClick = {
                    rawRecoveryLauncher.launch("nexy-raw-recovery-${LocalDate.now()}.nexybackup")
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "Restore replaces the current local standalone database. Create a fresh backup first if you may need to recover the current state.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}
