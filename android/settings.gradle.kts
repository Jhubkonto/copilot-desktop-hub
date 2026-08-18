pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

// The build runs with Android Studio's bundled JDK (or the JDK selected by
// the desktop build handler), so toolchain auto-provisioning is unnecessary.
// Keeping the Foojay resolver here makes every build depend on resolving an
// external plugin before Gradle can even configure the project, which breaks
// release builds in offline or restricted-network environments.
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // MPAndroidChart (com.github.PhilJay:MPAndroidChart) is only published on JitPack.
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "nexy"
include(":app")
