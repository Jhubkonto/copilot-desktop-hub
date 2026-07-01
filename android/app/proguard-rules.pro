# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# WebView JS interface for the code-block syntax-highlighting island
# (CodeBlockWebView.kt) — keeps @JavascriptInterface methods from being
# stripped/renamed in release builds, which would silently break copy-to-
# clipboard and WebView height reporting.
-keepclassmembers class io.nexy.android.ui.chat.CodeBlockBridge {
    public *;
}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile