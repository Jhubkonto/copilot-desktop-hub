package io.nexy.android.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "local_settings")
data class LocalSettingsEntity(
    @PrimaryKey
    val key: String,
    val value: String?,
) {
    companion object {
        const val KEY_DEFAULT_DESKTOP_MODEL = "default_desktop_model"
        const val KEY_DEFAULT_STANDALONE_MODEL = "default_standalone_model"
        const val KEY_DEFAULT_TEMPERATURE = "default_temperature"
        const val KEY_DEFAULT_MAX_TOKENS = "default_max_tokens"
    }
}
