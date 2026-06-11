package io.nexy.android.ui.settings

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.nexy.android.NexyApp
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.PairedServerProfile
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AndroidUpdateManifest
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import io.nexy.android.ui.theme.ThemePreference
import io.nexy.android.ui.theme.ThemePreferenceStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest

data class UpdateInstallState(
    val installing: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class SettingsViewModel(app: Application) : AndroidViewModel(app) {

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState
    val profiles: StateFlow<List<PairedServerProfile>> = WsRepository.profiles
    val activeProfileId: StateFlow<String?> = WsRepository.activeProfileId
    val models: StateFlow<List<ModelOption>> = WsRepository.models
    val modelSource: StateFlow<ModelListSource?> = WsRepository.modelSource
    val lastError: StateFlow<String?> = WsRepository.lastError
    val serverVersion: StateFlow<String?> = WsRepository.serverVersion
    val androidUpdateManifest: StateFlow<AndroidUpdateManifest?> = WsRepository.androidUpdateManifest
    val themePreference: StateFlow<ThemePreference> = ThemePreferenceStore.themePreference
    private val _notificationDiagnostics = MutableStateFlow(readNotificationDiagnostics())
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
        _notificationDiagnostics.value = readNotificationDiagnostics()
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
        viewModelScope.launch {
            _updateInstallState.value = UpdateInstallState(installing = true, message = "Downloading update...")
            runCatching {
                withContext(Dispatchers.IO) {
                    val apk = downloadUpdateApk(manifest)
                    verifyChecksum(apk, manifest.checksum)
                    apk
                }
            }.onSuccess { apk ->
                _updateInstallState.value = UpdateInstallState(message = "Opening Android installer...")
                openPackageInstaller(apk)
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

    private fun downloadUpdateApk(manifest: AndroidUpdateManifest): File {
        val app = getApplication<Application>()
        val request = Request.Builder()
            .url(manifest.artifactUrl)
            .build()
        updateHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Download failed with HTTP ${response.code}")
            }
            val body = response.body ?: throw IllegalStateException("Update download was empty")
            val updateDir = File(app.cacheDir, "updates").also { it.mkdirs() }
            val apk = File(updateDir, "nexy-${manifest.versionCode}.apk")
            body.byteStream().use { input ->
                apk.outputStream().use { output -> input.copyTo(output) }
            }
            return apk
        }
    }

    private fun verifyChecksum(apk: File, expectedChecksum: String) {
        val normalizedExpected = expectedChecksum.trim().lowercase()
        if (normalizedExpected.isBlank()) throw IllegalStateException("Update checksum is missing")
        val digest = MessageDigest.getInstance("SHA-256")
        apk.inputStream().use { input ->
            val buffer = ByteArray(8 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != normalizedExpected) {
            apk.delete()
            throw IllegalStateException("Update checksum did not match")
        }
    }

    private fun openPackageInstaller(apk: File) {
        val app = getApplication<Application>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !app.packageManager.canRequestPackageInstalls()
        ) {
            _updateInstallState.value = UpdateInstallState(
                message = "Allow installs from Nexy, then tap Install update again.",
            )
            val settingsIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${app.packageName}"),
            )
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            app.startActivity(settingsIntent)
            return
        }
        val uri: Uri = FileProvider.getUriForFile(app, "${app.packageName}.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        app.startActivity(intent)
    }

    private fun readNotificationDiagnostics(): NotificationDiagnostics {
        val app = getApplication<Application>()
        val permissionRequired = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        val permissionGranted = !permissionRequired ||
            ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        val appNotificationsEnabled = NotificationManagerCompat.from(app).areNotificationsEnabled()
        val notificationManager = app.getSystemService(NotificationManager::class.java)
        val approvalChannelEnabled = notificationManager
            ?.getNotificationChannel(NexyApp.APPROVAL_CHANNEL_ID)
            ?.importance
            ?.let { it != NotificationManager.IMPORTANCE_NONE }
            ?: true

        return NotificationDiagnostics(
            permissionRequired = permissionRequired,
            permissionGranted = permissionGranted,
            appNotificationsEnabled = appNotificationsEnabled,
            approvalChannelEnabled = approvalChannelEnabled,
        )
    }
}
