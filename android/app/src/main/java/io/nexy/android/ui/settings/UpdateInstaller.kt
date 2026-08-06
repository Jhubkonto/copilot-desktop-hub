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

/** Which stage of the OTA flow failed, so the UI can show a specific message and offer retry. */
enum class UpdateStage { DOWNLOAD, VERIFY, INSTALL }

class UpdateException(val stage: UpdateStage, message: String, cause: Throwable? = null) :
    Exception(message, cause)

/**
 * Removes previously-downloaded APKs except the one currently being installed, so stale
 * versioned files don't accumulate in cacheDir/updates over successive updates.
 */
private fun pruneOldApks(updateDir: File, keep: File) {
    updateDir.listFiles()?.forEach { file ->
        if (file != keep && file.name.endsWith(".apk")) {
            runCatching { file.delete() }
        }
    }
}

internal fun downloadUpdateApk(
    app: Application,
    httpClient: OkHttpClient,
    manifest: AndroidUpdateManifest,
    onProgress: (bytesRead: Long, total: Long) -> Unit = { _, _ -> },
): File {
    // Try each candidate origin in order (LAN first, then Tailscale) so a phone that
    // can't reach the LAN address — e.g. connected over cellular via Tailscale — falls
    // back to the one it can reach, instead of failing outright.
    val candidateUrls = manifest.artifactUrls.ifEmpty { listOf(manifest.artifactUrl) }
    var response: okhttp3.Response? = null
    var lastError: Exception? = null
    for (url in candidateUrls) {
        try {
            val resp = httpClient.newCall(Request.Builder().url(url).build()).execute()
            if (resp.isSuccessful) {
                response = resp
                break
            }
            resp.close()
        } catch (e: Exception) {
            lastError = e
        }
    }
    val resp = response ?: throw UpdateException(UpdateStage.DOWNLOAD, "Couldn't reach the desktop to download the update. Check your connection and try again.", lastError)
    resp.use {
        val body = resp.body ?: throw UpdateException(UpdateStage.DOWNLOAD, "The update download was empty.")
        val total = body.contentLength()
        val updateDir = File(app.cacheDir, "updates").also { it.mkdirs() }
        val apk = File(updateDir, "nexy-${manifest.versionCode}.apk")
        pruneOldApks(updateDir, keep = apk)
        try {
            body.byteStream().use { input ->
                apk.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var readTotal = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        readTotal += read
                        onProgress(readTotal, total)
                    }
                }
            }
        } catch (e: Exception) {
            apk.delete()
            throw UpdateException(UpdateStage.DOWNLOAD, "The update download was interrupted. Try again.", e)
        }
        return apk
    }
}

internal fun verifyChecksum(apk: File, expectedChecksum: String) {
    val normalizedExpected = expectedChecksum.trim().lowercase()
    if (normalizedExpected.isBlank()) throw UpdateException(UpdateStage.VERIFY, "The update is missing a checksum and can't be verified.")
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
        throw UpdateException(UpdateStage.VERIFY, "The downloaded update failed its integrity check and was discarded.")
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
