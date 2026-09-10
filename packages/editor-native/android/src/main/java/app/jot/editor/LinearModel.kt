package app.jot.editor

internal const val SCHEMA_VERSION: Int = 1
internal const val OBJECT_REPLACEMENT: Char = '\uFFFC'

internal enum class LinearBlockKind {
  PARAGRAPH,
  HEADING,
  CODE_BLOCK,
  BLOCKQUOTE,
  BULLET_ITEM,
  ORDERED_ITEM,
  TASK_ITEM,
  ATOMIC,
}

internal data class LinearMark(
  val type: String,
  val attrs: Map<String, Any?> = emptyMap(),
)

internal data class LinearRun(
  val textNodeId: String,
  val startUtf16: Int,
  val endUtf16: Int,
  val marks: List<LinearMark>,
)

internal data class LinearInlineAtom(
  val startUtf16: Int,
  val node: Map<String, Any?>,
)

internal data class LinearBlock(
  val kind: LinearBlockKind,
  val nodeId: String,
  val indent: Int = 0,
  val listId: String? = null,
  val listItemId: String? = null,
  val headingLevel: Int = 1,
  val languageId: String = "",
  val orderedStart: Int = 1,
  val orderedIndex: Int = 1,
  val checked: Boolean = false,
  val blockquoteId: String? = null,
  val text: String = "",
  val runs: List<LinearRun> = emptyList(),
  val inlineAtoms: List<LinearInlineAtom> = emptyList(),
  val atomicNode: Map<String, Any?>? = null,
  val attrs: Map<String, Any?> = emptyMap(),
)

internal data class LinearDocument(
  val docId: String,
  val blocks: List<LinearBlock>,
)

internal data class LinearSelection(
  val nodeId: String,
  val offsetUtf16: Int,
  val affinity: String,
  val revision: Int,
)

internal data class BlockDisplay(
  val blockIndex: Int,
  val start: Int,
  val prefixChars: Int,
  val textStart: Int,
  val end: Int,
  val atomDisplay: List<Int>,
)

internal data class DisplayDocument(
  val text: String,
  val blocks: List<BlockDisplay>,
)

internal data class ListContext(
  val listId: String,
  val itemId: String,
  val kind: LinearBlockKind,
  val indent: Int,
  val orderedStart: Int,
  val orderedIndex: Int,
  val checked: Boolean,
)

internal object JotIds {
  private const val ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
  private val random = java.security.SecureRandom()

  fun createId(): String {
    val bytes = ByteArray(16)
    random.nextBytes(bytes)
    return encodeBase32(bytes)
  }

  fun deriveId(parentId: String, purpose: String, index: Int): String {
    val seed = "$parentId|$purpose|$index"
    var h1 = 0x811c9dc5.toInt()
    var h2 = 0x01000193
    var h3 = 0x243f6a88
    var h4 = (0x85a308d3).toInt()
    for (i in seed.indices) {
      val byte = seed[i].code and 0xff
      h1 = mix32(h1, byte, 0x01000193)
      h2 = mix32(h2, byte xor (i and 0xff), 0x811c9dc5.toInt())
      h3 = mix32(h3, (byte + i) and 0xff, 0x1b873593)
      h4 = mix32(h4, byte, 0x9e3779b9.toInt())
    }
    val out = ByteArray(16)
    write32(out, 0, h1)
    write32(out, 4, h2)
    write32(out, 8, h3)
    write32(out, 12, h4)
    return encodeBase32(out)
  }

  fun encodeBase32(bytes: ByteArray): String {
    var bits = 0
    var acc = 0
    val out = StringBuilder()
    for (byte in bytes) {
      acc = (acc shl 8) or (byte.toInt() and 0xff)
      bits += 8
      while (bits >= 5) {
        out.append(ALPHABET[(acc ushr (bits - 5)) and 31])
        bits -= 5
      }
    }
    if (bits > 0) {
      out.append(ALPHABET[(acc shl (5 - bits)) and 31])
    }
    return out.toString()
  }

  private fun mix32(h: Int, byte: Int, mul: Int): Int = (h xor byte) * mul

  private fun write32(out: ByteArray, offset: Int, value: Int) {
    out[offset] = (value and 0xff).toByte()
    out[offset + 1] = ((value ushr 8) and 0xff).toByte()
    out[offset + 2] = ((value ushr 16) and 0xff).toByte()
    out[offset + 3] = ((value ushr 24) and 0xff).toByte()
  }
}

internal object JsonMaps {
  @Suppress("UNCHECKED_CAST")
  fun mapOf(value: Any?): Map<String, Any?> =
    (value as? Map<String, Any?>) ?: emptyMap()

  @Suppress("UNCHECKED_CAST")
  fun listOf(value: Any?): List<Any?> =
    (value as? List<Any?>) ?: emptyList()

  fun string(value: Any?, fallback: String = ""): String =
    value as? String ?: fallback

  fun int(value: Any?, fallback: Int = 0): Int =
    when (value) {
      is Int -> value
      is Long -> value.toInt()
      is Double -> value.toInt()
      is Float -> value.toInt()
      is Number -> value.toInt()
      else -> fallback
    }
}

internal object LinearModel {
  fun fromDocument(root: Map<String, Any?>): LinearDocument {
    val docId = JsonMaps.string(root["id"])
    val blocks = mutableListOf<LinearBlock>()
    flattenBlocks(JsonMaps.listOf(root["content"]), indent = 0, list = null, out = blocks)
    return LinearDocument(docId = docId, blocks = blocks)
  }

  fun toDocument(document: LinearDocument): Map<String, Any?> {
    val content = mutableListOf<Map<String, Any?>>()
    var i = 0
    val blocks = document.blocks
    while (i < blocks.size) {
      val block = blocks[i]
      when {
        isQuoted(block) -> {
          val (quoteNode, consumed) = consumeBlockquote(blocks, i)
          content.add(quoteNode)
          i += consumed
        }
        isListKind(block.kind) -> {
          val (listNode, consumed) = consumeList(blocks, i, minIndent = block.indent)
          content.add(listNode)
          i += consumed
        }
        else -> {
          content.add(textContainerNode(block))
          i += 1
        }
      }
    }
    return mapOf(
      "type" to "doc",
      "id" to document.docId,
      "content" to content,
    )
  }

  fun buildDisplay(document: LinearDocument): DisplayDocument {
    val text = StringBuilder()
    val layouts = mutableListOf<BlockDisplay>()
    document.blocks.forEachIndexed { index, block ->
      if (index > 0) {
        text.append('\n')
      }
      val start = text.length
      val prefixChars = prefixChars(block)
      repeat(prefixChars) { text.append(OBJECT_REPLACEMENT) }
      val textStart = text.length
      val atoms = block.inlineAtoms.sortedBy { it.startUtf16 }
      val atomDisplay = mutableListOf<Int>()
      var cursor = 0
      for (atom in atoms) {
        val at = atom.startUtf16.coerceIn(0, block.text.length)
        text.append(block.text, cursor, at)
        atomDisplay.add(text.length)
        text.append(OBJECT_REPLACEMENT)
        cursor = at
      }
      text.append(block.text, cursor, block.text.length)
      layouts.add(
        BlockDisplay(
          blockIndex = index,
          start = start,
          prefixChars = prefixChars,
          textStart = textStart,
          end = text.length,
          atomDisplay = atomDisplay,
        ),
      )
    }
    return DisplayDocument(text = text.toString(), blocks = layouts)
  }

  fun prefixChars(block: LinearBlock): Int =
    when (block.kind) {
      LinearBlockKind.TASK_ITEM, LinearBlockKind.ATOMIC -> 1
      else -> 0
    }

  fun utf16Length(value: String): Int = value.length

  fun selectionFromDisplay(
    document: LinearDocument,
    display: DisplayDocument,
    displayOffset: Int,
    affinity: String,
    revision: Int,
  ): LinearSelection {
    if (document.blocks.isEmpty()) {
      return LinearSelection(document.docId, 0, affinity, revision)
    }
    val offset = displayOffset.coerceIn(0, display.text.length)
    val layout = display.blocks.lastOrNull { offset >= it.start }
      ?: display.blocks.first()
    val block = document.blocks[layout.blockIndex]
    val nodeId = block.listItemId ?: block.nodeId
    val schemaOffset = displayToSchema(layout, block, offset)
    return LinearSelection(nodeId, schemaOffset, affinity, revision)
  }

  fun displayIndex(
    document: LinearDocument,
    display: DisplayDocument,
    selection: LinearSelection,
  ): Int {
    val index = findBlockIndex(document, selection.nodeId) ?: return 0
    val layout = display.blocks.getOrNull(index) ?: return 0
    val block = document.blocks[index]
    return schemaToDisplay(layout, block, selection.offsetUtf16)
  }

  fun findBlockIndex(document: LinearDocument, nodeId: String): Int? {
    val byNode = document.blocks.indexOfFirst { it.nodeId == nodeId }
    if (byNode >= 0) {
      return byNode
    }
    val byItem = document.blocks.indexOfFirst { it.listItemId == nodeId }
    return if (byItem >= 0) byItem else null
  }

  fun blockAt(document: LinearDocument, nodeId: String): LinearBlock? {
    val index = findBlockIndex(document, nodeId) ?: return null
    return document.blocks[index]
  }

  fun applyOperations(document: LinearDocument, operations: List<Map<String, Any?>>): LinearDocument {
    var current = document
    for (operation in operations) {
      current = applyOperation(current, operation)
    }
    return current
  }

  fun replaceBlockText(
    document: LinearDocument,
    nodeId: String,
    fromUtf16: Int,
    toUtf16: Int,
    inserted: String,
    marks: List<LinearMark>,
  ): LinearDocument {
    val index = findBlockIndex(document, nodeId) ?: return document
    val block = document.blocks[index]
    val start = fromUtf16.coerceIn(0, block.text.length)
    val end = toUtf16.coerceIn(start, block.text.length)
    val newText = block.text.substring(0, start) + inserted + block.text.substring(end)
    val newRuns = replaceRuns(block, start, end, inserted, marks)
    val delta = inserted.length - (end - start)
    val newAtoms = block.inlineAtoms.mapNotNull { atom ->
      when {
        atom.startUtf16 in start until end -> null
        atom.startUtf16 >= end -> atom.copy(startUtf16 = atom.startUtf16 + delta)
        else -> atom
      }
    }
    val updated = block.copy(text = newText, runs = newRuns, inlineAtoms = newAtoms)
    return document.copy(blocks = document.blocks.toMutableList().also { it[index] = updated })
  }

  fun setBlockKind(
    document: LinearDocument,
    nodeId: String,
    kind: LinearBlockKind,
    headingLevel: Int = 1,
    languageId: String = "",
  ): LinearDocument {
    val index = findBlockIndex(document, nodeId) ?: return document
    val block = document.blocks[index]
    val updated = when (kind) {
      LinearBlockKind.BULLET_ITEM ->
        block.copy(
          kind = kind,
          indent = block.indent,
          listId = block.listId ?: JotIds.createId(),
          listItemId = block.listItemId ?: JotIds.createId(),
          headingLevel = 1,
          languageId = "",
        )
      LinearBlockKind.ORDERED_ITEM ->
        block.copy(
          kind = kind,
          listId = block.listId ?: JotIds.createId(),
          listItemId = block.listItemId ?: JotIds.createId(),
          orderedStart = 1,
          orderedIndex = 1,
        )
      LinearBlockKind.TASK_ITEM ->
        block.copy(
          kind = kind,
          listId = block.listId ?: JotIds.createId(),
          listItemId = block.listItemId ?: JotIds.createId(),
          checked = block.checked,
        )
      LinearBlockKind.HEADING ->
        block.copy(
          kind = kind,
          headingLevel = headingLevel.coerceIn(1, 6),
          listId = null,
          listItemId = null,
          indent = 0,
        )
      LinearBlockKind.CODE_BLOCK ->
        block.copy(
          kind = kind,
          languageId = languageId,
          listId = null,
          listItemId = null,
          indent = 0,
          runs = block.runs.map { it.copy(marks = emptyList()) },
        )
      LinearBlockKind.PARAGRAPH ->
        block.copy(
          kind = kind,
          listId = null,
          listItemId = null,
          indent = 0,
          headingLevel = 1,
          languageId = "",
          blockquoteId = null,
        )
      LinearBlockKind.BLOCKQUOTE ->
        block.copy(
          kind = kind,
          blockquoteId = block.blockquoteId ?: JotIds.createId(),
          listId = null,
          listItemId = null,
          indent = 0,
          headingLevel = 1,
          languageId = "",
        )
      LinearBlockKind.ATOMIC -> block
    }
    return document.copy(blocks = document.blocks.toMutableList().also { it[index] = updated })
  }

  fun toggleListKind(document: LinearDocument, nodeId: String, kind: LinearBlockKind): LinearDocument {
    val block = blockAt(document, nodeId) ?: return document
    return if (block.kind == kind) {
      setBlockKind(document, nodeId, LinearBlockKind.PARAGRAPH)
    } else {
      setBlockKind(document, nodeId, kind)
    }
  }

  fun setChecked(document: LinearDocument, nodeId: String, checked: Boolean): LinearDocument {
    val index = findBlockIndex(document, nodeId) ?: return document
    val block = document.blocks[index]
    if (block.kind != LinearBlockKind.TASK_ITEM) {
      return document
    }
    return document.copy(
      blocks = document.blocks.toMutableList().also {
        it[index] = block.copy(checked = checked)
      },
    )
  }

  fun toggleMark(
    document: LinearDocument,
    selection: LinearSelection,
    end: LinearSelection,
    type: String,
    attrs: Map<String, Any?> = emptyMap(),
  ): LinearDocument {
    if (selection.nodeId != end.nodeId) {
      return document
    }
    val start = minOf(selection.offsetUtf16, end.offsetUtf16)
    val stop = maxOf(selection.offsetUtf16, end.offsetUtf16)
    if (start == stop) {
      return document
    }
    val index = findBlockIndex(document, selection.nodeId) ?: return document
    val block = document.blocks[index]
    val covered = block.runs.filter { it.endUtf16 > start && it.startUtf16 < stop }
    val allHave = covered.isNotEmpty() && covered.all { run -> run.marks.any { it.type == type } }
    val newRuns = block.runs.flatMap { run ->
      val overlapStart = maxOf(run.startUtf16, start)
      val overlapEnd = minOf(run.endUtf16, stop)
      if (overlapStart >= overlapEnd) {
        return@flatMap listOf(run)
      }
      val parts = mutableListOf<LinearRun>()
      if (run.startUtf16 < overlapStart) {
        parts.add(run.copy(endUtf16 = overlapStart, textNodeId = run.textNodeId))
      }
      val marks = if (allHave) {
        run.marks.filterNot { it.type == type }
      } else {
        (run.marks.filterNot { it.type == type } + LinearMark(type, attrs))
      }
      parts.add(
        LinearRun(
          textNodeId = run.textNodeId,
          startUtf16 = overlapStart,
          endUtf16 = overlapEnd,
          marks = marks,
        ),
      )
      if (run.endUtf16 > overlapEnd) {
        parts.add(run.copy(startUtf16 = overlapEnd))
      }
      parts
    }
    return document.copy(
      blocks = document.blocks.toMutableList().also {
        it[index] = block.copy(runs = newRuns)
      },
    )
  }

  fun isAllowedHref(href: String): Boolean {
    if (href.isEmpty() || !href[0].isLetter()) {
      return false
    }
    var i = 1
    while (i < href.length) {
      val ch = href[i]
      if (ch == ':') {
        val scheme = href.substring(0, i).lowercase()
        return scheme == "https" || scheme == "http" || scheme == "mailto"
      }
      if (!ch.isLetterOrDigit() && ch != '+' && ch != '.' && ch != '-') {
        return false
      }
      i += 1
    }
    return false
  }

  fun activeMarks(document: LinearDocument, selection: LinearSelection): List<LinearMark> {
    val block = blockAt(document, selection.nodeId) ?: return emptyList()
    val offset = selection.offsetUtf16.coerceIn(0, block.text.length)
    val probe = if (selection.affinity == "before" && offset > 0) offset - 1 else offset
    val run = block.runs.firstOrNull { probe >= it.startUtf16 && probe < it.endUtf16 }
      ?: block.runs.lastOrNull { probe >= it.startUtf16 && probe <= it.endUtf16 }
    return run?.marks ?: emptyList()
  }

  fun sliceText(document: LinearDocument, from: LinearSelection, to: LinearSelection): String {
    if (from.nodeId == to.nodeId) {
      val block = blockAt(document, from.nodeId) ?: return ""
      val start = minOf(from.offsetUtf16, to.offsetUtf16).coerceIn(0, block.text.length)
      val end = maxOf(from.offsetUtf16, to.offsetUtf16).coerceIn(start, block.text.length)
      return block.text.substring(start, end)
    }
    val startIndex = findBlockIndex(document, from.nodeId) ?: return ""
    val endIndex = findBlockIndex(document, to.nodeId) ?: return ""
    val lo = minOf(startIndex, endIndex)
    val hi = maxOf(startIndex, endIndex)
    val parts = mutableListOf<String>()
    for (i in lo..hi) {
      val block = document.blocks[i]
      val start = if (i == lo) from.offsetUtf16.coerceIn(0, block.text.length) else 0
      val end = if (i == hi) to.offsetUtf16.coerceIn(0, block.text.length) else block.text.length
      parts.add(block.text.substring(start.coerceAtMost(end), end.coerceAtLeast(start)))
    }
    return parts.joinToString("")
  }

  fun textSliceNode(text: String, marks: List<LinearMark>, parentId: String): Map<String, Any?> {
    val id = JotIds.deriveId(parentId, "text", 0)
    return mapOf(
      "type" to "text",
      "id" to id,
      "text" to text,
      "marks" to marks.map { markToMap(it) },
    )
  }

  fun selectionMap(selection: LinearSelection): Map<String, Any?> =
    mapOf(
      "nodeId" to selection.nodeId,
      "offsetUtf16" to selection.offsetUtf16,
      "affinity" to selection.affinity,
      "revision" to selection.revision,
    )

  fun parseSelection(value: Any?, fallbackRevision: Int): LinearSelection {
    val map = JsonMaps.mapOf(value)
    return LinearSelection(
      nodeId = JsonMaps.string(map["nodeId"]),
      offsetUtf16 = JsonMaps.int(map["offsetUtf16"]),
      affinity = JsonMaps.string(map["affinity"], "after"),
      revision = JsonMaps.int(map["revision"], fallbackRevision),
    )
  }

  fun markToMap(mark: LinearMark): Map<String, Any?> {
    return if (mark.attrs.isEmpty()) {
      mapOf("type" to mark.type)
    } else {
      mapOf("type" to mark.type, "attrs" to mark.attrs)
    }
  }

  fun insertParagraphAfter(document: LinearDocument, nodeId: String, remaining: String): LinearDocument {
    val index = findBlockIndex(document, nodeId) ?: return document
    val block = document.blocks[index]
    val newId = JotIds.createId()
    val newBlock = LinearBlock(
      kind = when (block.kind) {
        LinearBlockKind.BULLET_ITEM, LinearBlockKind.ORDERED_ITEM, LinearBlockKind.TASK_ITEM -> block.kind
        LinearBlockKind.BLOCKQUOTE -> LinearBlockKind.BLOCKQUOTE
        else -> LinearBlockKind.PARAGRAPH
      },
      nodeId = newId,
      indent = block.indent,
      listId = if (isListKind(block.kind)) (block.listId ?: JotIds.createId()) else null,
      listItemId = if (isListKind(block.kind)) JotIds.createId() else null,
      orderedStart = block.orderedStart,
      orderedIndex = block.orderedIndex + 1,
      checked = false,
      blockquoteId = if (isQuoted(block)) (block.blockquoteId ?: JotIds.createId()) else null,
      text = remaining,
      runs = if (remaining.isEmpty()) emptyList() else listOf(
        LinearRun(JotIds.deriveId(newId, "text", 0), 0, remaining.length, emptyList()),
      ),
    )
    val blocks = document.blocks.toMutableList()
    blocks.add(index + 1, newBlock)
    return document.copy(blocks = blocks)
  }

  fun ensureEditableBlock(document: LinearDocument): LinearDocument {
    if (document.blocks.isNotEmpty()) {
      return document
    }
    val paragraphId = JotIds.deriveId(document.docId, "paragraph", 0)
    return document.copy(
      blocks = listOf(
        LinearBlock(
          kind = LinearBlockKind.PARAGRAPH,
          nodeId = paragraphId,
        ),
      ),
    )
  }

  private fun applyOperation(document: LinearDocument, operation: Map<String, Any?>): LinearDocument {
    return when (JsonMaps.string(operation["type"])) {
      "insertText" -> {
        val position = parseSelection(operation["position"], 0)
        val text = JsonMaps.string(operation["text"])
        val marks = parseMarks(operation["storedMarks"])
        replaceBlockText(document, position.nodeId, position.offsetUtf16, position.offsetUtf16, text, marks)
      }
      "deleteRange" -> {
        val from = parseSelection(operation["from"], 0)
        val to = parseSelection(operation["to"], 0)
        replaceBlockText(document, from.nodeId, from.offsetUtf16, to.offsetUtf16, "", emptyList())
      }
      "replaceRange" -> {
        val from = parseSelection(operation["from"], 0)
        val to = parseSelection(operation["to"], 0)
        val slice = slicePlainText(operation["slice"])
        val sliceMarks = parseMarks(
          JsonMaps.mapOf(JsonMaps.listOf(JsonMaps.mapOf(operation["slice"])["nodes"]).firstOrNull())["marks"],
        )
        val marks = parseMarks(operation["storedMarks"]).ifEmpty { sliceMarks }
        replaceBlockText(document, from.nodeId, from.offsetUtf16, to.offsetUtf16, slice, marks)
      }
      "addMark" -> {
        val range = JsonMaps.mapOf(operation["range"])
        val from = parseSelection(range["from"], 0)
        val to = parseSelection(range["to"], 0)
        val mark = parseMarks(listOf(operation["mark"])).firstOrNull() ?: return document
        applyMark(document, from, to, mark, add = true)
      }
      "removeMark" -> {
        val range = JsonMaps.mapOf(operation["range"])
        val from = parseSelection(range["from"], 0)
        val to = parseSelection(range["to"], 0)
        applyMark(document, from, to, LinearMark(JsonMaps.string(operation["markType"])), add = false)
      }
      "setNodeAttributes" -> {
        val nodeId = JsonMaps.string(operation["nodeId"])
        val patch = JsonMaps.mapOf(operation["patch"])
        var current = document
        val kindName = JsonMaps.string(patch["kind"])
        val listKind = JsonMaps.string(patch["listKind"])
        val typeName = JsonMaps.string(patch["type"])
        when {
          kindName.isNotEmpty() ->
            current = setBlockKind(
              current,
              nodeId,
              blockKind(kindName),
              headingLevel = JsonMaps.int(patch["level"], 1),
              languageId = JsonMaps.string(patch["languageId"]),
            )
          listKind.isNotEmpty() -> current = setBlockKind(current, nodeId, blockKind(listKind))
          typeName == "heading" || patch.containsKey("level") ->
            current = setBlockKind(current, nodeId, LinearBlockKind.HEADING, headingLevel = JsonMaps.int(patch["level"], 1))
          typeName == "codeBlock" ->
            current = setBlockKind(current, nodeId, LinearBlockKind.CODE_BLOCK, languageId = JsonMaps.string(patch["languageId"]))
          typeName == "paragraph" -> current = setBlockKind(current, nodeId, LinearBlockKind.PARAGRAPH)
          typeName == "blockquote" -> current = setBlockKind(current, nodeId, LinearBlockKind.BLOCKQUOTE)
          patch.containsKey("languageId") ->
            current = setBlockKind(current, nodeId, LinearBlockKind.CODE_BLOCK, languageId = JsonMaps.string(patch["languageId"]))
        }
        if (patch.containsKey("checked")) {
          current = setChecked(current, nodeId, JsonMaps.int(patch["checked"]) == 1)
        }
        current
      }
      "insertNode" -> {
        val node = JsonMaps.mapOf(operation["node"])
        val inserted = fromDocument(
          mapOf(
            "type" to "doc",
            "id" to document.docId,
            "content" to listOf(node),
          ),
        ).blocks
        val index = JsonMaps.int(operation["index"]).coerceIn(0, document.blocks.size)
        val blocks = document.blocks.toMutableList()
        blocks.addAll(index, inserted)
        document.copy(blocks = blocks)
      }
      "deleteNode" -> {
        val nodeId = JsonMaps.string(operation["nodeId"])
        document.copy(blocks = document.blocks.filterNot { it.nodeId == nodeId || it.listItemId == nodeId || it.listId == nodeId })
      }
      else -> document
    }
  }

  private fun applyMark(
    document: LinearDocument,
    from: LinearSelection,
    to: LinearSelection,
    mark: LinearMark,
    add: Boolean,
  ): LinearDocument {
    if (from.nodeId != to.nodeId) {
      return document
    }
    val start = minOf(from.offsetUtf16, to.offsetUtf16)
    val stop = maxOf(from.offsetUtf16, to.offsetUtf16)
    if (start == stop) {
      return document
    }
    val index = findBlockIndex(document, from.nodeId) ?: return document
    val block = document.blocks[index]
    val newRuns = block.runs.flatMap { run ->
      val overlapStart = maxOf(run.startUtf16, start)
      val overlapEnd = minOf(run.endUtf16, stop)
      if (overlapStart >= overlapEnd) {
        return@flatMap listOf(run)
      }
      val parts = mutableListOf<LinearRun>()
      if (run.startUtf16 < overlapStart) {
        parts.add(run.copy(endUtf16 = overlapStart))
      }
      val marks = if (add) {
        run.marks.filterNot { it.type == mark.type } + mark
      } else {
        run.marks.filterNot { it.type == mark.type }
      }
      parts.add(run.copy(startUtf16 = overlapStart, endUtf16 = overlapEnd, marks = marks))
      if (run.endUtf16 > overlapEnd) {
        parts.add(run.copy(startUtf16 = overlapEnd))
      }
      parts
    }
    return document.copy(blocks = document.blocks.toMutableList().also { it[index] = block.copy(runs = newRuns) })
  }

  private fun slicePlainText(slice: Any?): String {
    val nodes = JsonMaps.listOf(JsonMaps.mapOf(slice)["nodes"])
    return nodes.joinToString("") { plainText(JsonMaps.mapOf(it)) }
  }

  private fun plainText(node: Map<String, Any?>): String {
    val type = JsonMaps.string(node["type"])
    if (type == "text") {
      return JsonMaps.string(node["text"])
    }
    return JsonMaps.listOf(node["content"]).joinToString("") { plainText(JsonMaps.mapOf(it)) }
  }

  private fun flattenBlocks(
    nodes: List<Any?>,
    indent: Int,
    list: ListContext?,
    out: MutableList<LinearBlock>,
    quoteId: String? = null,
  ) {
    for (nodeAny in nodes) {
      val node = JsonMaps.mapOf(nodeAny)
      when (JsonMaps.string(node["type"])) {
        "paragraph" -> out.add(
          parseTextBlock(
            node,
            if (list != null) list.kind else if (quoteId != null) LinearBlockKind.BLOCKQUOTE else LinearBlockKind.PARAGRAPH,
            indent,
            list,
            quoteId,
          ),
        )
        "heading" -> out.add(
          parseTextBlock(node, LinearBlockKind.HEADING, indent, list, quoteId).copy(
            headingLevel = JsonMaps.int(JsonMaps.mapOf(node["attrs"])["level"], 1).coerceIn(1, 6),
          ),
        )
        "codeBlock" -> {
          val parsed = parseTextBlock(node, LinearBlockKind.CODE_BLOCK, indent, list, quoteId)
          out.add(
            parsed.copy(
              languageId = JsonMaps.string(JsonMaps.mapOf(node["attrs"])["languageId"]),
              runs = parsed.runs.map { it.copy(marks = emptyList()) },
            ),
          )
        }
        "blockquote" -> {
          val id = JsonMaps.string(node["id"])
          val children = JsonMaps.listOf(node["content"])
          if (children.isEmpty()) {
            out.add(
              LinearBlock(
                kind = LinearBlockKind.BLOCKQUOTE,
                nodeId = JotIds.deriveId(id, "paragraph", 0),
                indent = list?.indent ?: indent,
                listId = list?.listId,
                listItemId = list?.itemId,
                blockquoteId = id,
              ),
            )
          } else {
            flattenBlocks(children, indent, list, out, quoteId = id)
          }
        }
        "bulletList" -> flattenList(node, indent, LinearBlockKind.BULLET_ITEM, out, quoteId)
        "orderedList" -> flattenList(node, indent, LinearBlockKind.ORDERED_ITEM, out, quoteId)
        "taskList" -> flattenList(node, indent, LinearBlockKind.TASK_ITEM, out, quoteId)
        else -> out.add(
          LinearBlock(
            kind = LinearBlockKind.ATOMIC,
            nodeId = JsonMaps.string(node["id"]),
            indent = indent,
            listId = list?.listId,
            listItemId = list?.itemId,
            blockquoteId = quoteId,
            atomicNode = node,
            attrs = JsonMaps.mapOf(node["attrs"]),
          ),
        )
      }
    }
  }

  private fun flattenList(
    list: Map<String, Any?>,
    indent: Int,
    kind: LinearBlockKind,
    out: MutableList<LinearBlock>,
    quoteId: String? = null,
  ) {
    val listId = JsonMaps.string(list["id"])
    val start = JsonMaps.int(JsonMaps.mapOf(list["attrs"])["start"], 1).coerceAtLeast(1)
    var index = start
    for (itemAny in JsonMaps.listOf(list["content"])) {
      val item = JsonMaps.mapOf(itemAny)
      val itemId = JsonMaps.string(item["id"])
      val checked = JsonMaps.int(JsonMaps.mapOf(item["attrs"])["checked"]) == 1
      val ctx = ListContext(listId, itemId, kind, indent, start, index, checked)
      val children = JsonMaps.listOf(item["content"])
      var emitted = false
      for (childAny in children) {
        val child = JsonMaps.mapOf(childAny)
        when (JsonMaps.string(child["type"])) {
          "bulletList" -> flattenList(child, indent + 1, LinearBlockKind.BULLET_ITEM, out, quoteId)
          "orderedList" -> flattenList(child, indent + 1, LinearBlockKind.ORDERED_ITEM, out, quoteId)
          "taskList" -> flattenList(child, indent + 1, LinearBlockKind.TASK_ITEM, out, quoteId)
          else -> {
            flattenBlocks(listOf(child), indent, ctx, out, quoteId)
            emitted = true
          }
        }
      }
      if (!emitted) {
        out.add(
          LinearBlock(
            kind = kind,
            nodeId = itemId,
            indent = indent,
            listId = listId,
            listItemId = itemId,
            orderedStart = start,
            orderedIndex = index,
            checked = checked,
            blockquoteId = quoteId,
          ),
        )
      }
      index += 1
    }
  }

  private fun parseTextBlock(
    node: Map<String, Any?>,
    kind: LinearBlockKind,
    indent: Int,
    list: ListContext?,
    quoteId: String? = null,
  ): LinearBlock {
    val (text, runs, atoms) = parseInlines(JsonMaps.listOf(node["content"]))
    return LinearBlock(
      kind = kind,
      nodeId = JsonMaps.string(node["id"]),
      indent = list?.indent ?: indent,
      listId = list?.listId,
      listItemId = list?.itemId,
      orderedStart = list?.orderedStart ?: 1,
      orderedIndex = list?.orderedIndex ?: 1,
      checked = list?.checked ?: false,
      blockquoteId = quoteId,
      text = text,
      runs = runs,
      inlineAtoms = atoms,
      attrs = JsonMaps.mapOf(node["attrs"]),
    )
  }

  private fun parseInlines(content: List<Any?>): Triple<String, List<LinearRun>, List<LinearInlineAtom>> {
    val text = StringBuilder()
    val runs = mutableListOf<LinearRun>()
    val atoms = mutableListOf<LinearInlineAtom>()
    for (childAny in content) {
      val node = JsonMaps.mapOf(childAny)
      when (JsonMaps.string(node["type"])) {
        "text" -> {
          val value = JsonMaps.string(node["text"])
          val start = text.length
          text.append(value)
          runs.add(
            LinearRun(
              textNodeId = JsonMaps.string(node["id"]),
              startUtf16 = start,
              endUtf16 = text.length,
              marks = parseMarks(node["marks"]),
            ),
          )
        }
        else -> atoms.add(LinearInlineAtom(startUtf16 = text.length, node = node))
      }
    }
    return Triple(text.toString(), runs, atoms)
  }

  private fun parseMarks(value: Any?): List<LinearMark> =
    JsonMaps.listOf(value).map { item ->
      val mark = JsonMaps.mapOf(item)
      LinearMark(
        type = JsonMaps.string(mark["type"]),
        attrs = JsonMaps.mapOf(mark["attrs"]),
      )
    }

  private fun consumeBlockquote(blocks: List<LinearBlock>, start: Int): Pair<Map<String, Any?>, Int> {
    val first = blocks[start]
    val quoteId = first.blockquoteId ?: JotIds.createId()
    val inner = mutableListOf<Map<String, Any?>>()
    var i = start
    while (i < blocks.size) {
      val block = blocks[i]
      if (block.blockquoteId != quoteId) {
        break
      }
      if (isListKind(block.kind)) {
        val (listNode, consumed) = consumeList(blocks, i, minIndent = block.indent)
        inner.add(listNode)
        i += consumed
      } else {
        val emitted = when (block.kind) {
          LinearBlockKind.BLOCKQUOTE -> block.copy(kind = LinearBlockKind.PARAGRAPH, blockquoteId = null)
          else -> block.copy(blockquoteId = null)
        }
        inner.add(textContainerNode(emitted))
        i += 1
      }
    }
    return mapOf(
      "type" to "blockquote",
      "id" to quoteId,
      "content" to inner,
    ) to (i - start)
  }

  private fun consumeList(blocks: List<LinearBlock>, start: Int, minIndent: Int): Pair<Map<String, Any?>, Int> {
    val first = blocks[start]
    val listType = when (first.kind) {
      LinearBlockKind.ORDERED_ITEM -> "orderedList"
      LinearBlockKind.TASK_ITEM -> "taskList"
      else -> "bulletList"
    }
    val itemType = if (first.kind == LinearBlockKind.TASK_ITEM) "taskItem" else "listItem"
    val items = mutableListOf<Map<String, Any?>>()
    var i = start
    while (i < blocks.size) {
      val block = blocks[i]
      if (!isListKind(block.kind) || block.indent < minIndent) {
        break
      }
      if (block.indent > minIndent) {
        break
      }
      if (block.kind != first.kind) {
        break
      }
      if (first.listId != null && block.listId != null && block.listId != first.listId) {
        break
      }
      if (first.blockquoteId != null && block.blockquoteId != first.blockquoteId) {
        break
      }
      val itemId = block.listItemId ?: block.nodeId
      val children = mutableListOf<Map<String, Any?>>()
      while (i < blocks.size && blocks[i].indent == minIndent && (blocks[i].listItemId ?: blocks[i].nodeId) == itemId) {
        children.add(textContainerNode(blocks[i].copy(kind = LinearBlockKind.PARAGRAPH, listId = null, listItemId = null)))
        i += 1
      }
      if (i < blocks.size && isListKind(blocks[i].kind) && blocks[i].indent > minIndent) {
        val (nested, consumed) = consumeList(blocks, i, blocks[i].indent)
        children.add(nested)
        i += consumed
      }
      val item = mutableMapOf<String, Any?>(
        "type" to itemType,
        "id" to itemId,
        "content" to children,
      )
      if (itemType == "taskItem") {
        item["attrs"] = mapOf("checked" to if (block.checked) 1 else 0)
      }
      items.add(item)
    }
    val list = mutableMapOf<String, Any?>(
      "type" to listType,
      "id" to (first.listId ?: JotIds.createId()),
      "content" to items,
    )
    if (listType == "orderedList") {
      list["attrs"] = mapOf("start" to first.orderedStart)
    }
    return list to (i - start)
  }

  private fun textContainerNode(block: LinearBlock): Map<String, Any?> {
    if (block.kind == LinearBlockKind.ATOMIC) {
      return block.atomicNode ?: mapOf("type" to "paragraph", "id" to block.nodeId, "content" to emptyList<Any>())
    }
    val content = inlinesToContent(block)
    return when (block.kind) {
      LinearBlockKind.HEADING -> mapOf(
        "type" to "heading",
        "id" to block.nodeId,
        "attrs" to mapOf("level" to block.headingLevel),
        "content" to content,
      )
      LinearBlockKind.CODE_BLOCK -> {
        val node = mutableMapOf<String, Any?>(
          "type" to "codeBlock",
          "id" to block.nodeId,
          "content" to content,
        )
        if (block.languageId.isNotEmpty()) {
          node["attrs"] = mapOf("languageId" to block.languageId)
        }
        node
      }
      LinearBlockKind.BLOCKQUOTE -> mapOf(
        "type" to "paragraph",
        "id" to block.nodeId,
        "content" to content,
      )
      else -> mapOf(
        "type" to "paragraph",
        "id" to block.nodeId,
        "content" to content,
      )
    }
  }

  private fun inlinesToContent(block: LinearBlock): List<Map<String, Any?>> {
    val atoms = block.inlineAtoms.sortedBy { it.startUtf16 }
    val content = mutableListOf<Map<String, Any?>>()
    var cursor = 0
    val runs = if (block.runs.isEmpty() && block.text.isNotEmpty()) {
      listOf(LinearRun(JotIds.deriveId(block.nodeId, "text", 0), 0, block.text.length, emptyList()))
    } else {
      block.runs
    }
    fun emitText(from: Int, to: Int) {
      if (from >= to) {
        return
      }
      var cursor = from
      val covering = runs.filter { it.endUtf16 > from && it.startUtf16 < to }.sortedBy { it.startUtf16 }
      if (covering.isEmpty()) {
        content.add(
          mapOf(
            "type" to "text",
            "id" to JotIds.deriveId(block.nodeId, "text", from),
            "text" to block.text.substring(from, to),
            "marks" to emptyList<Map<String, Any?>>(),
          ),
        )
        return
      }
      for (run in covering) {
        val start = maxOf(run.startUtf16, from)
        val end = minOf(run.endUtf16, to)
        if (cursor < start) {
          content.add(
            mapOf(
              "type" to "text",
              "id" to JotIds.deriveId(block.nodeId, "text", cursor),
              "text" to block.text.substring(cursor, start),
              "marks" to emptyList<Map<String, Any?>>(),
            ),
          )
        }
        content.add(
          mapOf(
            "type" to "text",
            "id" to run.textNodeId,
            "text" to block.text.substring(start, end),
            "marks" to run.marks.map { markToMap(it) },
          ),
        )
        cursor = end
      }
      if (cursor < to) {
        content.add(
          mapOf(
            "type" to "text",
            "id" to JotIds.deriveId(block.nodeId, "text", cursor),
            "text" to block.text.substring(cursor, to),
            "marks" to emptyList<Map<String, Any?>>(),
          ),
        )
      }
    }
    for (atom in atoms) {
      val at = atom.startUtf16.coerceIn(0, block.text.length)
      emitText(cursor, at)
      content.add(atom.node)
      cursor = at
    }
    emitText(cursor, block.text.length)
    return content
  }

  private fun replaceRuns(
    block: LinearBlock,
    start: Int,
    end: Int,
    inserted: String,
    marks: List<LinearMark>,
  ): List<LinearRun> {
    val delta = inserted.length - (end - start)
    val kept = mutableListOf<LinearRun>()
    for (run in block.runs) {
      when {
        run.endUtf16 <= start -> kept.add(run)
        run.startUtf16 >= end -> kept.add(run.copy(startUtf16 = run.startUtf16 + delta, endUtf16 = run.endUtf16 + delta))
        else -> {
          if (run.startUtf16 < start) {
            kept.add(run.copy(endUtf16 = start))
          }
          if (run.endUtf16 > end) {
            kept.add(
              run.copy(
                startUtf16 = start + inserted.length,
                endUtf16 = run.endUtf16 + delta,
              ),
            )
          }
        }
      }
    }
    if (inserted.isNotEmpty()) {
      val parent = block.nodeId
      kept.add(
        LinearRun(
          textNodeId = JotIds.deriveId(parent, "text", start),
          startUtf16 = start,
          endUtf16 = start + inserted.length,
          marks = marks,
        ),
      )
    }
    return kept.sortedBy { it.startUtf16 }
  }

  private fun displayToSchema(layout: BlockDisplay, block: LinearBlock, displayOffset: Int): Int {
    val local = (displayOffset - layout.textStart).coerceAtLeast(0)
    var schema = 0
    var display = 0
    var atomIndex = 0
    while (display < local && schema < block.text.length) {
      if (atomIndex < layout.atomDisplay.size && layout.atomDisplay[atomIndex] - layout.textStart == display) {
        display += 1
        atomIndex += 1
        continue
      }
      schema += 1
      display += 1
    }
    return schema.coerceIn(0, block.text.length)
  }

  private fun schemaToDisplay(layout: BlockDisplay, block: LinearBlock, schemaOffset: Int): Int {
    val offset = schemaOffset.coerceIn(0, block.text.length)
    val atomsBefore = block.inlineAtoms.count { it.startUtf16 < offset } +
      block.inlineAtoms.count { it.startUtf16 == offset }
    return layout.textStart + offset + atomsBefore.coerceAtMost(block.inlineAtoms.size)
  }

  internal fun isListKind(kind: LinearBlockKind): Boolean =
    kind == LinearBlockKind.BULLET_ITEM ||
      kind == LinearBlockKind.ORDERED_ITEM ||
      kind == LinearBlockKind.TASK_ITEM

  internal fun isQuoted(block: LinearBlock): Boolean =
    block.kind == LinearBlockKind.BLOCKQUOTE || block.blockquoteId != null

  internal fun blockKind(name: String): LinearBlockKind =
    when (name) {
      "HEADING", "heading" -> LinearBlockKind.HEADING
      "CODE_BLOCK", "codeBlock" -> LinearBlockKind.CODE_BLOCK
      "BLOCKQUOTE", "blockquote" -> LinearBlockKind.BLOCKQUOTE
      "BULLET_ITEM", "bulletList", "bulletItem", "bullet" -> LinearBlockKind.BULLET_ITEM
      "ORDERED_ITEM", "orderedList", "orderedItem", "ordered" -> LinearBlockKind.ORDERED_ITEM
      "TASK_ITEM", "taskList", "taskItem", "task" -> LinearBlockKind.TASK_ITEM
      "ATOMIC" -> LinearBlockKind.ATOMIC
      else -> LinearBlockKind.PARAGRAPH
    }
}
