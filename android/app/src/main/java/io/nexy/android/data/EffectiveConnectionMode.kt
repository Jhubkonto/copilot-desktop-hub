package io.nexy.android.data

enum class EffectiveConnectionMode {
    CONNECTED,
    CONNECTING,
    SEARCHING,
    DISCONNECTED,
    STANDALONE_BY_CHOICE,
}

fun deriveEffectiveMode(
    connectionState: ConnectionState,
    preferStandaloneMode: Boolean,
): EffectiveConnectionMode {
    return when {
        preferStandaloneMode -> EffectiveConnectionMode.STANDALONE_BY_CHOICE
        connectionState == ConnectionState.CONNECTED -> EffectiveConnectionMode.CONNECTED
        connectionState == ConnectionState.CONNECTING -> EffectiveConnectionMode.CONNECTING
        connectionState == ConnectionState.POLLING -> EffectiveConnectionMode.SEARCHING
        else -> EffectiveConnectionMode.DISCONNECTED
    }
}
