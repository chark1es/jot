package app.jot.editor

internal const val SCHEMA_VERSION: Int = 1
internal const val OBJECT_REPLACEMENT: String = "\uFFFC"
internal const val LINE_SEPARATOR: String = "\u2028"

internal typealias LinearMark = SchemaMark

internal data class LinearRun(
  val text: String,
  val marks: List<LinearMark> = emptyList(),
  val id: String? = null,
  val placeholderNode: SchemaNode? = null,
  val fallbackText: String = "",
) {
  val isPlaceholder: Boolean
    get() = placeholderNode != null

  val utf16Length: Int
    get() = if (isPlaceholder) 1 else text.length
}

internal enum class LinearBlockKind(val rawValue: String) {
  PARAGRAPH("paragraph"),
  HEADING("heading"),
  CODE_BLOCK("codeBlock"),
  BULLET_ITEM("bulletItem"),
  ORDERED_ITEM("orderedItem"),
  TASK_ITEM("taskItem"),
  PLACEHOLDER("placeholder"),
  HORIZONTAL_RULE("horizontalRule"),
  IMAGE("image"),
}

/**
 * One line of the editor: a paragraph, heading, code block, list item, or atomic block.
 * `id` is the list item for list kinds; `paragraphId` is the paragraph inside it that holds the text.
 */
internal data class LinearBlock(
  val id: String,
  val kind: LinearBlockKind,
  val headingLevel: Int? = null,
  val listStart: Int? = null,
  val checked: Int? = null,
  val indent: Int = 0,
  val runs: List<LinearRun> = emptyList(),
  val languageId: String? = null,
  val paragraphId: String? = null,
  val listId: String? = null,
  val quoteChain: List<String> = emptyList(),
  val placeholderNode: SchemaNode? = null,
) {
  val quoteDepth: Int
    get() = quoteChain.size

  val utf16Length: Int
    get() = runs.sumOf { it.utf16Length }

  val plainText: String
    get() = runs.joinToString("") { if (it.isPlaceholder) it.fallbackText else it.text }

  /** The id selections name: the paragraph for list items, the block itself otherwise. */
  val textNodeId: String
    get() = paragraphId ?: id

  fun markTypes(offset: Int): List<LinearMark> {
    var remaining = offset
    for (run in runs) {
      val length = run.utf16Length
      if (remaining <= length) {
        return run.marks
      }
      remaining -= length
    }
    return runs.lastOrNull()?.marks ?: emptyList()
  }
}

internal data class LinearDocument(
  val id: String,
  val blocks: List<LinearBlock>,
)

internal class LinearException(message: String) : Exception(message)

/** Kotlin port of `LinearModel.swift`. Both platforms must produce the same operations and trees. */
internal object LinearModel {
  fun documentToLinear(doc: SchemaNode): LinearDocument {
    val blocks = mutableListOf<LinearBlock>()
    flatten(doc.content, indent = 0, quoteChain = emptyList(), into = blocks)
    return LinearDocument(doc.id, blocks)
  }

  /** Same derivation as `emptyDocument` in TypeScript, so the first keystroke in an empty note targets an id every layer agrees on. */
  fun bodyParagraphId(docId: String): String = JotIds.deriveId(docId, "paragraph", 0)

  fun withEditableBody(linear: LinearDocument): LinearDocument {
    if (linear.blocks.isNotEmpty()) {
      return linear
    }
    return linear.copy(blocks = listOf(LinearBlock(id = bodyParagraphId(linear.id), kind = LinearBlockKind.PARAGRAPH)))
  }

  fun linearToDocument(linear: LinearDocument): SchemaNode =
    SchemaNode(type = "doc", id = linear.id, content = nestBlocks(linear.blocks, 0, minIndent = 0).first)

  fun apply(operations: List<SchemaOperation>, linear: LinearDocument): LinearDocument {
    var current = linear
    for (operation in operations) {
      current = apply(operation, current)
    }
    return current
  }

  fun apply(operation: SchemaOperation, linear: LinearDocument): LinearDocument =
    when (operation) {
      is SchemaOperation.InsertText -> {
        if (Utf16.hasUnpairedSurrogates(operation.text)) {
          throw LinearException("unpaired surrogate")
        }
        insertText(operation.text, operation.position, operation.storedMarks, linear)
      }
      is SchemaOperation.DeleteRange -> deleteRange(operation.from, operation.to, linear)
      is SchemaOperation.ReplaceRange -> {
        val deleted = deleteRange(operation.from, operation.to, linear)
        val text = operation.slice.joinToString("") { it.plainText() }
        insertText(text, operation.from, firstMarks(operation.slice), deleted)
      }
      is SchemaOperation.AddMark -> applyMark(operation.mark, operation.from, operation.to, add = true, linear = linear)
      is SchemaOperation.RemoveMark -> applyMark(LinearMark(operation.markType), operation.from, operation.to, add = false, linear = linear)
      is SchemaOperation.SetNodeAttributes -> setAttributes(operation.nodeId, operation.patch, linear)
      is SchemaOperation.InsertNode ->
        documentToLinear(insertNode(operation.node, operation.parentId, operation.index, linearToDocument(linear)))
      is SchemaOperation.DeleteNode -> documentToLinear(deleteNode(operation.nodeId, linearToDocument(linear)))
    }

  fun indexOfBlock(nodeId: String, linear: LinearDocument): Int? {
    val index = linear.blocks.indexOfFirst { it.id == nodeId || it.paragraphId == nodeId }
    return if (index >= 0) index else null
  }

  fun block(nodeId: String, linear: LinearDocument): LinearBlock? = indexOfBlock(nodeId, linear)?.let { linear.blocks[it] }

  fun isListKind(kind: LinearBlockKind): Boolean =
    kind == LinearBlockKind.BULLET_ITEM || kind == LinearBlockKind.ORDERED_ITEM || kind == LinearBlockKind.TASK_ITEM

  fun isAtomicKind(kind: LinearBlockKind): Boolean =
    kind == LinearBlockKind.HORIZONTAL_RULE || kind == LinearBlockKind.IMAGE || kind == LinearBlockKind.PLACEHOLDER

  /** Characters drawn before a block's text: a quote bar, then a bullet, number, or checkbox. */
  fun leadingCount(block: LinearBlock): Int = (if (isListKind(block.kind)) 1 else 0) + (if (block.quoteChain.isEmpty()) 0 else 1)

  fun parentLocation(nodeId: String, tree: SchemaNode): Pair<String, Int>? {
    tree.content.forEachIndexed { index, child ->
      if (child.id == nodeId) {
        return tree.id to index
      }
      val nested = parentLocation(nodeId, child)
      if (nested != null) {
        return nested
      }
    }
    return null
  }

  /** Index of the top-level document child that contains `nodeId`. */
  fun topLevelIndex(nodeId: String, tree: SchemaNode): Int? {
    val index = tree.content.indexOfFirst { contains(it, nodeId) }
    return if (index >= 0) index else null
  }

  fun contains(node: SchemaNode, nodeId: String): Boolean = node.id == nodeId || node.content.any { contains(it, nodeId) }

  fun findNode(nodeId: String, tree: SchemaNode): SchemaNode? {
    if (tree.id == nodeId) {
      return tree
    }
    for (child in tree.content) {
      val found = findNode(nodeId, child)
      if (found != null) {
        return found
      }
    }
    return null
  }

  fun textNode(text: String, marks: List<LinearMark>): SchemaNode =
    SchemaNode(type = "text", id = JotIds.createId(), text = text, marks = marks)

  /** Runs covering `[from, to)` of a block, cut at the range edges, with their marks kept. */
  fun sliceRuns(block: LinearBlock, from: Int, to: Int): List<LinearRun> {
    val start = maxOf(0, minOf(from, to))
    val end = maxOf(from, to)
    var offset = 0
    val result = mutableListOf<LinearRun>()
    for (run in block.runs) {
      val length = run.utf16Length
      val runStart = offset
      val runEnd = offset + length
      offset = runEnd
      if (runEnd <= start || runStart >= end) {
        continue
      }
      if (run.isPlaceholder) {
        result.add(run)
        continue
      }
      val lower = maxOf(start, runStart) - runStart
      val upper = minOf(end, runEnd) - runStart
      result.add(LinearRun(Utf16.slice(run.text, lower, upper - lower), run.marks, run.id))
    }
    return result
  }

  /** True when every character of text between the two carets carries `type`. */
  fun rangeHasMark(type: String, from: SchemaSelection, to: SchemaSelection, linear: LinearDocument): Boolean {
    val fromIndex = indexOfBlock(from.nodeId, linear) ?: return false
    val toIndex = indexOfBlock(to.nodeId, linear) ?: return false
    var sawText = false
    for (i in minOf(fromIndex, toIndex)..maxOf(fromIndex, toIndex)) {
      val block = linear.blocks[i]
      val lower = if (i == fromIndex) from.offsetUtf16 else 0
      val upper = if (i == toIndex) to.offsetUtf16 else block.utf16Length
      for (run in sliceRuns(block, lower, upper)) {
        if (run.isPlaceholder || run.text.isEmpty()) {
          continue
        }
        sawText = true
        if (run.marks.none { it.type == type }) {
          return false
        }
      }
    }
    return sawText
  }

  /**
   * Inverse operations for `operations` applied to `before`, in the order they must run.
   * Null means an operation joined or split blocks, and undo has to restore a snapshot instead.
   */
  fun invert(operations: List<SchemaOperation>, before: LinearDocument): List<SchemaOperation>? {
    var state = before
    val groups = mutableListOf<List<SchemaOperation>>()
    for (operation in operations) {
      val inverse = invertOne(operation, state) ?: return null
      groups.add(inverse)
      state = try {
        apply(operation, state)
      } catch (_: LinearException) {
        return null
      }
    }
    return groups.reversed().flatten()
  }

  private fun invertOne(operation: SchemaOperation, linear: LinearDocument): List<SchemaOperation>? =
    when (operation) {
      is SchemaOperation.InsertText -> {
        var start = operation.position
        if (linear.blocks.isEmpty() && (start.nodeId.isEmpty() || start.nodeId == linear.id)) {
          start = start.copy(nodeId = bodyParagraphId(linear.id))
        }
        if (linear.blocks.isNotEmpty() && indexOfBlock(start.nodeId, linear) == null) {
          null
        } else {
          val end = start.copy(offsetUtf16 = start.offsetUtf16 + operation.text.length, affinity = "after")
          listOf(SchemaOperation.DeleteRange(start, end, listOf(textNode(operation.text, operation.storedMarks))))
        }
      }
      is SchemaOperation.DeleteRange -> {
        val index = indexOfBlock(operation.from.nodeId, linear)
        if (index == null || indexOfBlock(operation.to.nodeId, linear) != index) {
          null
        } else {
          reinsert(sliceRuns(linear.blocks[index], operation.from.offsetUtf16, operation.to.offsetUtf16), operation.from)
        }
      }
      is SchemaOperation.ReplaceRange -> {
        val index = indexOfBlock(operation.from.nodeId, linear)
        val restore = if (index == null || indexOfBlock(operation.to.nodeId, linear) != index) {
          null
        } else {
          reinsert(sliceRuns(linear.blocks[index], operation.from.offsetUtf16, operation.to.offsetUtf16), operation.from)
        }
        if (restore == null) {
          null
        } else {
          val insertedLength = operation.slice.joinToString("") { it.plainText() }.length
          if (insertedLength == 0) {
            restore
          } else {
            val end = operation.from.copy(offsetUtf16 = operation.from.offsetUtf16 + insertedLength, affinity = "after")
            listOf(SchemaOperation.DeleteRange(operation.from, end, operation.slice)) + restore
          }
        }
      }
      is SchemaOperation.AddMark -> restoreMarks(operation.mark.type, operation.from, operation.to, linear, removeFirst = true)
      is SchemaOperation.RemoveMark -> restoreMarks(operation.markType, operation.from, operation.to, linear, removeFirst = false)
      is SchemaOperation.SetNodeAttributes ->
        listOf(SchemaOperation.SetNodeAttributes(operation.nodeId, operation.priorValues, operation.patch))
      is SchemaOperation.InsertNode -> listOf(SchemaOperation.DeleteNode(operation.node.id, operation.node))
      is SchemaOperation.DeleteNode -> {
        val tree = linearToDocument(linear)
        val location = parentLocation(operation.nodeId, tree)
        val node = findNode(operation.nodeId, tree)
        if (location == null || node == null) {
          null
        } else {
          listOf(SchemaOperation.InsertNode(location.first, location.second, node))
        }
      }
    }

  private fun reinsert(runs: List<LinearRun>, position: SchemaSelection): List<SchemaOperation>? {
    val operations = mutableListOf<SchemaOperation>()
    var offset = position.offsetUtf16
    for (run in runs) {
      if (run.isPlaceholder || run.text.contains(LINE_SEPARATOR)) {
        return null
      }
      if (run.text.isEmpty()) {
        continue
      }
      operations.add(SchemaOperation.InsertText(position.copy(offsetUtf16 = offset), run.text, run.marks))
      offset += run.text.length
    }
    return operations
  }

  private fun restoreMarks(
    type: String,
    from: SchemaSelection,
    to: SchemaSelection,
    linear: LinearDocument,
    removeFirst: Boolean,
  ): List<SchemaOperation>? {
    val fromIndex = indexOfBlock(from.nodeId, linear) ?: return null
    val toIndex = indexOfBlock(to.nodeId, linear) ?: return null
    val operations = mutableListOf<SchemaOperation>()
    if (removeFirst) {
      operations.add(SchemaOperation.RemoveMark(from, to, type))
    }
    for (i in minOf(fromIndex, toIndex)..maxOf(fromIndex, toIndex)) {
      val block = linear.blocks[i]
      val lower = if (i == fromIndex) from.offsetUtf16 else 0
      val upper = if (i == toIndex) to.offsetUtf16 else block.utf16Length
      var offset = maxOf(0, minOf(lower, upper))
      for (run in sliceRuns(block, lower, upper)) {
        val length = run.utf16Length
        val mark = run.marks.firstOrNull { it.type == type }
        if (mark != null) {
          operations.add(
            SchemaOperation.AddMark(
              SchemaSelection(block.textNodeId, offset, "after", from.revision),
              SchemaSelection(block.textNodeId, offset + length, "before", from.revision),
              mark,
            ),
          )
        }
        offset += length
      }
    }
    return operations
  }

  // Tree to linear

  private fun flatten(nodes: List<SchemaNode>, indent: Int, quoteChain: List<String>, into: MutableList<LinearBlock>) {
    for (node in nodes) {
      when (node.type) {
        "paragraph" -> into.add(
          LinearBlock(id = node.id, kind = LinearBlockKind.PARAGRAPH, indent = indent, runs = inlineRuns(node.content), quoteChain = quoteChain),
        )
        "heading" -> into.add(
          LinearBlock(
            id = node.id,
            kind = LinearBlockKind.HEADING,
            headingLevel = Json.int(node.attrs["level"]) ?: 1,
            indent = indent,
            runs = inlineRuns(node.content),
            quoteChain = quoteChain,
          ),
        )
        "codeBlock" -> into.add(
          LinearBlock(
            id = node.id,
            kind = LinearBlockKind.CODE_BLOCK,
            indent = indent,
            runs = node.content.map { LinearRun(if (it.type == "text") it.text ?: "" else it.plainText(), id = it.id) },
            languageId = Json.str(node.attrs["languageId"]) ?: "",
            quoteChain = quoteChain,
          ),
        )
        "blockquote" -> flatten(node.content, indent, quoteChain + node.id, into)
        "horizontalRule" -> into.add(
          LinearBlock(
            id = node.id,
            kind = LinearBlockKind.HORIZONTAL_RULE,
            indent = indent,
            runs = listOf(LinearRun(OBJECT_REPLACEMENT, id = node.id, fallbackText = "divider")),
            quoteChain = quoteChain,
          ),
        )
        "image" -> into.add(
          LinearBlock(
            id = node.id,
            kind = LinearBlockKind.IMAGE,
            indent = indent,
            runs = listOf(
              LinearRun(OBJECT_REPLACEMENT, id = node.id, placeholderNode = node, fallbackText = Json.str(node.attrs["alt"]) ?: ""),
            ),
            quoteChain = quoteChain,
            placeholderNode = node,
          ),
        )
        "bulletList" -> flattenList(node, LinearBlockKind.BULLET_ITEM, indent, quoteChain, into)
        "orderedList" -> flattenList(node, LinearBlockKind.ORDERED_ITEM, indent, quoteChain, into)
        "taskList" -> flattenList(node, LinearBlockKind.TASK_ITEM, indent, quoteChain, into)
        else -> into.add(
          LinearBlock(
            id = node.id,
            kind = LinearBlockKind.PLACEHOLDER,
            indent = indent,
            runs = listOf(LinearRun(OBJECT_REPLACEMENT, id = node.id, placeholderNode = node, fallbackText = node.plainText())),
            quoteChain = quoteChain,
            placeholderNode = node,
          ),
        )
      }
    }
  }

  private fun flattenList(
    list: SchemaNode,
    kind: LinearBlockKind,
    indent: Int,
    quoteChain: List<String>,
    into: MutableList<LinearBlock>,
  ) {
    val start = Json.int(list.attrs["start"])
    list.content.forEachIndexed { index, item ->
      val runs = mutableListOf<LinearRun>()
      var paragraphId: String? = null
      val nested = mutableListOf<SchemaNode>()
      for (child in item.content) {
        when (child.type) {
          "paragraph" -> {
            if (paragraphId == null) {
              paragraphId = child.id
            } else {
              runs.add(LinearRun("\n"))
            }
            runs.addAll(inlineRuns(child.content))
          }
          "listItem", "taskItem" -> Unit
          else -> nested.add(child)
        }
      }
      into.add(
        LinearBlock(
          id = item.id,
          kind = kind,
          listStart = if (index == 0) start else null,
          checked = Json.int(item.attrs["checked"]),
          indent = indent,
          runs = runs,
          paragraphId = paragraphId,
          listId = list.id,
          quoteChain = quoteChain,
        ),
      )
      flatten(nested, indent + 1, quoteChain, into)
    }
  }

  private fun inlineRuns(nodes: List<SchemaNode>): List<LinearRun> =
    nodes.map { node ->
      when (node.type) {
        "text" -> LinearRun(node.text ?: "", node.marks, node.id)
        "hardBreak" -> LinearRun(LINE_SEPARATOR, id = node.id)
        else -> LinearRun(OBJECT_REPLACEMENT, id = node.id, placeholderNode = node, fallbackText = node.plainText())
      }
    }

  // Linear to tree

  private fun nestBlocks(
    blocks: List<LinearBlock>,
    start: Int,
    minIndent: Int,
    minQuote: Int = 0,
    expectedQuote: String? = null,
  ): Pair<List<SchemaNode>, Int> {
    val nodes = mutableListOf<SchemaNode>()
    var i = start
    while (i < blocks.size) {
      val block = blocks[i]
      if (block.indent < minIndent) {
        break
      }
      if (expectedQuote != null) {
        if (block.quoteChain.size < minQuote) {
          break
        }
        if (minQuote > 0 && block.quoteChain[minQuote - 1] != expectedQuote) {
          break
        }
      } else if (minQuote > 0 && block.quoteChain.size < minQuote) {
        break
      }
      if (block.quoteChain.size > minQuote) {
        val quoteId = block.quoteChain[minQuote]
        val parsed = nestBlocks(blocks, i, minIndent, minQuote + 1, quoteId)
        nodes.add(SchemaNode(type = "blockquote", id = quoteId, content = parsed.first))
        i = parsed.second
        continue
      }
      if (isListKind(block.kind)) {
        val parsed = parseList(blocks, i, block.indent, block.kind, minQuote, expectedQuote)
        nodes.add(parsed.first)
        i = parsed.second
      } else {
        nodes.add(blockToNode(block))
        i += 1
      }
    }
    return nodes to i
  }

  private fun parseList(
    blocks: List<LinearBlock>,
    start: Int,
    indent: Int,
    kind: LinearBlockKind,
    minQuote: Int,
    expectedQuote: String?,
  ): Pair<SchemaNode, Int> {
    val first = blocks[start]
    val listId = first.listId ?: JotIds.createId()
    val items = mutableListOf<SchemaNode>()
    var i = start
    var listStart = first.listStart
    while (i < blocks.size) {
      val block = blocks[i]
      if (block.indent < indent) {
        break
      }
      if (block.quoteChain.size != minQuote) {
        break
      }
      if (expectedQuote != null && minQuote > 0 && block.quoteChain[minQuote - 1] != expectedQuote) {
        break
      }
      if (block.indent == indent && (block.kind != kind || (block.listId != null && first.listId != null && block.listId != first.listId))) {
        break
      }
      if (block.indent > indent) {
        break
      }
      if (listStart == null) {
        listStart = block.listStart
      }
      i += 1
      val nested = nestBlocks(blocks, i, indent + 1, minQuote, expectedQuote)
      i = nested.second
      items.add(itemNode(block, nested.first))
    }
    val attrs = mutableMapOf<String, Any?>()
    val listType = when (kind) {
      LinearBlockKind.ORDERED_ITEM -> {
        attrs["start"] = listStart ?: 1
        "orderedList"
      }
      LinearBlockKind.TASK_ITEM -> "taskList"
      else -> "bulletList"
    }
    return SchemaNode(type = listType, id = listId, attrs = attrs, content = items) to i
  }

  private fun itemNode(block: LinearBlock, nested: List<SchemaNode>): SchemaNode {
    val paragraph = SchemaNode(
      type = "paragraph",
      id = block.paragraphId ?: JotIds.deriveId(block.id, "paragraph", 0),
      content = runsToInlines(block.runs),
    )
    return if (block.kind == LinearBlockKind.TASK_ITEM) {
      SchemaNode(type = "taskItem", id = block.id, attrs = mapOf("checked" to (block.checked ?: 0)), content = listOf(paragraph) + nested)
    } else {
      SchemaNode(type = "listItem", id = block.id, content = listOf(paragraph) + nested)
    }
  }

  private fun blockToNode(block: LinearBlock): SchemaNode =
    when (block.kind) {
      LinearBlockKind.HEADING -> SchemaNode(
        type = "heading",
        id = block.id,
        attrs = mapOf("level" to (block.headingLevel ?: 1)),
        content = runsToInlines(block.runs),
      )
      LinearBlockKind.CODE_BLOCK -> SchemaNode(
        type = "codeBlock",
        id = block.id,
        attrs = mapOf("languageId" to (block.languageId ?: "")),
        content = runsToText(block.runs, block.id),
      )
      LinearBlockKind.PLACEHOLDER ->
        block.placeholderNode ?: SchemaNode(type = "paragraph", id = block.id, content = runsToInlines(block.runs))
      LinearBlockKind.HORIZONTAL_RULE -> SchemaNode(type = "horizontalRule", id = block.id)
      LinearBlockKind.IMAGE -> block.placeholderNode ?: SchemaNode(
        type = "image",
        id = block.id,
        attrs = mapOf(
          "attachmentId" to (block.runs.firstOrNull()?.id ?: block.id),
          "widthBasisPoints" to 10000,
          "alt" to block.plainText,
        ),
      )
      else -> SchemaNode(type = "paragraph", id = block.id, content = runsToInlines(block.runs))
    }

  private fun runsToInlines(runs: List<LinearRun>): List<SchemaNode> =
    runs.map { run ->
      when {
        run.placeholderNode != null -> run.placeholderNode
        run.text == LINE_SEPARATOR -> SchemaNode(type = "hardBreak", id = run.id ?: JotIds.createId())
        else -> SchemaNode(type = "text", id = run.id ?: JotIds.createId(), text = run.text, marks = run.marks)
      }
    }

  private fun runsToText(runs: List<LinearRun>, parentId: String): List<SchemaNode> {
    val text = runs.joinToString("") { it.text }
    if (text.isEmpty()) {
      return emptyList()
    }
    return listOf(
      SchemaNode(type = "text", id = runs.firstOrNull()?.id ?: JotIds.deriveId(parentId, "text", 0), text = text),
    )
  }

  // Edits

  private fun replaceBlock(linear: LinearDocument, index: Int, block: LinearBlock): LinearDocument =
    linear.copy(blocks = linear.blocks.toMutableList().also { it[index] = block })

  private fun insertText(text: String, position: SchemaSelection, marks: List<LinearMark>, linear: LinearDocument): LinearDocument {
    if (linear.blocks.isEmpty()) {
      val targetsRoot = position.nodeId.isEmpty() || position.nodeId == linear.id
      return linear.copy(
        blocks = listOf(
          LinearBlock(
            id = if (targetsRoot) bodyParagraphId(linear.id) else position.nodeId,
            kind = LinearBlockKind.PARAGRAPH,
            runs = listOf(LinearRun(text, marks, JotIds.createId())),
          ),
        ),
      )
    }
    val index = indexOfBlock(position.nodeId, linear) ?: return linear
    val block = linear.blocks[index]
    return replaceBlock(linear, index, block.copy(runs = insert(text, position.offsetUtf16, marks, block.runs)))
  }

  private fun insert(text: String, offset: Int, marks: List<LinearMark>, source: List<LinearRun>): List<LinearRun> {
    val runs = source.toMutableList()
    if (runs.isEmpty()) {
      runs.add(LinearRun(text, marks, JotIds.createId()))
      return runs
    }
    var remaining = maxOf(0, offset)
    for (i in runs.indices) {
      val run = runs[i]
      if (run.isPlaceholder) {
        if (remaining == 0) {
          runs.add(i, LinearRun(text, marks, JotIds.createId()))
          return runs
        }
        remaining -= 1
        continue
      }
      val length = run.text.length
      if (remaining <= length) {
        if (marksEqual(run.marks, marks)) {
          runs[i] = run.copy(text = Utf16.insert(run.text, remaining, text))
        } else {
          val left = Utf16.slice(run.text, 0, remaining)
          val right = Utf16.slice(run.text, remaining, length - remaining)
          val next = mutableListOf<LinearRun>()
          if (left.isNotEmpty()) {
            next.add(LinearRun(left, run.marks, run.id))
          }
          next.add(LinearRun(text, marks, JotIds.createId()))
          if (right.isNotEmpty()) {
            next.add(LinearRun(right, run.marks, JotIds.createId()))
          }
          runs.removeAt(i)
          runs.addAll(i, next)
        }
        return runs
      }
      remaining -= length
    }
    runs.add(LinearRun(text, marks, JotIds.createId()))
    return runs
  }

  private fun deleteRange(from: SchemaSelection, to: SchemaSelection, linear: LinearDocument): LinearDocument {
    val fromIndex = indexOfBlock(from.nodeId, linear) ?: return linear
    val toIndex = indexOfBlock(to.nodeId, linear) ?: return linear
    if (fromIndex == toIndex) {
      val block = linear.blocks[fromIndex]
      return replaceBlock(linear, fromIndex, block.copy(runs = deleteText(from.offsetUtf16, to.offsetUtf16, block.runs)))
    }
    val start = minOf(fromIndex, toIndex)
    val end = maxOf(fromIndex, toIndex)
    val startOffset = if (fromIndex <= toIndex) from.offsetUtf16 else to.offsetUtf16
    val endOffset = if (fromIndex <= toIndex) to.offsetUtf16 else from.offsetUtf16
    val head = linear.blocks[start]
    val tail = linear.blocks[end]
    val merged = deleteText(startOffset, head.utf16Length, head.runs) + deleteText(0, endOffset, tail.runs)
    val blocks = linear.blocks.toMutableList()
    blocks[start] = head.copy(runs = merged)
    blocks.subList(start + 1, end + 1).clear()
    return linear.copy(blocks = blocks)
  }

  private fun deleteText(from: Int, to: Int, runs: List<LinearRun>): List<LinearRun> {
    val start = maxOf(0, minOf(from, to))
    val end = maxOf(from, to)
    var offset = 0
    val next = mutableListOf<LinearRun>()
    for (run in runs) {
      val length = run.utf16Length
      val runStart = offset
      val runEnd = offset + length
      offset = runEnd
      if (runEnd <= start || runStart >= end) {
        next.add(run)
        continue
      }
      if (run.isPlaceholder) {
        continue
      }
      val keepLeft = maxOf(0, start - runStart)
      val keepRight = maxOf(0, runEnd - end)
      val left = Utf16.slice(run.text, 0, keepLeft)
      val right = Utf16.slice(run.text, length - keepRight, keepRight)
      if (left.isNotEmpty()) {
        next.add(LinearRun(left, run.marks, run.id))
      }
      if (right.isNotEmpty()) {
        next.add(LinearRun(right, run.marks, JotIds.createId()))
      }
    }
    return next
  }

  private fun applyMark(mark: LinearMark, from: SchemaSelection, to: SchemaSelection, add: Boolean, linear: LinearDocument): LinearDocument {
    val fromIndex = indexOfBlock(from.nodeId, linear) ?: return linear
    val toIndex = indexOfBlock(to.nodeId, linear) ?: return linear
    val blocks = linear.blocks.toMutableList()
    for (i in minOf(fromIndex, toIndex)..maxOf(fromIndex, toIndex)) {
      val startOffset = if (i == fromIndex) from.offsetUtf16 else 0
      val endOffset = if (i == toIndex) to.offsetUtf16 else blocks[i].utf16Length
      blocks[i] = blocks[i].copy(runs = markRuns(blocks[i].runs, startOffset, endOffset, mark, add))
    }
    return linear.copy(blocks = blocks)
  }

  private fun markRuns(runs: List<LinearRun>, from: Int, to: Int, mark: LinearMark, add: Boolean): List<LinearRun> {
    val start = maxOf(0, minOf(from, to))
    val end = maxOf(from, to)
    var offset = 0
    val next = mutableListOf<LinearRun>()
    for (run in runs) {
      val length = run.utf16Length
      val runStart = offset
      val runEnd = offset + length
      offset = runEnd
      if (run.isPlaceholder || runEnd <= start || runStart >= end) {
        next.add(run)
        continue
      }
      val leftLen = maxOf(0, start - runStart)
      val rightLen = maxOf(0, runEnd - end)
      val midLen = length - leftLen - rightLen
      if (leftLen > 0) {
        next.add(LinearRun(Utf16.slice(run.text, 0, leftLen), run.marks, run.id))
      }
      if (midLen > 0) {
        val marks = run.marks.filter { it.type != mark.type } + (if (add) listOf(mark) else emptyList())
        next.add(LinearRun(Utf16.slice(run.text, leftLen, midLen), marks, JotIds.createId()))
      }
      if (rightLen > 0) {
        next.add(LinearRun(Utf16.slice(run.text, length - rightLen, rightLen), run.marks, JotIds.createId()))
      }
    }
    return next
  }

  private fun setAttributes(nodeId: String, patch: Map<String, Any?>, linear: LinearDocument): LinearDocument {
    val index = indexOfBlock(nodeId, linear) ?: return linear
    var block = linear.blocks[index]
    Json.int(patch["checked"])?.let { block = block.copy(checked = it) }
    Json.int(patch["level"])?.let { level ->
      block = block.copy(
        headingLevel = level,
        kind = if (block.kind == LinearBlockKind.PARAGRAPH) LinearBlockKind.HEADING else block.kind,
      )
    }
    Json.str(patch["languageId"])?.let { block = block.copy(languageId = it) }
    val node = block.placeholderNode
    if (block.kind == LinearBlockKind.IMAGE && node != null) {
      val attrs = node.attrs.toMutableMap()
      for (key in listOf("widthBasisPoints", "alt")) {
        if (patch.containsKey(key)) {
          attrs[key] = patch[key]
        }
      }
      val updated = node.copy(attrs = attrs)
      block = block.copy(
        placeholderNode = updated,
        runs = listOf(
          LinearRun(OBJECT_REPLACEMENT, id = updated.id, placeholderNode = updated, fallbackText = Json.str(updated.attrs["alt"]) ?: ""),
        ),
      )
    }
    return replaceBlock(linear, index, block)
  }

  private fun insertNode(node: SchemaNode, parentId: String, index: Int, tree: SchemaNode): SchemaNode {
    if (tree.id == parentId) {
      val content = tree.content.toMutableList()
      content.add(index.coerceIn(0, content.size), node)
      return tree.copy(content = content)
    }
    return tree.copy(content = tree.content.map { insertNode(node, parentId, index, it) })
  }

  private fun deleteNode(nodeId: String, tree: SchemaNode): SchemaNode =
    tree.copy(content = tree.content.filter { it.id != nodeId }.map { deleteNode(nodeId, it) })

  private fun marksEqual(left: List<LinearMark>, right: List<LinearMark>): Boolean =
    left.size == right.size && left.sortedBy { it.type } == right.sortedBy { it.type }

  private fun firstMarks(slice: List<SchemaNode>): List<LinearMark> {
    for (node in slice) {
      if (node.type == "text") {
        return node.marks
      }
      val nested = firstMarks(node.content)
      if (nested.isNotEmpty()) {
        return nested
      }
    }
    return emptyList()
  }
}
