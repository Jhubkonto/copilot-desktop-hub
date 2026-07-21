package io.nexy.android.ui.settings

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.BuildRecord
import io.nexy.android.data.model.PreflightCheck
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyTopAppBar
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BuildDashboardScreen(onBack: () -> Unit) {
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val buildRecords by WsRepository.buildRecords.collectAsStateWithLifecycle()
    val desktopIsPackaged by WsRepository.desktopIsPackaged.collectAsStateWithLifecycle()
    val disconnected = connectionState != ConnectionState.CONNECTED

    // Top-level tab split: 0 = Desktop, 1 = Android. Keeps the two build
    // pipelines visually separate instead of one long interleaved list.
    var selectedTab by remember { mutableStateOf(0) }
    var desktopRecordFilter by remember { mutableStateOf("") }
    var androidRecordFilter by remember { mutableStateOf("") }

    var desktopRecords by remember { mutableStateOf<List<BuildRecord>>(emptyList()) }
    var androidRecords by remember { mutableStateOf<List<BuildRecord>>(emptyList()) }
    var preflightChecks by remember { mutableStateOf<List<PreflightCheck>?>(null) }
    var signingChecks by remember { mutableStateOf<List<PreflightCheck>?>(null) }
    var isRunningPreflight by remember { mutableStateOf(false) }
    var isValidatingSigning by remember { mutableStateOf(false) }
    var isPublishing by remember { mutableStateOf(false) }
    var publishResult by remember { mutableStateOf<String?>(null) }
    var confirmAction by remember { mutableStateOf<(() -> Unit)?>(null) }
    var confirmTitle by remember { mutableStateOf("") }
    var confirmMessage by remember { mutableStateOf("") }

    // Desktop build trigger state
    val buildCommands = listOf("typecheck", "test", "build", "package")
    var selectedBuildCommand by remember { mutableStateOf("typecheck") }
    var commandMenuExpanded by remember { mutableStateOf(false) }

    // Android workspace + release-build trigger state
    var androidWorkspaceInfo by remember { mutableStateOf<WsEvent.AndroidWorkspaceInfo?>(null) }
    var workspacePathDraft by remember { mutableStateOf<String?>(null) }
    val androidBuildCommands = listOf("assembleRelease", "bundleRelease")
    var selectedAndroidBuildCommand by remember { mutableStateOf("assembleRelease") }
    var androidCommandMenuExpanded by remember { mutableStateOf(false) }
    // Tracks whether the in-flight build (shared build log/status) is an Android
    // build, so Cancel routes to the right registry.
    var activeBuildIsAndroid by remember { mutableStateOf(false) }

    var activeBuildId by remember { mutableStateOf<String?>(null) }
    var buildStatus by remember { mutableStateOf<String?>(null) }
    val buildLogLines = remember { mutableStateListOf<String>() }
    val logListState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()

    // Phase 2: desktop self-update state
    var updateRestartingEvent by remember { mutableStateOf<WsEvent.UpdateRestarting?>(null) }

    // One-tap desktop update flow (package → publish → silent install → restart)
    var updateFlowActive by remember { mutableStateOf(false) }
    var updateFlowDone by remember { mutableStateOf(false) }
    var lastBuildError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        WsRepository.getBuildRecords(platform = null)
        WsRepository.getBuildWorkspaceInfo()
        WsRepository.getAndroidWorkspaceInfo()
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is WsEvent.BuildRecords -> {
                    desktopRecords = event.records.filter { it.platform != "android" }
                    androidRecords = event.records.filter { it.platform == "android" }
                }
                is WsEvent.BuildPreflightResult -> {
                    isRunningPreflight = false
                    preflightChecks = event.checks
                }
                is WsEvent.AndroidWorkspaceInfo -> {
                    androidWorkspaceInfo = event
                    // Reset the edit draft to the server value unless the user is
                    // mid-edit with an unsaved change.
                    if (workspacePathDraft == null || workspacePathDraft == event.path) workspacePathDraft = null
                }
                is WsEvent.AndroidSigningValidation -> {
                    isValidatingSigning = false
                    signingChecks = event.checks
                }
                is WsEvent.AndroidPublishResult -> {
                    isPublishing = false
                    publishResult = if (event.published) "Published v${event.manifest?.versionName} (${event.manifest?.versionCode})" else "Publish failed: ${event.error}"
                }
                is WsEvent.AndroidRestoreResult -> {
                    isPublishing = false
                    publishResult = if (event.restored) "Restored v${event.manifest?.versionName}" else "Restore failed: ${event.error}"
                }
                is WsEvent.BuildStarted -> {
                    if (event.buildId.isNotEmpty()) {
                        activeBuildId = event.buildId
                        buildStatus = "running"
                        lastBuildError = null
                        buildLogLines.clear()
                    }
                }
                is WsEvent.BuildLogChunk -> {
                    // build:started and the first log chunks race over the socket; if a
                    // chunk arrives first, adopt its buildId so streamed output isn't
                    // dropped while activeBuildId is still null.
                    if (activeBuildId == null && buildStatus == "running") activeBuildId = event.buildId
                    if (event.buildId == activeBuildId) {
                        if (event.replace && buildLogLines.isNotEmpty()) {
                            buildLogLines[buildLogLines.lastIndex] = event.line
                        } else {
                            buildLogLines.add(event.line)
                        }
                        coroutineScope.launch {
                            logListState.animateScrollToItem(maxOf(0, buildLogLines.size - 1))
                        }
                    }
                }
                is WsEvent.BuildCommandDone -> {
                    if (event.buildId == activeBuildId || activeBuildId == null) {
                        buildStatus = event.status
                        lastBuildError = event.error
                        if (event.status != "running") activeBuildId = null
                        if (event.status != "running" && event.status != "success") updateFlowActive = false
                    }
                }
                is WsEvent.UpdateRestarting -> {
                    updateRestartingEvent = event
                    if (event.error != null) updateFlowActive = false
                }
                is WsEvent.Connected -> {
                    // Desktop came back — clear the banner once reconnected
                    updateRestartingEvent = null
                    if (updateFlowActive) {
                        updateFlowActive = false
                        updateFlowDone = true
                    }
                }
                else -> {}
            }
        }
    }

    val dt = confirmAction
    if (dt != null) {
        NexyConfirmDialog(
            title = confirmTitle,
            message = confirmMessage,
            confirmLabel = "Proceed",
            destructive = false,
            onConfirm = { dt(); confirmAction = null },
            onDismiss = { confirmAction = null },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Build Dashboard", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                subtitle = "Settings › Developer",
                actions = {
                    IconButton(onClick = { WsRepository.getBuildRecords() }, enabled = !disconnected) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                },
            )
        },
    ) { padding ->
        if (disconnected) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (updateFlowActive) {
                    CircularProgressIndicator(strokeWidth = 3.dp)
                    Spacer(Modifier.height(16.dp))
                    Text(
                        "Desktop is installing the update and restarting…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "This screen reconnects automatically when it's back.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text("Not connected to desktop.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            return@Scaffold
        }

        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            PrimaryTabRow(selectedTabIndex = selectedTab) {
                listOf("Desktop", "Android").forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title, style = MaterialTheme.typography.labelLarge) },
                    )
                }
            }

            LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                if (selectedTab == 0) {
                    // ── DESKTOP ──────────────────────────────────────────────
                    item {
                        Spacer(Modifier.height(16.dp))
                        SectionCard("One-tap desktop update") {
                            Text(
                                "Everything runs on the desktop you're connected to — no path needed here. It rebuilds Nexy Desktop from the source folder configured on that machine, publishes the new installer to the update feed, then silently installs it and restarts. Takes a few minutes; the desktop briefly disconnects and this screen reconnects on its own.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            if (desktopIsPackaged == false) {
                                Text(
                                    "Desktop is running from a dev checkout — one-tap updates need the installed Nexy Desktop app.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                            Button(
                                onClick = {
                                    confirmTitle = "Update the desktop app?"
                                    confirmMessage = "This packages a fresh desktop build, publishes it, and restarts the desktop into the new version. The desktop briefly disconnects while it restarts."
                                    confirmAction = {
                                        updateFlowActive = true
                                        updateFlowDone = false
                                        updateRestartingEvent = null
                                        buildLogLines.clear()
                                        buildStatus = "running"
                                        selectedBuildCommand = "package"
                                        activeBuildIsAndroid = false
                                        WsRepository.startDesktopBuild("package")
                                    }
                                },
                                enabled = buildStatus != "running" && desktopIsPackaged != false,
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text("Build & install desktop update") }

                            if (updateFlowActive) {
                                val stage = when {
                                    buildStatus == "running" -> "Step 1 of 3 — packaging the installer on desktop…"
                                    buildStatus == "success" && updateRestartingEvent == null -> "Step 2 of 3 — publishing to the update feed…"
                                    updateRestartingEvent?.error == null -> "Step 3 of 3 — installing and restarting the desktop…"
                                    else -> null
                                }
                                stage?.let {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.padding(end = 2.dp))
                                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary)
                                    }
                                }
                            }
                            if (updateFlowDone) {
                                Text(
                                    "✓ Desktop updated and back online.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                            updateRestartingEvent?.error?.let { err ->
                                Text("Update failed: $err", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                            }
                            lastBuildError?.let { err ->
                                Text(err, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                    }

                    item {
                        SectionCard("Build preflight") {
                            Text(
                                "Runs quick pre-build checks on the connected desktop (git state, dependencies, toolchain) so you can catch problems before starting a full build.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            OutlinedButton(
                                onClick = {
                                    isRunningPreflight = true
                                    preflightChecks = null
                                    WsRepository.runBuildPreflight()
                                },
                                enabled = !isRunningPreflight,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                if (isRunningPreflight) CircularProgressIndicator(modifier = Modifier.padding(end = 6.dp), strokeWidth = 2.dp)
                                Text("Run preflight")
                            }
                            preflightChecks?.let { checks -> CheckList(checks) }
                        }
                        Spacer(Modifier.height(16.dp))
                    }

                    item {
                        SectionCard("Trigger a build") {
                            Text(
                                "Runs a single build command on the connected desktop and streams its log below. \"package\" produces the installer that One-tap desktop update uses.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            val isBuilding = buildStatus == "running"
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(modifier = Modifier.weight(1f)) {
                                    OutlinedButton(
                                        onClick = { commandMenuExpanded = true },
                                        enabled = !isBuilding,
                                        modifier = Modifier.fillMaxWidth(),
                                    ) { Text(selectedBuildCommand) }
                                    DropdownMenu(
                                        expanded = commandMenuExpanded,
                                        onDismissRequest = { commandMenuExpanded = false },
                                    ) {
                                        buildCommands.forEach { cmd ->
                                            DropdownMenuItem(
                                                text = { Text(cmd) },
                                                onClick = { selectedBuildCommand = cmd; commandMenuExpanded = false },
                                            )
                                        }
                                    }
                                }
                                if (isBuilding) {
                                    Button(
                                        onClick = { activeBuildId?.let { if (activeBuildIsAndroid) WsRepository.cancelAndroidBuild(it) else WsRepository.cancelDesktopBuild(it) } },
                                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                                        modifier = Modifier.weight(1f),
                                    ) { Text("Cancel") }
                                } else {
                                    Button(
                                        onClick = {
                                            buildLogLines.clear()
                                            buildStatus = "running"
                                            activeBuildIsAndroid = false
                                            WsRepository.startDesktopBuild(selectedBuildCommand)
                                        },
                                        modifier = Modifier.weight(1f),
                                    ) { Text("Start") }
                                }
                            }
                            // Only show the shared log stream here when a desktop build owns it.
                            if (!activeBuildIsAndroid) BuildLogPanel(buildStatus, buildLogLines, logListState)
                            updateRestartingEvent?.let { evt ->
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(MaterialTheme.colorScheme.tertiaryContainer)
                                        .padding(12.dp),
                                ) {
                                    Column {
                                        val vLabel = evt.version?.let { "v$it " } ?: ""
                                        Text(
                                            "Desktop is installing ${vLabel}and restarting — reconnecting automatically…",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                                        )
                                        if (evt.error != null) {
                                            Spacer(Modifier.height(4.dp))
                                            Text("Error: ${evt.error}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                                        }
                                    }
                                }
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                    }

                    item {
                        SectionHeader("Build records (${desktopRecords.size})")
                        Spacer(Modifier.height(8.dp))
                        BuildRecordsPanel(
                            records = desktopRecords,
                            filter = desktopRecordFilter,
                            onFilterChange = { desktopRecordFilter = it },
                            emptyText = "No desktop build records.",
                        ) { record ->
                            val canApplyUpdate = record.status == "success" && record.command == "package"
                            BuildRecordRow(
                                record = record,
                                showApplyUpdate = canApplyUpdate,
                                onApplyUpdate = if (canApplyUpdate) {
                                    {
                                        confirmTitle = "Apply desktop update?"
                                        confirmMessage = "This publishes the packaged installer to the local feed and restarts the desktop app."
                                        confirmAction = { WsRepository.startUpdateFromArtifact() }
                                    }
                                } else null,
                            )
                        }
                        Spacer(Modifier.height(24.dp))
                    }
                } else {
                    // ── ANDROID ──────────────────────────────────────────────
                    item {
                        Spacer(Modifier.height(16.dp))
                        SectionCard("Workspace") {
                            val info = androidWorkspaceInfo
                            val pathValue = workspacePathDraft ?: info?.path ?: ""
                            OutlinedTextField(
                                value = pathValue,
                                onValueChange = { workspacePathDraft = it },
                                label = { Text("Workspace path (android/ project folder)") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            if (info != null) {
                                val meta = listOfNotNull(
                                    info.versionName?.let { "v$it" },
                                    info.versionCode?.let { "vc$it" },
                                    info.branch?.let { "branch: $it" },
                                ).joinToString("  ·  ")
                                if (meta.isNotBlank()) {
                                    Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (!info.hasGradleProject) {
                                    Text(
                                        if (info.path.isBlank()) "No workspace path set — point this at your android/ project folder, then Save."
                                        else "No Gradle wrapper found here — this doesn't look like the android/ project folder.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = { workspacePathDraft?.trim()?.let { WsRepository.setAndroidWorkspacePath(it) } },
                                    enabled = workspacePathDraft != null && workspacePathDraft != (info?.path ?: ""),
                                ) { Text("Save path") }
                                OutlinedButton(onClick = { WsRepository.getAndroidWorkspaceInfo() }) { Text("Refresh") }
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                    }

                    item {
                        SectionCard("Build APK") {
                            // Build the release APK — the first half of the publish flow.
                            val isBuildingAndroid = buildStatus == "running" && activeBuildIsAndroid
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(modifier = Modifier.weight(1f)) {
                                    OutlinedButton(
                                        onClick = { androidCommandMenuExpanded = true },
                                        enabled = buildStatus != "running",
                                        modifier = Modifier.fillMaxWidth(),
                                    ) { Text(selectedAndroidBuildCommand) }
                                    DropdownMenu(
                                        expanded = androidCommandMenuExpanded,
                                        onDismissRequest = { androidCommandMenuExpanded = false },
                                    ) {
                                        androidBuildCommands.forEach { cmd ->
                                            DropdownMenuItem(
                                                text = { Text(cmd) },
                                                onClick = { selectedAndroidBuildCommand = cmd; androidCommandMenuExpanded = false },
                                            )
                                        }
                                    }
                                }
                                if (isBuildingAndroid) {
                                    Button(
                                        onClick = { activeBuildId?.let { WsRepository.cancelAndroidBuild(it) } },
                                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                                        modifier = Modifier.weight(1f),
                                    ) { Text("Cancel") }
                                } else {
                                    Button(
                                        onClick = {
                                            buildLogLines.clear()
                                            buildStatus = "running"
                                            activeBuildIsAndroid = true
                                            WsRepository.startAndroidBuild(selectedAndroidBuildCommand)
                                        },
                                        enabled = buildStatus != "running",
                                        modifier = Modifier.weight(1f),
                                    ) { Text("Build APK") }
                                }
                            }
                            // Only show the shared log stream here when an Android build owns it.
                            if (activeBuildIsAndroid) BuildLogPanel(buildStatus, buildLogLines, logListState)
                        }
                        Spacer(Modifier.height(16.dp))
                    }

                    item {
                        SectionCard("Sign & publish") {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(
                                    onClick = {
                                        isValidatingSigning = true
                                        signingChecks = null
                                        WsRepository.validateAndroidSigning()
                                    },
                                    enabled = !isValidatingSigning,
                                    modifier = Modifier.weight(1f),
                                ) {
                                    if (isValidatingSigning) CircularProgressIndicator(modifier = Modifier.padding(end = 6.dp), strokeWidth = 2.dp)
                                    Text("Validate signing")
                                }
                                Button(
                                    onClick = {
                                        confirmTitle = "Publish Android update?"
                                        confirmMessage = "This copies the latest release APK from your workspace to the local update feed and restarts the feed server."
                                        confirmAction = {
                                            isPublishing = true
                                            publishResult = null
                                            WsRepository.publishAndroidUpdate()
                                        }
                                    },
                                    enabled = !isPublishing && buildStatus != "running",
                                    modifier = Modifier.weight(1f),
                                ) {
                                    if (isPublishing) CircularProgressIndicator(modifier = Modifier.padding(end = 6.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                                    Text("Publish APK")
                                }
                            }
                            signingChecks?.let { checks -> CheckList(checks) }
                            publishResult?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = if (it.startsWith("Published") || it.startsWith("Restored")) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                    }

                    item {
                        SectionHeader("Build records (${androidRecords.size})")
                        Spacer(Modifier.height(8.dp))
                        BuildRecordsPanel(
                            records = androidRecords,
                            filter = androidRecordFilter,
                            onFilterChange = { androidRecordFilter = it },
                            emptyText = "No Android build records.",
                        ) { record ->
                            BuildRecordRow(
                                record = record,
                                showRestore = record.status == "success" && record.command.contains("Release", ignoreCase = true),
                                onRestore = {
                                    confirmTitle = "Restore this build?"
                                    confirmMessage = "This will restore the archived APK for v${record.version ?: record.versionCode} to the update feed."
                                    confirmAction = {
                                        isPublishing = true
                                        publishResult = null
                                        WsRepository.restoreAndroidVersion(record.versionCode ?: 0)
                                    }
                                },
                            )
                        }
                        Spacer(Modifier.height(24.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/** A titled, bordered card that groups one section's controls for clear visual separation. */
@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    Spacer(Modifier.height(6.dp))
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content,
        )
    }
}

/** Shared build status line + scrolling log output, reused by the desktop and Android build triggers. */
@Composable
private fun BuildLogPanel(buildStatus: String?, buildLogLines: List<String>, logListState: LazyListState) {
    val isRunning = buildStatus == "running"
    buildStatus?.let { status ->
        val statusColor = when (status) {
            "running" -> MaterialTheme.colorScheme.tertiary
            "success" -> MaterialTheme.colorScheme.primary
            else -> MaterialTheme.colorScheme.error
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (isRunning) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
            Text(status.uppercase(), style = MaterialTheme.typography.labelSmall, color = statusColor)
        }
    }
    // Mirror desktop's "Output" terminal window: show the log frame the whole time a
    // build is running — even before the first line streams in — so the user sees the
    // live command output instead of just a spinner. Commands like typecheck emit
    // nothing until they finish, so hiding the frame until then looked like nothing
    // was happening.
    if (isRunning || buildLogLines.isNotEmpty()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.surface),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Output", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${buildLogLines.size} lines", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Box(modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp, max = 200.dp).padding(8.dp)) {
                if (buildLogLines.isEmpty()) {
                    Text(
                        "No output yet…",
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 10.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    LazyColumn(state = logListState) {
                        items(buildLogLines) { line ->
                            Text(
                                text = line,
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 10.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CheckList(checks: List<PreflightCheck>) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        checks.forEach { check ->
            val color = when (check.status) {
                "ok" -> MaterialTheme.colorScheme.primary
                "fail" -> MaterialTheme.colorScheme.error
                else -> MaterialTheme.colorScheme.tertiary
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(check.label, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                Text(check.status.uppercase(), style = MaterialTheme.typography.labelSmall, color = color)
            }
            if (check.detail.isNotBlank()) {
                Text(check.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * A titled, self-contained card holding a text filter and a fixed-height,
 * independently scrollable list of build records. Rows are rendered by the
 * caller so each platform can supply its own row actions.
 */
@Composable
private fun BuildRecordsPanel(
    records: List<BuildRecord>,
    filter: String,
    onFilterChange: (String) -> Unit,
    emptyText: String,
    rowContent: @Composable (BuildRecord) -> Unit,
) {
    val filtered = remember(records, filter) {
        if (filter.isBlank()) records
        else records.filter { record ->
            listOfNotNull(
                record.command,
                record.status,
                record.branch,
                record.version,
                record.versionCode?.toString(),
            ).any { it.contains(filter, ignoreCase = true) }
        }
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
            OutlinedTextField(
                value = filter,
                onValueChange = onFilterChange,
                label = { Text("Filter records") },
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            when {
                records.isEmpty() -> Text(emptyText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                filtered.isEmpty() -> Text("No records match \"$filter\".", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 300.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surface),
                ) {
                    LazyColumn {
                        itemsIndexed(filtered) { index, record ->
                            rowContent(record)
                            if (index < filtered.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
            }
        }
    }
}

/** A single build-record row rendered at a fixed height so every row lines up uniformly. */
@Composable
private fun BuildRecordRow(
    record: BuildRecord,
    showRestore: Boolean = false,
    onRestore: (() -> Unit)? = null,
    showApplyUpdate: Boolean = false,
    onApplyUpdate: (() -> Unit)? = null,
) {
    val statusColor = when (record.status) {
        "success" -> MaterialTheme.colorScheme.primary
        "failed" -> MaterialTheme.colorScheme.error
        "running" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val fmt = SimpleDateFormat("MM/dd HH:mm", Locale.getDefault())
    val startStr = fmt.format(Date(record.startedAt))
    val meta = listOfNotNull(
        record.branch?.let { "branch: $it" },
        record.version?.let { "v$it" } ?: record.versionCode?.let { "vc$it" },
        startStr,
        record.exitCode?.takeIf { record.status != "success" }?.let { "exit $it" },
    ).joinToString("  ·  ")

    Row(
        modifier = Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    record.command,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Text(record.status.uppercase(), style = MaterialTheme.typography.labelSmall, color = statusColor)
            }
            if (meta.isNotBlank()) {
                Text(
                    meta,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (showRestore && onRestore != null) {
            TextButton(onClick = onRestore) { Text("Restore", style = MaterialTheme.typography.labelSmall) }
        }
        if (showApplyUpdate && onApplyUpdate != null) {
            TextButton(onClick = onApplyUpdate) { Text("Apply", style = MaterialTheme.typography.labelSmall) }
        }
    }
}
