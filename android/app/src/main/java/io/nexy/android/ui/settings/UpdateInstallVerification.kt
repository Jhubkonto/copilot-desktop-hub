package io.nexy.android.ui.settings

import android.content.Context
import android.os.Build
import io.nexy.android.BuildConfig
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AndroidUpdateManifest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class RunningBuildIdentity(
    val versionName: String,
    val versionCode: Long,
    val buildId: String,
    val commitSha: String,
    val sourceDirty: Boolean,
    val builtAt: Long,
) {
    val shortBuildId: String get() = buildId.take(12)
}

object UpdateInstallVerification {
    private const val PREFS = "nexy_update_verification"
    private const val EXPECTED_VERSION_CODE = "expected_version_code"
    private const val EXPECTED_BUILD_ID = "expected_build_id"
    private const val LAST_RESULT = "last_result"
    private val _status = MutableStateFlow<String?>(null)
    val status: StateFlow<String?> = _status

    fun loadStatus(context: Context): StateFlow<String?> {
        _status.value = lastResult(context)
        return status
    }

    fun runningBuild(context: Context): RunningBuildIdentity {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
        return RunningBuildIdentity(
            versionName = info.versionName ?: BuildConfig.VERSION_NAME,
            versionCode = versionCode,
            buildId = BuildConfig.NEXY_BUILD_ID,
            commitSha = BuildConfig.NEXY_COMMIT_SHA,
            sourceDirty = BuildConfig.NEXY_SOURCE_DIRTY,
            builtAt = BuildConfig.NEXY_BUILD_TIMESTAMP,
        )
    }

    fun recordExpectedInstall(context: Context, manifest: AndroidUpdateManifest) {
        val waiting = "Waiting for Android to install build ${manifest.versionCode} " +
            "(${manifest.buildId?.take(12) ?: "legacy"})."
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(EXPECTED_VERSION_CODE, manifest.versionCode.toLong())
            .putString(EXPECTED_BUILD_ID, manifest.buildId)
            .putString(LAST_RESULT, waiting)
            .apply()
        _status.value = waiting
        android.util.Log.i(
            "NexyUpdate",
            "INSTALL_REQUEST expectedVersion=${manifest.versionCode} expectedBuildId=${manifest.buildId ?: "legacy"}",
        )
        WsRepository.appendDebugLog(
            "app-update",
            "INSTALL_REQUEST expectedVersion=${manifest.versionCode} expectedBuildId=${manifest.buildId ?: "legacy"}",
        )
    }

    /**
     * Android's package installer runs outside Nexy and does not return a reliable success result.
     * The retained expectation is therefore checked when Nexy resumes or starts after replacement.
     */
    fun verifyPendingInstall(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.contains(EXPECTED_VERSION_CODE)) return prefs.getString(LAST_RESULT, null)

        val expectedVersion = prefs.getLong(EXPECTED_VERSION_CODE, -1L)
        val expectedBuildId = prefs.getString(EXPECTED_BUILD_ID, null)
        val running = runningBuild(context)
        val versionMatches = running.versionCode >= expectedVersion
        val identityMatches = expectedBuildId.isNullOrBlank() || running.buildId == expectedBuildId
        val verified = versionMatches && identityMatches
        val result = if (verified) {
            "Verified installed build ${running.versionCode} (${running.shortBuildId})."
        } else {
            "Install not verified: expected build $expectedVersion " +
                "(${expectedBuildId?.take(12) ?: "legacy"}), running ${running.versionCode} (${running.shortBuildId})."
        }
        prefs.edit()
            .putString(LAST_RESULT, result)
            .apply {
                if (verified) {
                    remove(EXPECTED_VERSION_CODE)
                    remove(EXPECTED_BUILD_ID)
                }
            }
            .apply()
        _status.value = result
        android.util.Log.i("NexyUpdate", result)
        WsRepository.appendDebugLog(
            if (verified) "app-update" else "APP_UPDATE_MISMATCH",
            result,
        )
        return result
    }

    fun lastResult(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(LAST_RESULT, null)
}
