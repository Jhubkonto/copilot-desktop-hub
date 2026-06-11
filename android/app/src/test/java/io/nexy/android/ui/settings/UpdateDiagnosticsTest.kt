package io.nexy.android.ui.settings

import io.nexy.android.data.model.AndroidUpdateManifest
import org.junit.Assert.assertEquals
import org.junit.Test

class UpdateDiagnosticsTest {

    @Test
    fun updateStatusLabelReportsAvailableBuilds() {
        val manifest = manifest(versionCode = 7)

        assertEquals("Update available", updateStatusLabel(manifest, currentVersionCode = 3))
        assertEquals(
            "Desktop published build 7; this device is on build 3.",
            updateStatusDetail(manifest, currentVersionCode = 3),
        )
    }

    @Test
    fun updateStatusLabelHandlesMissingManifest() {
        assertEquals("No update published", updateStatusLabel(null, currentVersionCode = 3))
        assertEquals(
            "The paired desktop has not published an Android update manifest yet.",
            updateStatusDetail(null, currentVersionCode = 3),
        )
    }

    @Test
    fun updateMetadataFormattingUsesStableFallbacks() {
        assertEquals("abcdef123456", checksumPreview("abcdef1234567890"))
        assertEquals("Unknown", checksumPreview(""))
        assertEquals("192.168.1.100", sourceDesktopLabel("http://192.168.1.100:12345/android/app.apk"))
        assertEquals("Paired desktop", sourceDesktopLabel("not a url"))
        assertEquals("Unknown", publishedAtLabel(0))
    }

    @Test
    fun canInstallUpdateOnlyForNewerBuilds() {
        assertEquals(true, canInstallUpdate(manifest(versionCode = 4), currentVersionCode = 3))
        assertEquals(false, canInstallUpdate(manifest(versionCode = 3), currentVersionCode = 3))
        assertEquals(false, canInstallUpdate(null, currentVersionCode = 3))
    }

    private fun manifest(versionCode: Int) = AndroidUpdateManifest(
        versionCode = versionCode,
        versionName = "1.2.3",
        commitSha = "abc123",
        changelog = "",
        checksum = "checksum",
        artifactUrl = "http://192.168.1.100:12345/android/app.apk",
        publishedAt = 1000,
    )
}
