package io.nexy.android.share

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.IntentCompat
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

const val SHARE_CONVERSATION_ID = "io.nexy.android.extra.SHARE_CONVERSATION_ID"
const val MAX_SHARED_FILES = 20
const val MAX_SHARED_FILE_BYTES = 20L * 1024L * 1024L
const val MAX_SHARED_BATCH_BYTES = 50L * 1024L * 1024L

data class SharedAttachment(
    val id: String,
    val name: String,
    val mimeType: String,
    val localPath: String,
    val sizeBytes: Long,
)

data class SharedBatch(
    val id: String,
    val text: String?,
    val attachments: List<SharedAttachment>,
    val rejectedCount: Int = 0,
)

data class SharedIntentResult(val batch: SharedBatch, val conversationId: String?)

object ShareIntentRepository {
    private const val ROOT_NAME = "shared_imports"
    private const val MANIFEST_NAME = "batch.json"

    suspend fun import(context: Context, intent: Intent): SharedIntentResult? = withContext(Dispatchers.IO) {
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) return@withContext null
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() }
        val uris = intent.sharedUris().distinct().take(MAX_SHARED_FILES)
        if (text == null && uris.isEmpty()) return@withContext null

        val batchId = UUID.randomUUID().toString()
        val batchDirectory = File(context.filesDir, "$ROOT_NAME/$batchId").apply { mkdirs() }
        val attachments = mutableListOf<SharedAttachment>()
        var totalBytes = 0L
        var rejected = (intent.sharedUris().size - uris.size).coerceAtLeast(0)

        for (uri in uris) {
            val metadata = context.describe(uri)
            if (metadata.size != null && (metadata.size > MAX_SHARED_FILE_BYTES || totalBytes + metadata.size > MAX_SHARED_BATCH_BYTES)) {
                rejected++
                continue
            }
            val safeName = metadata.name.sanitizedFileName()
            val target = uniqueTarget(batchDirectory, safeName)
            val copied = runCatching {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        var written = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            written += count
                            if (written > MAX_SHARED_FILE_BYTES || totalBytes + written > MAX_SHARED_BATCH_BYTES) {
                                error("Shared file exceeds attachment limits")
                            }
                            output.write(buffer, 0, count)
                        }
                        written
                    }
                } ?: error("Shared file could not be opened")
            }.getOrNull()
            if (copied == null) {
                target.delete()
                rejected++
                continue
            }
            totalBytes += copied
            attachments += SharedAttachment(
                id = UUID.randomUUID().toString(),
                name = metadata.name,
                mimeType = metadata.mimeType,
                localPath = target.absolutePath,
                sizeBytes = copied,
            )
        }

        if (text == null && attachments.isEmpty()) {
            batchDirectory.deleteRecursively()
            return@withContext null
        }
        val batch = SharedBatch(batchId, text, attachments, rejected)
        writeManifest(batchDirectory, batch)
        SharedIntentResult(batch, intent.getStringExtra(SHARE_CONVERSATION_ID)?.takeIf(String::isNotBlank))
    }

    fun load(context: Context, batchId: String): SharedBatch? {
        if (!batchId.matches(Regex("^[a-f0-9-]{36}$"))) return null
        val directory = File(context.filesDir, "$ROOT_NAME/$batchId")
        val manifest = File(directory, MANIFEST_NAME).takeIf(File::isFile) ?: return null
        return runCatching {
            val json = JSONObject(manifest.readText())
            val items = json.getJSONArray("attachments")
            SharedBatch(
                id = batchId,
                text = json.optString("text").takeIf { json.has("text") && it.isNotBlank() },
                attachments = (0 until items.length()).mapNotNull { index ->
                    val item = items.optJSONObject(index) ?: return@mapNotNull null
                    val path = item.getString("localPath")
                    val file = File(path)
                    if (!file.isFile || file.parentFile?.canonicalFile != directory.canonicalFile) return@mapNotNull null
                    SharedAttachment(
                        id = item.getString("id"),
                        name = item.getString("name"),
                        mimeType = item.getString("mimeType"),
                        localPath = path,
                        sizeBytes = file.length(),
                    )
                },
                rejectedCount = json.optInt("rejectedCount"),
            )
        }.getOrNull()
    }

    fun discard(context: Context, batchId: String) {
        if (batchId.matches(Regex("^[a-f0-9-]{36}$"))) {
            File(context.filesDir, "$ROOT_NAME/$batchId").deleteRecursively()
        }
    }

    private fun writeManifest(directory: File, batch: SharedBatch) {
        val json = JSONObject().apply {
            batch.text?.let { put("text", it) }
            put("rejectedCount", batch.rejectedCount)
            put("attachments", JSONArray().apply {
                batch.attachments.forEach { attachment ->
                    put(JSONObject().apply {
                        put("id", attachment.id)
                        put("name", attachment.name)
                        put("mimeType", attachment.mimeType)
                        put("localPath", attachment.localPath)
                    })
                }
            })
        }
        File(directory, MANIFEST_NAME).writeText(json.toString())
    }

    private data class UriMetadata(val name: String, val mimeType: String, val size: Long?)

    private fun Context.describe(uri: Uri): UriMetadata {
        var name: String? = null
        var size: Long? = null
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = cursor.getString(it) }
                cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !cursor.isNull(it) }?.let { size = cursor.getLong(it) }
            }
        }
        return UriMetadata(
            name = name?.takeIf(String::isNotBlank) ?: uri.lastPathSegment?.substringAfterLast('/') ?: "attachment",
            mimeType = contentResolver.getType(uri) ?: "application/octet-stream",
            size = size,
        )
    }

    private fun Intent.sharedUris(): List<Uri> = if (action == Intent.ACTION_SEND_MULTIPLE) {
        IntentCompat.getParcelableArrayListExtra(this, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
    } else {
        listOfNotNull(IntentCompat.getParcelableExtra(this, Intent.EXTRA_STREAM, Uri::class.java))
    }

    private fun String.sanitizedFileName(): String = substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[\\x00-\\x1f<>:\"/\\\\|?*]"), "_")
        .take(120)
        .ifBlank { "attachment" }

    private fun uniqueTarget(directory: File, name: String): File {
        var target = File(directory, name)
        var index = 2
        val stem = name.substringBeforeLast('.', name)
        val extension = name.substringAfterLast('.', "").let { if (it.isBlank()) "" else ".$it" }
        while (target.exists()) target = File(directory, "$stem ($index)$extension").also { index++ }
        return target
    }
}
