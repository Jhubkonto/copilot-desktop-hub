package io.nexy.android.ui.settings

import android.app.Application
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.data.PairedServerProfile
import io.nexy.android.data.PreferenceStore
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.ui.theme.ThemePreference
import io.nexy.android.ui.theme.ThemePreferenceStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient

data class UpdateInstallState(
    val installing: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class SettingsViewModel(app: Application) : AndroidViewModel(app) {

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState
    val preferStandaloneMode: StateFlow<Boolean> = WsRepository.preferStandaloneMode
    val effectiveMode: StateFlow<EffectiveConnectionMode> = WsRepository.effectiveMode
    val profiles: StateFlow<List<PairedServerProfile>> = WsRepository.profiles
    val activeProfileId: StateFlow<String?> = WsRepository.activeProfileId
    val models: StateFlow<List<ModelOption>> = WsRepository.models
    val modelSource: StateFlow<ModelListSource?> = WsRepository.modelSource
    val lastError: StateFlow<String?> = WsRepository.lastError
    val serverVersion: StateFlow<String?> = WsRepository.serverVersion
    val androidUpdateManifest: StateFlow<AndroidUpdateManifest?> = WsRepository.androidUpdateManifest
    val themePreference: StateFlow<ThemePreference> = ThemePreferenceStore.themePreference
    private val preferencesFlow: Flow<Boolean> = PreferenceStore.getInstance(app).getReadAloudEnabled()
    val readAloudEnabled: StateFlow<Boolean> = preferencesFlow.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Lazily, false)
    private val _notificationDiagnostics = MutableStateFlow(readNotificationDiagnostics(app))
    val notificationDiagnostics: StateFlow<NotificationDiagnostics> = _notificationDiagnostics
    private val _updateInstallState = MutableStateFlow(UpdateInstallState())
    val updateInstallState: StateFlow<UpdateInstallState> = _updateInstallState
    private val updateHttpClient = OkHttpClient()

    val savedEndpoint: String?
        get() = WsRepository.pairedServer()?.endpoint

    val clientVersion: String
        get() {
            val app = getApplication<Application>()
            return runCatching {
                app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "Unknown"
            }.getOrElse { "Unknown" }
        }

    val clientVersionCode: Long
        get() {
            val app = getApplication<Application>()
            return runCatching {
                val info = app.packageManager.getPackageInfo(app.packageName, 0)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else {
                    @Suppress("DEPRECATION")
                    info.versionCode.toLong()
                }
            }.getOrElse { 0L }
        }

    fun refreshNotificationDiagnostics() {
        _notificationDiagnostics.value = readNotificationDiagnostics(getApplication())
    }

    fun openNotificationSettings() {
        val app = getApplication<Application>()
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, app.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        app.startActivity(intent)
    }

    fun refreshModels() {
        WsRepository.send("model:list", emptyMap())
    }

    fun refreshUpdateManifest() {
        WsRepository.send("android:update-manifest", emptyMap())
    }

    fun installUpdate(manifest: AndroidUpdateManifest) {
        if (!canInstallUpdate(manifest, clientVersionCode) || _updateInstallState.value.installing) return
        val app: Application = getApplication()
        viewModelScope.launch {
            _updateInstallState.value = UpdateInstallState(installing = true, message = "Downloading update...")
            runCatching {
                withContext(Dispatchers.IO) {
                    val apk = downloadUpdateApk(app, updateHttpClient, manifest)
                    verifyChecksum(apk, manifest.checksum)
                    apk
                }
            }.onSuccess { apk ->
                _updateInstallState.value = UpdateInstallState(message = "Opening Android installer...")
                openPackageInstaller(app, apk) { msg ->
                    _updateInstallState.value = UpdateInstallState(message = msg)
                }
            }.onFailure { error ->
                _updateInstallState.value = UpdateInstallState(
                    error = error.message ?: "Unable to install update",
                )
            }
        }
    }

    fun setThemePreference(preference: ThemePreference) {
        ThemePreferenceStore.setThemePreference(preference)
    }

    fun switchProfile(profileId: String) {
        WsRepository.switchProfile(profileId)
    }

    fun setPreferStandaloneMode(prefer: Boolean) {
        WsRepository.setPreferStandaloneMode(prefer, getApplication())
    }

    fun setReadAloudEnabled(enabled: Boolean) {
        PreferenceStore.getInstance(getApplication()).setReadAloudEnabled(enabled)
    }

    fun disconnect() {
        WsRepository.disconnect()
    }

    fun forgetServer(): Boolean {
        WsRepository.forgetServer()
        return WsRepository.hasPairedServer()
    }

    fun forgetProfile(profileId: String): Boolean {
        WsRepository.forgetProfile(profileId)
        return WsRepository.hasPairedServer()
    }

    val activeProfileHasWolInfo: Boolean
        get() {
            val profile = WsRepository.profiles.value.firstOrNull { it.id == WsRepository.activeProfileId.value }
                ?: WsRepository.profiles.value.firstOrNull()
            return profile?.macAddress != null && profile.broadcastAddress != null
        }

    private val _wolSnackbar = MutableStateFlow<String?>(null)
    val wolSnackbar: StateFlow<String?> = _wolSnackbar

    fun wakeDesktop() {
        _wolSnackbar.value = "Magic packet sent — waiting for desktop…"
        WsRepository.wakeDesktop()
    }

    fun clearWolSnackbar() {
        _wolSnackbar.value = null
    }

}
