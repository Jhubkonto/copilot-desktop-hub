package io.nexy.android.ui.settings

import io.nexy.android.data.model.AndroidUpdateManifest
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

fun updateStatusLabel(manifest: AndroidUpdateManifest?, currentVersionCode: Long): String = when {
    manifest == null -> "No update published"
    manifest.versionCode.toLong() > currentVersionCode -> "Update available"
    manifest.versionCode.toLong() == currentVersionCode -> "Current build is published"
    else -> "Published build is older"
}

fun updateStatusDetail(manifest: AndroidUpdateManifest?, currentVersionCode: Long): String = when {
    manifest == null -> "The paired desktop has not published an Android update manifest yet."
    manifest.versionCode.toLong() > currentVersionCode ->
        "Desktop published build ${manifest.versionCode}; this device is on build $currentVersionCode."
    manifest.versionCode.toLong() == currentVersionCode ->
        "This device is already on the published Android build."
    else -> "The published desktop build is older than this installed Android app."
}

fun checksumPreview(checksum: String): String =
    checksum.takeIf { it.isNotBlank() }?.take(12) ?: "Unknown"

fun sourceDesktopLabel(artifactUrl: String): String {
    val host = runCatching { URI(artifactUrl).host }.getOrNull()
    return host?.takeIf { it.isNotBlank() } ?: "Paired desktop"
}

fun publishedAtLabel(publishedAt: Long): String {
    if (publishedAt <= 0L) return "Unknown"
    return SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(publishedAt))
}

fun canInstallUpdate(manifest: AndroidUpdateManifest?, currentVersionCode: Long): Boolean =
    manifest != null && manifest.versionCode.toLong() > currentVersionCode
