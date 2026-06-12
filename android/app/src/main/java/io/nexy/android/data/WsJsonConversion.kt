package io.nexy.android.data

import io.nexy.android.data.model.AttachmentMeta
import org.json.JSONArray
import org.json.JSONObject

fun JSONObject.nullableString(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

fun mapToJson(map: Map<String, Any>): JSONObject {
    val obj = JSONObject()
    for ((k, v) in map) obj.put(k, toJsonValue(v))
    return obj
}

fun listToJson(list: List<*>): JSONArray {
    val arr = JSONArray()
    for (v in list) arr.put(if (v != null) toJsonValue(v) else JSONObject.NULL)
    return arr
}

@Suppress("UNCHECKED_CAST")
fun toJsonValue(v: Any): Any = when (v) {
    is Map<*, *> -> mapToJson(v as Map<String, Any>)
    is List<*> -> listToJson(v)
    else -> v
}

fun jsonObjectToMap(obj: JSONObject?): Map<String, Any> {
    if (obj == null) return emptyMap()
    val map = mutableMapOf<String, Any>()
    for (key in obj.keys()) map[key] = obj.get(key)
    return map
}

fun attachmentsFromJson(attachmentsJson: String?): List<AttachmentMeta> {
    if (attachmentsJson.isNullOrBlank()) return emptyList()
    return runCatching {
        val arr = JSONArray(attachmentsJson)
        (0 until arr.length()).mapNotNull { i ->
            val obj = arr.optJSONObject(i) ?: return@mapNotNull null
            val name = obj.optString("name").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            AttachmentMeta(
                id = obj.optString("id").ifBlank { name },
                name = name,
                type = obj.nullableString("type"),
                thumbnailDataUrl = obj.nullableString("thumbnailDataUrl"),
            )
        }
    }.getOrDefault(emptyList())
}
