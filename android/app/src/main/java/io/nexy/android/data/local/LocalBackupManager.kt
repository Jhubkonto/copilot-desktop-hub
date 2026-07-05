package io.nexy.android.data.local

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.util.Base64
import androidx.room.withTransaction
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.io.File
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class LocalBackupManager(private val context: Context) {
    private val database = NexyDatabase.get(context)

    suspend fun exportTo(uri: Uri, passphrase: CharArray): BackupResult = withContext(Dispatchers.IO) {
        require(passphrase.size >= 8) { "Backup passphrase must contain at least 8 characters." }
        checkDatabaseIntegrity()
        val payload = database.withTransaction {
            val root = JSONObject()
                .put("format", BACKUP_FORMAT)
                .put("schemaVersion", 1)
                .put("exportedAt", System.currentTimeMillis())
            val tables = JSONObject()
            TABLES.forEach { table -> tables.put(table, exportTable(table)) }
            root
                .put("tables", tables)
                .put("attachmentFiles", exportAttachmentFiles())
                .toString()
                .toByteArray(Charsets.UTF_8)
        }
        val encrypted = encrypt(payload, passphrase)
        context.contentResolver.openOutputStream(uri, "w")?.use { it.write(encrypted) }
            ?: error("Unable to open backup destination.")
        BackupResult(TABLES.size, payload.size.toLong())
    }

    suspend fun restoreFrom(uri: Uri, passphrase: CharArray): BackupResult = withContext(Dispatchers.IO) {
        require(passphrase.size >= 8) { "Backup passphrase must contain at least 8 characters." }
        val encrypted = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: error("Unable to open backup.")
        val plaintext = decrypt(encrypted, passphrase)
        val root = JSONObject(plaintext.toString(Charsets.UTF_8))
        require(root.optString("format") == BACKUP_FORMAT) { "This file is not a Nexy standalone backup." }
        require(root.optInt("schemaVersion") == 1) { "Unsupported backup schema version." }
        validateBackup(root)
        val tables = root.getJSONObject("tables")
        val attachmentFiles = root.optJSONArray("attachmentFiles") ?: JSONArray()
        database.withTransaction {
            val sqlite = database.openHelper.writableDatabase
            DELETE_ORDER.forEach { sqlite.execSQL("DELETE FROM $it") }
            TABLES.forEach { table ->
                val rows = tables.optJSONArray(table) ?: JSONArray()
                for (index in 0 until rows.length()) {
                    val row = rows.getJSONObject(index)
                    val values = ContentValues()
                    row.keys().forEach { column ->
                        when (val value = row.get(column)) {
                            JSONObject.NULL -> values.putNull(column)
                            is Int -> values.put(column, value)
                            is Long -> values.put(column, value)
                            is Double -> values.put(column, value)
                            is Boolean -> values.put(column, if (value) 1 else 0)
                            is String -> {
                                if (value.startsWith(BLOB_PREFIX)) {
                                    values.put(column, Base64.decode(value.removePrefix(BLOB_PREFIX), Base64.NO_WRAP))
                                } else {
                                    values.put(column, value)
                                }
                            }
                            else -> values.put(column, value.toString())
                        }
                    }
                    val inserted = sqlite.insert(table, android.database.sqlite.SQLiteDatabase.CONFLICT_REPLACE, values)
                    check(inserted >= 0) { "Failed to restore table $table." }
                }
            }
            val attachmentDirectory = File(context.filesDir, "standalone-attachments").apply { mkdirs() }
            for (index in 0 until attachmentFiles.length()) {
                val file = attachmentFiles.getJSONObject(index)
                val hash = file.getString("contentHash")
                val bytes = Base64.decode(file.getString("contentBase64"), Base64.NO_WRAP)
                val target = File(attachmentDirectory, hash)
                target.writeBytes(bytes)
                val values = ContentValues().apply { put("localPath", target.absolutePath) }
                sqlite.update("local_attachments", android.database.sqlite.SQLiteDatabase.CONFLICT_ABORT, values, "contentHash = ?", arrayOf(hash))
            }
        }
        database.invalidationTracker.refreshAsync()
        checkDatabaseIntegrity()
        BackupResult(TABLES.size, plaintext.size.toLong())
    }

    /**
     * Last-resort, read-only recovery export. It copies the SQLite database and any WAL bytes
     * directly, so it remains usable when Room queries or integrity checks cannot complete.
     * Support tooling can decrypt and inspect this envelope without mutating the source database.
     */
    suspend fun exportRawRecoveryCopy(uri: Uri, passphrase: CharArray): BackupResult =
        withContext(Dispatchers.IO) {
            require(passphrase.size >= 8) { "Recovery passphrase must contain at least 8 characters." }
            val databaseFile = context.getDatabasePath("nexy-local.db")
            require(databaseFile.isFile) { "The local database file is unavailable." }
            val walFile = File("${databaseFile.absolutePath}-wal")
            val databaseBytes = databaseFile.readBytes()
            val root = JSONObject()
                .put("format", RAW_RECOVERY_FORMAT)
                .put("schemaVersion", 1)
                .put("exportedAt", System.currentTimeMillis())
                .put("databaseSha256", databaseBytes.sha256())
                .put("databaseBase64", Base64.encodeToString(databaseBytes, Base64.NO_WRAP))
                .put(
                    "walBase64",
                    if (walFile.isFile) Base64.encodeToString(walFile.readBytes(), Base64.NO_WRAP) else JSONObject.NULL,
                )
            val plaintext = root.toString().toByteArray(Charsets.UTF_8)
            val encrypted = encrypt(plaintext, passphrase)
            context.contentResolver.openOutputStream(uri, "w")?.use { it.write(encrypted) }
                ?: error("Unable to open recovery destination.")
            BackupResult(if (walFile.isFile) 2 else 1, plaintext.size.toLong())
        }

    suspend fun integrityStatus(): String = withContext(Dispatchers.IO) {
        checkDatabaseIntegrity()
        "ok"
    }

    private fun checkDatabaseIntegrity() {
        database.openHelper.readableDatabase.query("PRAGMA quick_check").use { cursor ->
            check(cursor.moveToFirst() && cursor.getString(0).equals("ok", ignoreCase = true)) {
                "The local database failed its integrity check. Restore a verified backup before making further changes."
            }
        }
    }

    private fun validateBackup(root: JSONObject) {
        val tables = root.getJSONObject("tables")
        TABLES.forEach { table ->
            require(tables.optJSONArray(table) != null) { "Backup is missing required table $table." }
        }
        val files = root.optJSONArray("attachmentFiles") ?: JSONArray()
        for (index in 0 until files.length()) {
            val file = files.getJSONObject(index)
            val expectedHash = file.getString("contentHash")
            require(expectedHash.matches(Regex("^[a-f0-9]{64}$"))) { "Backup contains an invalid attachment hash." }
            val bytes = runCatching { Base64.decode(file.getString("contentBase64"), Base64.NO_WRAP) }
                .getOrElse { throw IllegalArgumentException("Backup contains an invalid attachment payload.", it) }
            require(bytes.sha256() == expectedHash) { "Backup attachment content does not match its hash." }
        }
    }

    private fun exportTable(table: String): JSONArray {
        val result = JSONArray()
        database.openHelper.readableDatabase.query("SELECT * FROM $table").use { cursor ->
            while (cursor.moveToNext()) result.put(cursor.rowToJson())
        }
        return result
    }

    private fun exportAttachmentFiles(): JSONArray {
        val result = JSONArray()
        database.openHelper.readableDatabase.query(
            "SELECT contentHash, localPath FROM local_attachments WHERE localPath IS NOT NULL",
        ).use { cursor ->
            val hashColumn = cursor.getColumnIndexOrThrow("contentHash")
            val pathColumn = cursor.getColumnIndexOrThrow("localPath")
            while (cursor.moveToNext()) {
                val file = File(cursor.getString(pathColumn))
                if (!file.isFile || !file.canonicalPath.startsWith(context.filesDir.canonicalPath)) continue
                result.put(
                    JSONObject()
                        .put("contentHash", cursor.getString(hashColumn))
                        .put("contentBase64", Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)),
                )
            }
        }
        return result
    }

    private fun Cursor.rowToJson(): JSONObject = JSONObject().also { row ->
        for (column in columnNames.indices) {
            val name = columnNames[column]
            when (getType(column)) {
                Cursor.FIELD_TYPE_NULL -> row.put(name, JSONObject.NULL)
                Cursor.FIELD_TYPE_INTEGER -> row.put(name, getLong(column))
                Cursor.FIELD_TYPE_FLOAT -> row.put(name, getDouble(column))
                Cursor.FIELD_TYPE_BLOB -> row.put(name, BLOB_PREFIX + Base64.encodeToString(getBlob(column), Base64.NO_WRAP))
                else -> row.put(name, getString(column))
            }
        }
    }

    private fun encrypt(plaintext: ByteArray, passphrase: CharArray): ByteArray {
        val salt = ByteArray(16).also(SecureRandom()::nextBytes)
        val iv = ByteArray(12).also(SecureRandom()::nextBytes)
        val key = deriveKey(passphrase, salt)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val ciphertext = cipher.doFinal(plaintext)
        return ByteArrayOutputStream().use {
            it.write(MAGIC)
            it.write(salt)
            it.write(iv)
            it.write(ciphertext)
            it.toByteArray()
        }
    }

    private fun decrypt(encrypted: ByteArray, passphrase: CharArray): ByteArray {
        require(encrypted.size > MAGIC.size + 28) { "Backup file is truncated." }
        require(encrypted.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) { "Invalid backup header." }
        val saltStart = MAGIC.size
        val ivStart = saltStart + 16
        val bodyStart = ivStart + 12
        val salt = encrypted.copyOfRange(saltStart, ivStart)
        val iv = encrypted.copyOfRange(ivStart, bodyStart)
        val key = deriveKey(passphrase, salt)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        return runCatching { cipher.doFinal(encrypted.copyOfRange(bodyStart, encrypted.size)) }
            .getOrElse { throw IllegalArgumentException("Incorrect passphrase or damaged backup.", it) }
    }

    private fun deriveKey(passphrase: CharArray, salt: ByteArray): SecretKeySpec {
        val spec = PBEKeySpec(passphrase, salt, 180_000, 256)
        return SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded, "AES")
    }

    data class BackupResult(val tableCount: Int, val plaintextBytes: Long)

    private fun ByteArray.sha256(): String =
        MessageDigest.getInstance("SHA-256").digest(this).joinToString("") { "%02x".format(it) }

    companion object {
        private const val BACKUP_FORMAT = "nexy-android-standalone"
        private const val RAW_RECOVERY_FORMAT = "nexy-android-raw-recovery"
        private const val BLOB_PREFIX = "__base64__:"
        private val MAGIC = "NEXYBACKUP1".toByteArray(Charsets.US_ASCII)
        private val TABLES = listOf(
            "local_projects",
            "local_agents",
            "local_conversations",
            "local_messages",
            "local_library_items",
            "local_drafts",
            "conversation_summaries",
            "local_attachments",
            "sync_outbox",
            "sync_change_log",
            "sync_cursors",
            "sync_conflicts",
        )
        private val DELETE_ORDER = TABLES.reversed()
    }
}
