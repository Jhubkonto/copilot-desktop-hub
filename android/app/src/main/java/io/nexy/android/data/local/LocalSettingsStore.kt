package io.nexy.android.data.local

import android.content.Context
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class LocalSettingsStore(context: Context) {
    private val database = NexyDatabase.get(context)
    private val dao = database.settings()

    suspend fun getDefaultDesktopModel(): String? = dao.get(LocalSettingsEntity.KEY_DEFAULT_DESKTOP_MODEL)?.value

    fun observeDefaultDesktopModel(): Flow<String?> =
        dao.observe(LocalSettingsEntity.KEY_DEFAULT_DESKTOP_MODEL).map { it?.value }

    suspend fun setDefaultDesktopModel(modelId: String?) {
        if (modelId == null) {
            dao.delete(LocalSettingsEntity.KEY_DEFAULT_DESKTOP_MODEL)
        } else {
            dao.insert(LocalSettingsEntity(LocalSettingsEntity.KEY_DEFAULT_DESKTOP_MODEL, modelId))
        }
    }

    suspend fun getDefaultStandaloneModel(): String? = dao.get(LocalSettingsEntity.KEY_DEFAULT_STANDALONE_MODEL)?.value

    fun observeDefaultStandaloneModel(): Flow<String?> =
        dao.observe(LocalSettingsEntity.KEY_DEFAULT_STANDALONE_MODEL).map { it?.value }

    suspend fun setDefaultStandaloneModel(modelId: String?) {
        if (modelId == null) {
            dao.delete(LocalSettingsEntity.KEY_DEFAULT_STANDALONE_MODEL)
        } else {
            dao.insert(LocalSettingsEntity(LocalSettingsEntity.KEY_DEFAULT_STANDALONE_MODEL, modelId))
        }
    }

    suspend fun getDefaultTemperature(): Double? =
        dao.get(LocalSettingsEntity.KEY_DEFAULT_TEMPERATURE)?.value?.toDoubleOrNull()

    fun observeDefaultTemperature(): Flow<Double?> =
        dao.observe(LocalSettingsEntity.KEY_DEFAULT_TEMPERATURE).map { it?.value?.toDoubleOrNull() }

    suspend fun setDefaultTemperature(temperature: Double?) {
        if (temperature == null) {
            dao.delete(LocalSettingsEntity.KEY_DEFAULT_TEMPERATURE)
        } else {
            dao.insert(LocalSettingsEntity(LocalSettingsEntity.KEY_DEFAULT_TEMPERATURE, temperature.toString()))
        }
    }

    suspend fun getDefaultMaxTokens(): Int? =
        dao.get(LocalSettingsEntity.KEY_DEFAULT_MAX_TOKENS)?.value?.toIntOrNull()

    fun observeDefaultMaxTokens(): Flow<Int?> =
        dao.observe(LocalSettingsEntity.KEY_DEFAULT_MAX_TOKENS).map { it?.value?.toIntOrNull() }

    suspend fun setDefaultMaxTokens(maxTokens: Int?) {
        if (maxTokens == null) {
            dao.delete(LocalSettingsEntity.KEY_DEFAULT_MAX_TOKENS)
        } else {
            dao.insert(LocalSettingsEntity(LocalSettingsEntity.KEY_DEFAULT_MAX_TOKENS, maxTokens.toString()))
        }
    }
}
