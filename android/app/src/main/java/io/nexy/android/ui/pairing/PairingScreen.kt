package io.nexy.android.ui.pairing

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import io.nexy.android.ui.components.NexyPrimaryButton
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import io.nexy.android.ui.theme.NexySurfaceShape as RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.DiscoveredNexyService
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.theme.NexySpacing
import kotlin.math.min

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairingScreen(
    onConnected: () -> Unit,
    onBack: (() -> Unit)? = null,
    initialShowManual: Boolean = false,
    vm: PairingViewModel = viewModel(),
) {
    val connectionState by vm.connectionState.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val discoveredServices by vm.discoveredServices.collectAsStateWithLifecycle()
    var showManual by remember { mutableStateOf(initialShowManual) }
    var manualUrl by remember { mutableStateOf("") }
    var cameraRestartToken by remember { mutableStateOf(0) }
    val context = LocalContext.current
    var cameraPermissionGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> cameraPermissionGranted = granted }

    DisposableEffect(Unit) {
        vm.startMdnsDiscovery()
        onDispose { vm.stopMdnsDiscovery() }
    }

    LaunchedEffect(showManual, cameraPermissionGranted) {
        if (!showManual && !cameraPermissionGranted) {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    LaunchedEffect(connectionState) {
        if (connectionState == ConnectionState.CONNECTED) onConnected()
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Pair with Desktop", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                showConnectionStatus = false,
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = NexySpacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(NexySpacing.md),
        ) {
            if (!showManual) {
                if (cameraPermissionGranted) {
                    Text(
                        "Scan the QR code in Nexy Desktop → Settings → Mobile.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.fillMaxWidth(),
                    )

                    ScannerPreview(
                        restartToken = cameraRestartToken,
                        onBarcode = vm::connectFromQr,
                    )

                    TextButton(
                        onClick = { cameraRestartToken++ },
                        contentPadding = PaddingValues(horizontal = NexySpacing.sm, vertical = 0.dp),
                    ) {
                        NexyIcon(
                            name = NexyIconName.Refresh,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.primary,
                            contentDescription = null,
                        )
                        Text(
                            "Camera not responding? Restart",
                            modifier = Modifier.padding(start = NexySpacing.sm),
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                } else {
                    PermissionCard(
                        onGrant = { cameraPermissionLauncher.launch(Manifest.permission.CAMERA) },
                        onOpenSettings = {
                            val intent = Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.fromParts("package", context.packageName, null),
                            )
                            context.startActivity(intent)
                        },
                    )
                }

                TextButton(onClick = { showManual = true }) {
                    Text(
                        "Enter URL manually",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            } else {
                Text(
                    "Paste the WebSocket URL from the desktop app.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                )

                OutlinedTextField(
                    value = manualUrl,
                    onValueChange = { manualUrl = it },
                    label = { Text("WebSocket pairing URL") },
                    placeholder = { Text("wss://host/path?token=…") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium,
                    shape = MaterialTheme.shapes.small,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { vm.connectManual(manualUrl) }),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                    ),
                )

                NexyPrimaryButton(
                    text = "Connect",
                    onClick = { vm.connectManual(manualUrl) },
                    enabled = manualUrl.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                )

                TextButton(onClick = { showManual = false }) {
                    Text(
                        "Use QR scanner instead",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }

            if (discoveredServices.isNotEmpty()) {
                HorizontalDivider()
                Text(
                    "Found on network",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                )
                discoveredServices.forEach { service ->
                    OutlinedButton(
                        onClick = { vm.connectDiscovered(service) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.small,
                    ) {
                        Text("${service.host}:${service.port}")
                    }
                }
            }

            if (connectionState == ConnectionState.CONNECTING) {
                Spacer(Modifier.height(4.dp))
                NexyIcon(
                    name = NexyIconName.Busy,
                    modifier = Modifier.size(28.dp),
                    tint = MaterialTheme.colorScheme.primary,
                    contentDescription = "Connecting",
                )
                Text(
                    "Connecting…",
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

@Composable
private fun ScannerPreview(
    restartToken: Int,
    onBarcode: (String) -> Unit,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnBarcode by rememberUpdatedState(onBarcode)
    var barcodeView by remember(restartToken) { mutableStateOf<DecoratedBarcodeView?>(null) }
    val shape = RectangleShape

    DisposableEffect(lifecycleOwner, barcodeView) {
        val view = barcodeView ?: return@DisposableEffect onDispose { }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> view.resume()
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> view.pause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        if (lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            view.resume()
        }
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            view.pause()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.25f)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
    ) {
        key(restartToken) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    DecoratedBarcodeView(context).also { view ->
                        barcodeView = view
                        view.decodeContinuous(BarcodeCallback { result ->
                            result?.text?.let(currentOnBarcode)
                        })
                    }
                },
            )
        }
        ScannerGuideOverlay()
    }
}

@Composable
private fun ScannerGuideOverlay() {
    val accent = MaterialTheme.colorScheme.primary

    Box(modifier = Modifier.fillMaxSize()) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val frameSize = min(size.width, size.height) * 0.62f
            val left = (size.width - frameSize) / 2f
            val top = (size.height - frameSize) / 2f
            val corner = frameSize * 0.16f
            val stroke = 3.dp.toPx()

            drawRect(Color.Black.copy(alpha = 0.18f))
            drawRoundRect(
                color = Color.White.copy(alpha = 0.55f),
                topLeft = androidx.compose.ui.geometry.Offset(left, top),
                size = androidx.compose.ui.geometry.Size(frameSize, frameSize),
                style = Stroke(width = 1.dp.toPx()),
            )
            listOf(
                androidx.compose.ui.geometry.Offset(left, top) to androidx.compose.ui.geometry.Offset(left + corner, top),
                androidx.compose.ui.geometry.Offset(left, top) to androidx.compose.ui.geometry.Offset(left, top + corner),
                androidx.compose.ui.geometry.Offset(left + frameSize, top) to androidx.compose.ui.geometry.Offset(left + frameSize - corner, top),
                androidx.compose.ui.geometry.Offset(left + frameSize, top) to androidx.compose.ui.geometry.Offset(left + frameSize, top + corner),
                androidx.compose.ui.geometry.Offset(left, top + frameSize) to androidx.compose.ui.geometry.Offset(left + corner, top + frameSize),
                androidx.compose.ui.geometry.Offset(left, top + frameSize) to androidx.compose.ui.geometry.Offset(left, top + frameSize - corner),
                androidx.compose.ui.geometry.Offset(left + frameSize, top + frameSize) to androidx.compose.ui.geometry.Offset(left + frameSize - corner, top + frameSize),
                androidx.compose.ui.geometry.Offset(left + frameSize, top + frameSize) to androidx.compose.ui.geometry.Offset(left + frameSize, top + frameSize - corner),
            ).forEach { (start, end) ->
                drawLine(accent, start, end, strokeWidth = stroke, cap = StrokeCap.Square)
            }
            drawLine(
                color = accent.copy(alpha = 0.82f),
                start = androidx.compose.ui.geometry.Offset(left, top + frameSize * 0.5f),
                end = androidx.compose.ui.geometry.Offset(left + frameSize, top + frameSize * 0.5f),
                strokeWidth = 1.5.dp.toPx(),
            )
        }

        Surface(
            color = Color.Black.copy(alpha = 0.62f),
            shape = MaterialTheme.shapes.small,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(NexySpacing.md),
        ) {
            Text(
                "Align the QR code inside the frame",
                color = Color.White,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = NexySpacing.md, vertical = NexySpacing.sm),
            )
        }
    }
}

@Composable
private fun PermissionCard(
    onGrant: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RectangleShape,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(NexySpacing.lg),
            verticalArrangement = Arrangement.spacedBy(NexySpacing.sm),
        ) {
            Text(
                "Camera access is needed to scan",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "Allow camera access, then point your phone at the QR code shown in Nexy Desktop.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            NexyPrimaryButton(
                text = "Allow camera access",
                onClick = onGrant,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedButton(
                onClick = onOpenSettings,
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.small,
            ) {
                Text("Open Android settings")
            }
        }
    }
}
