package app.jot.editor

/** JSON values as plain Kotlin: String, Boolean, Int, null, List, Map. Numbers from React Native arrive as Double. */
internal object Json {
  fun normalize(value: Any?): Any? =
    when (value) {
      null -> null
      is String, is Boolean, is Int -> value
      is Double -> if (value % 1.0 == 0.0) value.toInt() else value
      is Float -> if (value % 1.0f == 0.0f) value.toInt() else value.toDouble()
      is Number -> value.toInt()
      is Map<*, *> -> LinkedHashMap<String, Any?>().also { out ->
        for ((key, nested) in value) {
          out[key.toString()] = normalize(nested)
        }
      }
      is List<*> -> value.map { normalize(it) }
      is Array<*> -> value.map { normalize(it) }
      else -> value.toString()
    }

  fun obj(value: Any?): Map<String, Any?> {
    if (value !is Map<*, *>) {
      return emptyMap()
    }
    @Suppress("UNCHECKED_CAST")
    return value as Map<String, Any?>
  }

  fun arr(value: Any?): List<Any?> = value as? List<Any?> ?: emptyList()

  fun str(value: Any?): String? = value as? String

  fun int(value: Any?): Int? =
    when (value) {
      is Int -> value
      is Number -> value.toInt()
      else -> null
    }
}

internal object Utf16 {
  fun slice(text: String, offset: Int, length: Int): String {
    val start = offset.coerceIn(0, text.length)
    val end = (start + length.coerceAtLeast(0)).coerceAtMost(text.length)
    return text.substring(start, end)
  }

  fun insert(text: String, offset: Int, inserted: String): String {
    val at = offset.coerceIn(0, text.length)
    return text.substring(0, at) + inserted + text.substring(at)
  }

  fun hasUnpairedSurrogates(text: String): Boolean {
    var i = 0
    while (i < text.length) {
      val ch = text[i]
      if (Character.isHighSurrogate(ch)) {
        if (i + 1 >= text.length || !Character.isLowSurrogate(text[i + 1])) {
          return true
        }
        i += 2
        continue
      }
      if (Character.isLowSurrogate(ch)) {
        return true
      }
      i += 1
    }
    return false
  }
}

internal data class SchemaMark(
  val type: String,
  val attrs: Map<String, Any?> = emptyMap(),
) {
  fun toJson(): Map<String, Any?> =
    if (attrs.isEmpty()) mapOf("type" to type) else mapOf("type" to type, "attrs" to attrs)

  companion object {
    fun parse(value: Any?): SchemaMark {
      val obj = Json.obj(value)
      return SchemaMark(Json.str(obj["type"]) ?: "", Json.obj(Json.normalize(obj["attrs"])))
    }
  }
}

internal data class SchemaNode(
  val type: String,
  val id: String,
  val attrs: Map<String, Any?> = emptyMap(),
  val content: List<SchemaNode> = emptyList(),
  val text: String? = null,
  val marks: List<SchemaMark> = emptyList(),
) {
  fun toJson(): Map<String, Any?> {
    val out = LinkedHashMap<String, Any?>()
    out["id"] = id
    out["type"] = type
    if (attrs.isNotEmpty() || hasAttrs(type)) {
      out["attrs"] = attrs
    }
    if (type !in CONTENT_NONE) {
      out["content"] = content.map { it.toJson() }
    }
    if (type == "text") {
      out["text"] = text ?: ""
      out["marks"] = marks.map { it.toJson() }
    }
    return out
  }

  fun plainText(): String =
    when (type) {
      "text" -> text ?: ""
      "hardBreak" -> "\n"
      "mathInline", "mathBlock" -> (Json.str(attrs["latex"]) ?: "").ifEmpty { Json.str(attrs["alt"]) ?: "" }
      "image" -> {
        val caption = content.joinToString("") { it.plainText() }
        caption.ifEmpty { Json.str(attrs["alt"]) ?: "" }
      }
      else -> content.joinToString("") { it.plainText() }
    }

  companion object {
    val CONTENT_NONE = setOf("horizontalRule", "fileAttachment", "mathBlock", "text", "hardBreak", "mathInline")

    fun parse(value: Any?): SchemaNode {
      val obj = Json.obj(Json.normalize(value))
      return parseNormalized(obj)
    }

    private fun parseNormalized(obj: Map<String, Any?>): SchemaNode =
      SchemaNode(
        type = Json.str(obj["type"]) ?: "paragraph",
        id = Json.str(obj["id"]) ?: JotIds.createId(),
        attrs = Json.obj(obj["attrs"]),
        content = Json.arr(obj["content"]).map { parseNormalized(Json.obj(it)) },
        text = Json.str(obj["text"]),
        marks = Json.arr(obj["marks"]).map { SchemaMark.parse(it) },
      )

    private fun hasAttrs(type: String): Boolean =
      when (type) {
        "heading", "codeBlock", "orderedList", "taskItem", "tableCell",
        "image", "fileAttachment", "mathBlock", "mathInline" -> true
        else -> false
      }
  }
}

internal data class SchemaSelection(
  val nodeId: String,
  val offsetUtf16: Int,
  val affinity: String,
  val revision: Int,
) {
  fun toJson(): Map<String, Any?> =
    mapOf("nodeId" to nodeId, "offsetUtf16" to offsetUtf16, "affinity" to affinity, "revision" to revision)

  companion object {
    fun parse(value: Any?): SchemaSelection {
      val obj = Json.obj(Json.normalize(value))
      return SchemaSelection(
        nodeId = Json.str(obj["nodeId"]) ?: "",
        offsetUtf16 = Json.int(obj["offsetUtf16"]) ?: 0,
        affinity = Json.str(obj["affinity"]) ?: "before",
        revision = Json.int(obj["revision"]) ?: 0,
      )
    }
  }
}

internal sealed class SchemaOperation {
  data class InsertText(val position: SchemaSelection, val text: String, val storedMarks: List<SchemaMark>) : SchemaOperation()
  data class DeleteRange(val from: SchemaSelection, val to: SchemaSelection, val deletedSlice: List<SchemaNode>) : SchemaOperation()
  data class ReplaceRange(
    val from: SchemaSelection,
    val to: SchemaSelection,
    val slice: List<SchemaNode>,
    val deletedSlice: List<SchemaNode>,
  ) : SchemaOperation()
  data class AddMark(val from: SchemaSelection, val to: SchemaSelection, val mark: SchemaMark) : SchemaOperation()
  data class RemoveMark(val from: SchemaSelection, val to: SchemaSelection, val markType: String) : SchemaOperation()
  data class SetNodeAttributes(
    val nodeId: String,
    val patch: Map<String, Any?>,
    val priorValues: Map<String, Any?>,
  ) : SchemaOperation()
  data class InsertNode(val parentId: String, val index: Int, val node: SchemaNode) : SchemaOperation()
  data class DeleteNode(val nodeId: String, val deletedNode: SchemaNode) : SchemaOperation()

  fun toJson(): Map<String, Any?> =
    when (this) {
      is InsertText -> mapOf(
        "type" to "insertText",
        "position" to position.toJson(),
        "text" to text,
        "storedMarks" to storedMarks.map { it.toJson() },
      )
      is DeleteRange -> mapOf(
        "type" to "deleteRange",
        "from" to from.toJson(),
        "to" to to.toJson(),
        "deletedSlice" to mapOf("nodes" to deletedSlice.map { it.toJson() }),
      )
      is ReplaceRange -> mapOf(
        "type" to "replaceRange",
        "from" to from.toJson(),
        "to" to to.toJson(),
        "slice" to mapOf("nodes" to slice.map { it.toJson() }),
        "deletedSlice" to mapOf("nodes" to deletedSlice.map { it.toJson() }),
      )
      is AddMark -> mapOf(
        "type" to "addMark",
        "range" to mapOf("from" to from.toJson(), "to" to to.toJson()),
        "mark" to mark.toJson(),
      )
      is RemoveMark -> mapOf(
        "type" to "removeMark",
        "range" to mapOf("from" to from.toJson(), "to" to to.toJson()),
        "markType" to markType,
      )
      is SetNodeAttributes -> mapOf(
        "type" to "setNodeAttributes",
        "nodeId" to nodeId,
        "patch" to patch,
        "priorValues" to priorValues,
      )
      is InsertNode -> mapOf(
        "type" to "insertNode",
        "parentId" to parentId,
        "index" to index,
        "node" to node.toJson(),
      )
      is DeleteNode -> mapOf(
        "type" to "deleteNode",
        "nodeId" to nodeId,
        "deletedNode" to deletedNode.toJson(),
      )
    }

  companion object {
    fun parseList(value: Any?): List<SchemaOperation> = Json.arr(Json.normalize(value)).mapNotNull { parse(it) }

    fun parse(value: Any?): SchemaOperation? {
      val obj = Json.obj(Json.normalize(value))
      return when (Json.str(obj["type"])) {
        "insertText" -> InsertText(
          SchemaSelection.parse(obj["position"]),
          Json.str(obj["text"]) ?: "",
          Json.arr(obj["storedMarks"]).map { SchemaMark.parse(it) },
        )
        "deleteRange" -> DeleteRange(
          SchemaSelection.parse(obj["from"]),
          SchemaSelection.parse(obj["to"]),
          sliceNodes(obj["deletedSlice"]),
        )
        "replaceRange" -> ReplaceRange(
          SchemaSelection.parse(obj["from"]),
          SchemaSelection.parse(obj["to"]),
          sliceNodes(obj["slice"]),
          sliceNodes(obj["deletedSlice"]),
        )
        "addMark" -> {
          val range = Json.obj(obj["range"])
          AddMark(SchemaSelection.parse(range["from"]), SchemaSelection.parse(range["to"]), SchemaMark.parse(obj["mark"]))
        }
        "removeMark" -> {
          val range = Json.obj(obj["range"])
          RemoveMark(SchemaSelection.parse(range["from"]), SchemaSelection.parse(range["to"]), Json.str(obj["markType"]) ?: "")
        }
        "setNodeAttributes" -> SetNodeAttributes(
          Json.str(obj["nodeId"]) ?: "",
          Json.obj(obj["patch"]),
          Json.obj(obj["priorValues"]),
        )
        "insertNode" -> InsertNode(
          Json.str(obj["parentId"]) ?: "",
          Json.int(obj["index"]) ?: 0,
          SchemaNode.parse(obj["node"]),
        )
        "deleteNode" -> DeleteNode(Json.str(obj["nodeId"]) ?: "", SchemaNode.parse(obj["deletedNode"]))
        else -> null
      }
    }

    private fun sliceNodes(value: Any?): List<SchemaNode> {
      if (value is Map<*, *>) {
        return Json.arr(value["nodes"]).map { SchemaNode.parse(it) }
      }
      return Json.arr(value).map { SchemaNode.parse(it) }
    }
  }
}

/** Sorted keys by UTF-8 bytes and minimal escaping, byte for byte like the Swift and TypeScript encoders. */
internal object CanonicalJson {
  fun stringify(value: Any?): String {
    val out = StringBuilder()
    emit(Json.normalize(value), out)
    return out.toString()
  }

  private fun emit(value: Any?, out: StringBuilder) {
    when (value) {
      null -> out.append("null")
      is Boolean -> out.append(if (value) "true" else "false")
      is Int -> out.append(value)
      is Number -> out.append(value.toString())
      is String -> emitString(value, out)
      is List<*> -> {
        out.append('[')
        value.forEachIndexed { index, item ->
          if (index > 0) {
            out.append(',')
          }
          emit(item, out)
        }
        out.append(']')
      }
      is Map<*, *> -> {
        out.append('{')
        val keys = value.keys.map { it.toString() }.sortedWith { a, b -> compareUtf8(a, b) }
        keys.forEachIndexed { index, key ->
          if (index > 0) {
            out.append(',')
          }
          emitString(key, out)
          out.append(':')
          emit(value[key], out)
        }
        out.append('}')
      }
      else -> emitString(value.toString(), out)
    }
  }

  private fun emitString(text: String, out: StringBuilder) {
    out.append('"')
    for (ch in text) {
      when {
        ch == '"' -> out.append("\\\"")
        ch == '\\' -> out.append("\\\\")
        ch == '\n' -> out.append("\\n")
        ch == '\r' -> out.append("\\r")
        ch == '\t' -> out.append("\\t")
        ch == '\b' -> out.append("\\b")
        ch == '\u000C' -> out.append("\\f")
        ch.code < 0x20 -> out.append(String.format("\\u%04x", ch.code))
        else -> out.append(ch)
      }
    }
    out.append('"')
  }

  private fun compareUtf8(left: String, right: String): Int {
    val a = left.toByteArray(Charsets.UTF_8)
    val b = right.toByteArray(Charsets.UTF_8)
    for (i in 0 until minOf(a.size, b.size)) {
      val x = a[i].toInt() and 0xff
      val y = b[i].toInt() and 0xff
      if (x != y) {
        return x - y
      }
    }
    return a.size - b.size
  }
}

internal data class JournalPayload(
  val transactionId: String,
  val operations: List<SchemaOperation>,
  val baseRevision: Int,
) {
  companion object {
    fun parse(json: String): JournalPayload? {
      val root = try {
        JsonParser.parseObject(json)
      } catch (_: Exception) {
        return null
      }
      val transactionId = Json.str(root["transactionId"]) ?: ""
      if (transactionId.isEmpty()) {
        return null
      }
      val raw = Json.arr(Json.normalize(root["operations"]))
      val operations = raw.mapNotNull { SchemaOperation.parse(it) }
      if (raw.isNotEmpty() && operations.size != raw.size) {
        return null
      }
      return JournalPayload(transactionId, operations, Json.int(Json.normalize(root["baseRevision"])) ?: 0)
    }
  }
}
