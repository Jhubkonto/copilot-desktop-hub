import java.io.File

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

// google-services.json is intentionally never committed. Android builds
// without it remain valid builds with FCM disabled; CI may copy a protected
// file into this location for a Firebase-enabled release.
val hasFirebaseConfig = file("google-services.json").isFile
if (hasFirebaseConfig) {
    apply(plugin = "com.google.gms.google-services")
}

// Derive versionCode from the git commit count so every APK the desktop builds
// and publishes to the update feed is strictly newer than the previously
// installed one — the Android updater compares only versionCode. Falls back to 1
// when git is unavailable (e.g. building from a source archive without .git).
fun gitCommitCount(root: File): Int = try {
    val process = ProcessBuilder("git", "rev-list", "--count", "HEAD")
        .directory(root)
        .redirectErrorStream(true)
        .start()
    val output = process.inputStream.bufferedReader().readText().trim()
    process.waitFor()
    output.toIntOrNull() ?: 1
} catch (_: Exception) {
    1
}

fun gitValue(root: File, vararg args: String): String? = try {
    val process = ProcessBuilder(listOf("git") + args)
        .directory(root)
        .redirectErrorStream(true)
        .start()
    val output = process.inputStream.bufferedReader().readText().trim()
    if (process.waitFor() == 0) output.takeIf { it.isNotBlank() } else null
} catch (_: Exception) {
    null
}

fun buildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

// Keep a release bump available when publishing a new APK from an unchanged
// commit.  Android only permits installing an APK whose versionCode is newer
// than the installed one; uncommitted release fixes otherwise retain the same
// git-derived code.
val gitVersionCode = gitCommitCount(rootDir)
val releaseBuildOffset = 1
// Desktop release builds reserve a code before Gradle starts and provide it in
// the environment. This makes repeated builds from the same checkout valid
// Android updates; Git count remains the safe fallback for CLI builds.
val desktopVersionCode = System.getenv("NEXY_ANDROID_VERSION_CODE")
    ?.toIntOrNull()
    ?.takeIf { it > 0 }
val apkVersionCode = desktopVersionCode ?: (gitVersionCode + releaseBuildOffset)
val sourceCommit = System.getenv("NEXY_ANDROID_COMMIT_SHA")
    ?: gitValue(rootDir, "rev-parse", "--short", "HEAD")
    ?: "unknown"
val sourceDirty = System.getenv("NEXY_ANDROID_SOURCE_DIRTY")?.toBooleanStrictOrNull()
    ?: !gitValue(rootDir, "status", "--porcelain").isNullOrBlank()
val buildTimestamp = System.getenv("NEXY_ANDROID_BUILD_TIMESTAMP")
    ?.toLongOrNull()
    ?: System.currentTimeMillis()
val nexyBuildId = System.getenv("NEXY_ANDROID_BUILD_ID")
    ?.takeIf { it.isNotBlank() }
    ?: "local-$buildTimestamp"

android {
    namespace = "io.nexy.android"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "io.nexy.android"
        minSdk = 26
        targetSdk = 36
        versionCode = apkVersionCode
        versionName = "1.0.$apkVersionCode"
        buildConfigField("String", "NEXY_BUILD_ID", buildConfigString(nexyBuildId))
        buildConfigField("String", "NEXY_COMMIT_SHA", buildConfigString(sourceCommit))
        buildConfigField("boolean", "NEXY_SOURCE_DIRTY", sourceDirty.toString())
        buildConfigField("long", "NEXY_BUILD_TIMESTAMP", "${buildTimestamp}L")
        buildConfigField("boolean", "NEXY_FIREBASE_ENABLED", hasFirebaseConfig.toString())

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // The desktop app runs assembleRelease with NEXY_KEYSTORE_* env vars set (see
    // buildSigningEnv in src/main/android-handlers.ts). Wire them into a real
    // signing config so the published APK is signed — without this, assembleRelease
    // emits app-release-unsigned.apk and the phone reports "App not installed".
    // When the env vars are absent (e.g. a local unsigned build), leave the config
    // empty so Gradle produces an unsigned APK rather than failing configuration.
    val keystorePath: String? = System.getenv("NEXY_KEYSTORE_PATH")
    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("NEXY_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("NEXY_KEY_ALIAS")
                keyPassword = System.getenv("NEXY_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else null
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        buildConfig = true
        compose = true
    }
    lint {
        abortOnError = true
        warningsAsErrors = true
    }
    sourceSets {
        getByName("test").resources.srcDir("../../fixtures")
    }
}

configurations.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.jetbrains" && requested.name == "annotations-java5") {
            useTarget("org.jetbrains:annotations:23.0.0")
            because("annotations-java5 and annotations both provide the same classes; pin to the newer one")
        }
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.fragment.ktx)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.okhttp)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.zxing.android.embedded)
    implementation(libs.markwon.core)
    implementation(libs.markwon.ext.tables)
    implementation(libs.markwon.ext.strikethrough)
    implementation(libs.markwon.ext.tasklist)
    implementation(libs.markwon.linkify)
    implementation(libs.markwon.syntax.highlight)
    implementation(libs.prism4j)
    implementation(libs.androidx.security.crypto)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging.ktx)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    implementation(libs.mpandroidchart)
    ksp(libs.androidx.room.compiler)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.json)
    testImplementation(libs.androidx.room.testing)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.room.testing)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
