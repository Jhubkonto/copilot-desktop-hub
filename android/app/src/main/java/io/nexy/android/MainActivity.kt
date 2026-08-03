package io.nexy.android

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.navigation.AppShell
import io.nexy.android.ui.theme.NexyTheme
import io.nexy.android.ui.theme.ThemePreference
import io.nexy.android.ui.theme.ThemePreferenceStore
import io.nexy.android.ui.theme.UiStylePreference
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    // Shared deeplink signal so onNewIntent can push to the running NavGraph
    private val pendingDeeplink = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        io.nexy.android.notification.ActivityBadgeManager.markIntentSeen(this, intent)
        pendingDeeplink.value = intent?.getStringExtra("deeplink")
        enableEdgeToEdge()
        setContent {
            val themePreference by ThemePreferenceStore.themePreference.collectAsStateWithLifecycle()
            val uiStylePreference by ThemePreferenceStore.uiStylePreference.collectAsStateWithLifecycle()
            val systemDark = isSystemInDarkTheme()
            val darkTheme = when (themePreference) {
                ThemePreference.System -> systemDark
                ThemePreference.Light -> false
                ThemePreference.Dark -> true
            }
            NexyTheme(
                darkTheme = darkTheme,
                eightBit = uiStylePreference == UiStylePreference.EightBit,
            ) {
                AppShell(
                    onRequestNotificationPermission = ::requestNotificationPermissionIfNeeded,
                    pendingDeeplink = pendingDeeplink,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        io.nexy.android.notification.ActivityBadgeManager.markIntentSeen(this, intent)
        val deeplink = intent.getStringExtra("deeplink")
        if (deeplink != null) {
            pendingDeeplink.value = deeplink
        }
    }

    override fun onResume() {
        super.onResume()
        io.nexy.android.ui.settings.UpdateInstallVerification.verifyPendingInstall(this)
        val state = WsRepository.connectionState.value
        if (state != ConnectionState.CONNECTED && state != ConnectionState.CONNECTING) {
            WsRepository.connectFromStore()
        }
    }

    fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) return
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
