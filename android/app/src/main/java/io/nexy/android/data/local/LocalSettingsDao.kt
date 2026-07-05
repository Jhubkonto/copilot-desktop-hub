package io.nexy.android.data.local

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface LocalSettingsDao {
    @Query("SELECT * FROM local_settings WHERE `key` = :key")
    suspend fun get(key: String): LocalSettingsEntity?

    @Query("SELECT * FROM local_settings WHERE `key` = :key")
    fun observe(key: String): Flow<LocalSettingsEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: LocalSettingsEntity)

    @Update
    suspend fun update(entity: LocalSettingsEntity)

    @Delete
    suspend fun delete(entity: LocalSettingsEntity)

    @Query("DELETE FROM local_settings WHERE `key` = :key")
    suspend fun delete(key: String)
}
