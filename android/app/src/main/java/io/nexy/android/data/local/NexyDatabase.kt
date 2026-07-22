package io.nexy.android.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

class LocalConverters {
    @TypeConverter
    fun fromSyncStatus(value: SyncStatus): String = value.name

    @TypeConverter
    fun toSyncStatus(value: String): SyncStatus =
        runCatching { SyncStatus.valueOf(value) }.getOrDefault(SyncStatus.SYNCED)
}

@Database(
    entities = [
        ConversationEntity::class,
        MessageEntity::class,
        AgentEntity::class,
        ProjectEntity::class,
        LibraryItemEntity::class,
        DraftEntity::class,
        ConversationSummaryEntity::class,
        OutboxEntity::class,
        ChangeLogEntity::class,
        SyncCursorEntity::class,
        ConflictEntity::class,
        AttachmentEntity::class,
        LocalSettingsEntity::class,
    ],
    version = 8,
    exportSchema = true,
)
@TypeConverters(LocalConverters::class)
abstract class NexyDatabase : RoomDatabase() {
    abstract fun conversations(): ConversationDao
    abstract fun messages(): MessageDao
    abstract fun agents(): AgentDao
    abstract fun projects(): ProjectDao
    abstract fun library(): LibraryDao
    abstract fun drafts(): DraftDao
    abstract fun summaries(): ConversationSummaryDao
    abstract fun sync(): SyncDao
    abstract fun attachments(): AttachmentDao
    abstract fun settings(): LocalSettingsDao

    companion object {
        @Volatile
        private var instance: NexyDatabase? = null

        fun get(context: Context): NexyDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    NexyDatabase::class.java,
                    "nexy-local.db",
                )
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8)
                    .enableMultiInstanceInvalidation()
                    .build()
                    .also { instance = it }
            }

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS conversation_summaries (
                       conversationId TEXT NOT NULL PRIMARY KEY,
                       summary TEXT NOT NULL,
                       sourceMessageCount INTEGER NOT NULL,
                       createdAt INTEGER NOT NULL,
                       updatedAt INTEGER NOT NULL
                    )""",
                )
                db.execSQL(
                    "CREATE INDEX IF NOT EXISTS index_conversation_summaries_updatedAt ON conversation_summaries(updatedAt)",
                )
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_messages ADD COLUMN provider TEXT")
                db.execSQL("ALTER TABLE local_messages ADD COLUMN finishReason TEXT")
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS local_settings (
                       `key` TEXT NOT NULL PRIMARY KEY,
                       value TEXT
                    )""",
                )
            }
        }

        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_conversations ADD COLUMN kind TEXT")
            }
        }

        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_messages ADD COLUMN textSegmentsJson TEXT NOT NULL DEFAULT '[]'")
            }
        }

        val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE local_messages ADD COLUMN timelineOrder INTEGER")
            }
        }
    }
}
