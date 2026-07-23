package io.nexy.android.data.model

data class AndroidUpdateManifest(
    val versionCode: Int,
    val versionName: String,
    val commitSha: String?,
    val buildId: String? = null,
    val sourceDirty: Boolean = false,
    val builtAt: Long? = null,
    val changelog: String,
    val checksum: String,
    val artifactUrl: String,
    val publishedAt: Long,
)
