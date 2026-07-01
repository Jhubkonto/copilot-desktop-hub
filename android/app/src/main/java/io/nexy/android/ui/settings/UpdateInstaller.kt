package io.nexy.android.ui.settings

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.nexy.android.data.model.AndroidUpdateManifest
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest

internal fun downloadUpdateApk(app: Application, httpClient: OkHttpClient, manifest: AndroidUpdateManifest): File {
    val request = Request.Builder()
        .url(manifest.artifactUrl)
        .build()
    httpClient.newCall(request).execute().use { response ->
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

internal fun verifyChecksum(apk: File, expectedChecksum: String) {
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

internal fun openPackageInstaller(
    app: Application,
    apk: File,
    onNeedsPermission: (String) -> Unit,
) {
    if (!app.packageManager.canRequestPackageInstalls()) {
        onNeedsPermission("Allow installs from Nexy, then tap Install update again.")
        val settingsIntent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${app.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
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
