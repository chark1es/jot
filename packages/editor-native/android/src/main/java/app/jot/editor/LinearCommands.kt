package app.jot.editor

internal data class EditPlan(
  val operations: List<SchemaOperation>,
  val storedMarks: List<LinearMark>,
  val collapsedOnly: Boolean,
  val selectionAfter: SchemaSelection?,
  val isInputRule: Boolean,
) {
  companion object {
    fun empty(storedMarks: List<LinearMark>): EditPlan = EditPlan(emptyList(), storedMarks, true, null, false)
  }
}

/** Kotlin port of `LinearCommands.swift`. Keep the two in step: the editor corpus checks they emit the same trees. */
internal object LinearCommands {
  const val MINIMUM_IMAGE_WIDTH_BASIS_POINTS = 2000
  private val allowedHrefSchemes = setOf("https", "http", "mailto")

  fun commandPlan(
    name: String,
    value: Any?,
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: List<LinearMark>,
  ): EditPlan {
    val normalized = Json.normalize(value)
    val fields = Json.obj(normalized)
    when (name) {
      "setImageWidth" -> return setImageWidth(
        Json.str(fields["nodeId"]) ?: "",
        Json.int(fields["widthBasisPoints"]),
        linear,
        selection,
        storedMarks,
      )
      "removeBlock" -> {
        val target = LinearModel.block(Json.str(fields["nodeId"]) ?: "", linear) ?: return EditPlan.empty(storedMarks)
        return deleteBlock(caret(target, 0, "before", selection.revision), linear, storedMarks)
      }
      "insertBlocks" -> return insertBlocks(
        Json.arr(fields["nodes"]).map { SchemaNode.parse(it) },
        linear,
        selection,
        selectionEnd,
        storedMarks,
      )
    }
    if (linear.blocks.isEmpty()) {
      return insertIntoEmpty(name, fields, linear, storedMarks, selection.revision)
    }
    val index = LinearModel.indexOfBlock(selection.nodeId, linear) ?: return EditPlan.empty(storedMarks)
    val block = linear.blocks[index]
    val collapsed = selectionEnd == null || selectionEnd == selection
    val caretOffset = selection.offsetUtf16
    val revision = selection.revision
    return when (name) {
      "toggleBold" -> toggleMark("bold", linear, selection, selectionEnd, storedMarks, collapsed)
      "toggleItalic" -> toggleMark("italic", linear, selection, selectionEnd, storedMarks, collapsed)
      "toggleUnderline" -> toggleMark("underline", linear, selection, selectionEnd, storedMarks, collapsed)
      "toggleStrikethrough" -> toggleMark("strikethrough", linear, selection, selectionEnd, storedMarks, collapsed)
      "toggleInlineCode" -> toggleMark("inlineCode", linear, selection, selectionEnd, storedMarks, collapsed)
      "setLink" -> {
        val href = Json.str(fields["href"]) ?: ""
        if (!isAllowedHref(href)) {
          return EditPlan.empty(storedMarks)
        }
        val title = Json.str(fields["title"]) ?: ""
        val mark = LinearMark("link", mapOf("href" to href, "title" to title))
        if (collapsed) {
          // Nothing is selected, so the link text is the address itself.
          if (LinearModel.isAtomicKind(block.kind)) {
            return EditPlan.empty(storedMarks)
          }
          val offset = caretOffset.coerceIn(0, block.utf16Length)
          val withoutLink = storedMarks.filter { it.type != "link" }
          return EditPlan(
            listOf(SchemaOperation.InsertText(caret(block, offset, "after", revision), href, withoutLink + mark)),
            withoutLink,
            false,
            caret(block, offset + href.length, "after", revision),
            false,
          )
        }
        EditPlan(listOf(SchemaOperation.AddMark(selection, selectionEnd, mark)), storedMarks, false, null, false)
      }
      "unsetLink" -> removeMarkOnly("link", linear, selection, selectionEnd, storedMarks, collapsed)
      "setHeading" -> {
        val level = (Json.int(normalized) ?: Json.int(fields["level"]) ?: 1).coerceIn(1, 6)
        if (block.kind == LinearBlockKind.HEADING) {
          if (block.headingLevel == level) {
            return EditPlan.empty(storedMarks)
          }
          return EditPlan(
            listOf(SchemaOperation.SetNodeAttributes(block.id, mapOf("level" to level), mapOf("level" to (block.headingLevel ?: 1)))),
            storedMarks,
            false,
            selection,
            false,
          )
        }
        convertBlock(index, LinearBlockKind.HEADING, level, null, null, linear, storedMarks, caretOffset, revision)
      }
      "setParagraph" -> convertBlock(index, LinearBlockKind.PARAGRAPH, null, null, null, linear, storedMarks, caretOffset, revision)
      "toggleBulletList" -> toggleList(LinearBlockKind.BULLET_ITEM, index, linear, storedMarks, caretOffset, revision)
      "toggleOrderedList" -> toggleList(LinearBlockKind.ORDERED_ITEM, index, linear, storedMarks, caretOffset, revision)
      "toggleTaskList" -> toggleList(LinearBlockKind.TASK_ITEM, index, linear, storedMarks, caretOffset, revision)
      "toggleCodeBlock" -> {
        val next = if (block.kind == LinearBlockKind.CODE_BLOCK) LinearBlockKind.PARAGRAPH else LinearBlockKind.CODE_BLOCK
        convertBlock(index, next, null, null, null, linear, storedMarks, caretOffset, revision)
      }
      "toggleTaskItemChecked" -> {
        if (block.kind != LinearBlockKind.TASK_ITEM) {
          return EditPlan.empty(storedMarks)
        }
        val next = if ((block.checked ?: 0) == 0) 1 else 0
        EditPlan(
          listOf(SchemaOperation.SetNodeAttributes(block.id, mapOf("checked" to next), mapOf("checked" to (block.checked ?: 0)))),
          storedMarks,
          false,
          selection,
          false,
        )
      }
      "toggleBlockquote" -> toggleQuote(index, linear, storedMarks, caretOffset, revision)
      "insertHorizontalRule" -> insertAtomicBlock(horizontalRuleNode(), index, linear, storedMarks, revision)
      "insertImage" -> insertAtomicBlock(imageNode(fields), index, linear, storedMarks, revision)
      else -> EditPlan.empty(storedMarks)
    }
  }

  fun split(selection: SchemaSelection, linear: LinearDocument, storedMarks: List<LinearMark>): EditPlan {
    val index = LinearModel.indexOfBlock(selection.nodeId, linear) ?: return EditPlan.empty(storedMarks)
    val block = linear.blocks[index]
    val offset = selection.offsetUtf16.coerceIn(0, block.utf16Length)
    if (LinearModel.isAtomicKind(block.kind)) {
      return insertParagraphAfter(index, linear, storedMarks, selection.revision)
    }
    if (block.kind == LinearBlockKind.CODE_BLOCK) {
      return EditPlan(
        listOf(SchemaOperation.InsertText(caret(block, offset, "before", selection.revision), "\n", emptyList())),
        storedMarks,
        false,
        caret(block, offset + 1, "after", selection.revision),
        false,
      )
    }
    if (LinearModel.isListKind(block.kind) && block.plainText.isEmpty()) {
      return convertBlock(index, LinearBlockKind.PARAGRAPH, null, null, null, linear, storedMarks, revision = selection.revision)
    }
    if (block.quoteChain.isNotEmpty() && block.plainText.isEmpty()) {
      return toggleQuote(index, linear, storedMarks, 0, selection.revision)
    }
    val tailRuns = LinearModel.sliceRuns(block, offset, block.utf16Length)
    val tail = Utf16.slice(block.plainText, offset, block.utf16Length - offset)
    val ops = mutableListOf<SchemaOperation>()
    if (tail.isNotEmpty()) {
      ops.add(
        SchemaOperation.DeleteRange(
          caret(block, offset, "before", selection.revision),
          caret(block, block.utf16Length, "after", selection.revision),
          textSlice(tail, emptyList()),
        ),
      )
    }
    if (LinearModel.isListKind(block.kind)) {
      val newItemId = JotIds.createId()
      val newParagraphId = JotIds.createId()
      val item = listItemNode(block.kind, newItemId, newParagraphId, tailRuns, if (block.kind == LinearBlockKind.TASK_ITEM) 0 else null)
      ops.add(SchemaOperation.InsertNode(block.listId ?: linear.id, itemIndex(index, linear) + 1, item))
      return EditPlan(ops, storedMarks, false, SchemaSelection(newParagraphId, 0, "before", selection.revision), false)
    }
    val newId = JotIds.createId()
    val parent = LinearModel.linearToDocument(linear)
    val location = LinearModel.parentLocation(block.id, parent) ?: (linear.id to index)
    ops.add(SchemaOperation.InsertNode(location.first, location.second + 1, paragraphNode(newId, tailRuns)))
    return EditPlan(
      ops,
      if (block.kind == LinearBlockKind.HEADING) emptyList() else storedMarks,
      false,
      SchemaSelection(newId, 0, "before", selection.revision),
      false,
    )
  }

  fun join(selection: SchemaSelection, linear: LinearDocument, storedMarks: List<LinearMark>): EditPlan {
    val index = LinearModel.indexOfBlock(selection.nodeId, linear) ?: return EditPlan.empty(storedMarks)
    if (selection.offsetUtf16 > 0) {
      return EditPlan.empty(storedMarks)
    }
    val block = linear.blocks[index]
    if (LinearModel.isListKind(block.kind)) {
      val previous = previousSiblingItem(index, linear)
      if (previous != null && previous.first == index - 1) {
        val from = caret(previous.second, previous.second.utf16Length, "after", selection.revision)
        val to = caret(block, 0, "before", selection.revision)
        return EditPlan(
          listOf(SchemaOperation.DeleteRange(from, to, textSlice(block.plainText, emptyList()))),
          storedMarks,
          false,
          from,
          false,
        )
      }
      if (previous != null) {
        val from = caret(previous.second, previous.second.utf16Length, "after", selection.revision)
        val ops = mutableListOf<SchemaOperation>()
        var offset = from.offsetUtf16
        for (run in block.runs) {
          if (run.isPlaceholder || run.text.isEmpty()) {
            continue
          }
          ops.add(SchemaOperation.InsertText(from.copy(offsetUtf16 = offset), run.text, run.marks))
          offset += run.text.length
        }
        val item = LinearModel.findNode(block.id, LinearModel.linearToDocument(linear))
        if (item != null) {
          ops.add(SchemaOperation.DeleteNode(block.id, item))
        }
        return EditPlan(ops, storedMarks, false, from, false)
      }
      return convertBlock(index, LinearBlockKind.PARAGRAPH, null, null, null, linear, storedMarks, revision = selection.revision)
    }
    if (block.kind == LinearBlockKind.HEADING || block.kind == LinearBlockKind.CODE_BLOCK) {
      // Backspace at the start of a heading or code block turns it back into body text.
      return convertBlock(index, LinearBlockKind.PARAGRAPH, null, null, null, linear, storedMarks, revision = selection.revision)
    }
    if (index > 0 && LinearModel.isAtomicKind(linear.blocks[index - 1].kind)) {
      // Backspace right after an image or divider removes it instead of merging into it.
      val previous = linear.blocks[index - 1]
      val node = LinearModel.findNode(previous.id, LinearModel.linearToDocument(linear)) ?: return EditPlan.empty(storedMarks)
      return EditPlan(
        listOf(SchemaOperation.DeleteNode(previous.id, node)),
        storedMarks,
        false,
        caret(block, 0, "before", selection.revision),
        false,
      )
    }
    return EditPlan.empty(storedMarks)
  }

  fun inputRule(terminator: String, linear: LinearDocument, selection: SchemaSelection, storedMarks: List<LinearMark>): EditPlan? {
    if (terminator != " " && terminator != "\n") {
      return null
    }
    val index = LinearModel.indexOfBlock(selection.nodeId, linear) ?: return null
    val block = linear.blocks[index]
    if (block.kind != LinearBlockKind.PARAGRAPH || selection.offsetUtf16 != block.utf16Length) {
      return null
    }
    if (block.plainText in NativeInputRules.dividerMarkers && block.quoteChain.isEmpty() && block.indent == 0) {
      val tree = LinearModel.linearToDocument(linear)
      val top = LinearModel.topLevelIndex(block.id, tree) ?: return null
      val original = LinearModel.findNode(block.id, tree) ?: return null
      val paragraphId = JotIds.createId()
      return EditPlan(
        listOf(
          SchemaOperation.DeleteNode(block.id, original),
          SchemaOperation.InsertNode(linear.id, top, horizontalRuleNode()),
          SchemaOperation.InsertNode(linear.id, top + 1, paragraphNode(paragraphId, emptyList())),
        ),
        emptyList(),
        false,
        SchemaSelection(paragraphId, 0, "before", selection.revision),
        false,
      )
    }
    val rule = NativeInputRules.match(block.plainText) ?: return null
    var converted = applyKind(rule.kind, rule.headingLevel, rule.checked, rule.listStart, block.copy(runs = emptyList()))
    if (rule.quote) {
      converted = converted.copy(quoteChain = converted.quoteChain + JotIds.createId())
    }
    val next = linear.copy(blocks = linear.blocks.toMutableList().also { it[index] = converted })
    val ops = contentDiffOps(LinearModel.linearToDocument(linear), LinearModel.linearToDocument(next))
    if (ops.isEmpty()) {
      return null
    }
    return EditPlan(ops, storedMarks, false, caret(converted, 0, "before", selection.revision), true)
  }

  /**
   * Markdown emphasis typed inline. The closing delimiter is never inserted: the plan removes both
   * delimiters and marks the text between them.
   */
  fun inlineMarkdownRule(typed: String, linear: LinearDocument, selection: SchemaSelection, storedMarks: List<LinearMark>): EditPlan? {
    if (typed !in InlineMarkdown.triggers) {
      return null
    }
    val index = LinearModel.indexOfBlock(selection.nodeId, linear) ?: return null
    val block = linear.blocks[index]
    if (block.kind == LinearBlockKind.CODE_BLOCK || LinearModel.isAtomicKind(block.kind) || block.runs.any { it.isPlaceholder }) {
      return null
    }
    val caretOffset = selection.offsetUtf16.coerceIn(0, block.utf16Length)
    val full = Utf16.slice(block.plainText, 0, caretOffset) + typed
    val revision = selection.revision
    if (typed == ")") {
      val link = InlineMarkdown.matchLink(full) ?: return null
      if (!isAllowedHref(link.href)) {
        return null
      }
      return EditPlan(
        listOf(
          SchemaOperation.DeleteRange(
            caret(block, link.textEnd, "before", revision),
            caret(block, caretOffset, "after", revision),
            textSlice(full.substring(link.textEnd, caretOffset), emptyList()),
          ),
          SchemaOperation.AddMark(
            caret(block, link.textStart, "after", revision),
            caret(block, link.textEnd, "before", revision),
            SchemaMark("link", mapOf("href" to link.href, "title" to "")),
          ),
          SchemaOperation.DeleteRange(
            caret(block, link.textStart - 1, "before", revision),
            caret(block, link.textStart, "after", revision),
            textSlice("[", emptyList()),
          ),
        ),
        storedMarks.filter { it.type != "link" },
        false,
        caret(block, link.textEnd - 1, "after", revision),
        false,
      )
    }
    for (rule in InlineMarkdown.rules) {
      if (!rule.delimiter.endsWith(typed)) {
        continue
      }
      val match = InlineMarkdown.match(full, rule.delimiter) ?: continue
      val length = rule.delimiter.length
      val ops = mutableListOf<SchemaOperation>()
      if (caretOffset > match.innerEnd) {
        ops.add(
          SchemaOperation.DeleteRange(
            caret(block, match.innerEnd, "before", revision),
            caret(block, caretOffset, "after", revision),
            textSlice(full.substring(match.innerEnd, caretOffset), emptyList()),
          ),
        )
      }
      ops.add(
        SchemaOperation.AddMark(
          caret(block, match.innerStart, "after", revision),
          caret(block, match.innerEnd, "before", revision),
          SchemaMark(rule.markType),
        ),
      )
      ops.add(
        SchemaOperation.DeleteRange(
          caret(block, match.openStart, "before", revision),
          caret(block, match.innerStart, "after", revision),
          textSlice(rule.delimiter, emptyList()),
        ),
      )
      return EditPlan(
        ops,
        storedMarks.filter { it.type != rule.markType },
        false,
        caret(block, match.innerEnd - length, "after", revision),
        false,
      )
    }
    return null
  }

  fun isAllowedHref(href: String): Boolean {
    val colon = href.indexOf(':')
    if (colon <= 0) {
      return false
    }
    return href.substring(0, colon).lowercase() in allowedHrefSchemes
  }

  /**
   * Pasted Markdown arrives as schema blocks. A single paragraph flows into the current block;
   * anything larger lands after the caret's top-level block, splitting it if needed.
   */
  fun insertBlocks(
    nodes: List<SchemaNode>,
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: List<LinearMark>,
  ): EditPlan {
    val blocks = nodes.filter { it.type != "text" && it.type != "hardBreak" }
    if (blocks.isEmpty()) {
      return EditPlan.empty(storedMarks)
    }
    val revision = selection.revision
    var working = linear
    val ops = mutableListOf<SchemaOperation>()
    var caretSelection = selection
    if (selectionEnd != null && selectionEnd != selection) {
      val fromIndex = LinearModel.indexOfBlock(selection.nodeId, working)
      if (fromIndex != null && LinearModel.indexOfBlock(selectionEnd.nodeId, working) == fromIndex) {
        val block = working.blocks[fromIndex]
        val lower = minOf(selection.offsetUtf16, selectionEnd.offsetUtf16)
        val upper = maxOf(selection.offsetUtf16, selectionEnd.offsetUtf16)
        val from = caret(block, lower, "before", revision)
        val removal = SchemaOperation.DeleteRange(
          from,
          caret(block, upper, "after", revision),
          textSlice(Utf16.slice(block.plainText, lower, upper - lower), emptyList()),
        )
        ops.add(removal)
        working = tryApply(listOf(removal), working)
        caretSelection = from
      }
    }
    if (working.blocks.isEmpty()) {
      blocks.forEachIndexed { i, node -> ops.add(SchemaOperation.InsertNode(linear.id, i, node)) }
      return finishInsertBlocks(ops, blocks, 0, linear, storedMarks, revision)
    }
    val index = LinearModel.indexOfBlock(caretSelection.nodeId, working) ?: return EditPlan.empty(storedMarks)
    val block = working.blocks[index]
    val offset = caretSelection.offsetUtf16.coerceIn(0, block.utf16Length)
    if (blocks.size == 1 && blocks[0].type == "paragraph" && !LinearModel.isAtomicKind(block.kind)) {
      var position = offset
      for (child in blocks[0].content) {
        val text = if (child.type == "hardBreak") " " else child.plainText()
        if (text.isEmpty()) {
          continue
        }
        ops.add(
          SchemaOperation.InsertText(
            caret(block, position, "after", revision),
            text,
            if (block.kind == LinearBlockKind.CODE_BLOCK) emptyList() else child.marks,
          ),
        )
        position += text.length
      }
      return EditPlan(ops, storedMarks, false, caret(block, position, "after", revision), false)
    }
    val tree = LinearModel.linearToDocument(working)
    val top = LinearModel.topLevelIndex(block.id, tree) ?: index
    val original = LinearModel.findNode(block.id, tree)
    val insertAt: Int
    if (block.kind == LinearBlockKind.PARAGRAPH && block.quoteChain.isEmpty() && block.indent == 0 && block.utf16Length == 0 && original != null) {
      ops.add(SchemaOperation.DeleteNode(block.id, original))
      insertAt = top
    } else if (offset == 0 && !LinearModel.isAtomicKind(block.kind) && block.indent == 0) {
      insertAt = top
    } else {
      if (offset < block.utf16Length && !LinearModel.isAtomicKind(block.kind) && block.kind != LinearBlockKind.CODE_BLOCK) {
        val splitPlan = split(caret(block, offset, "before", revision), working, emptyList())
        ops.addAll(splitPlan.operations)
        working = tryApply(splitPlan.operations, working)
      }
      val afterSplit = LinearModel.linearToDocument(working)
      insertAt = (LinearModel.topLevelIndex(block.id, afterSplit) ?: top) + 1
    }
    blocks.forEachIndexed { i, node -> ops.add(SchemaOperation.InsertNode(linear.id, insertAt + i, node)) }
    return finishInsertBlocks(ops, blocks, insertAt, linear, storedMarks, revision)
  }

  private fun tryApply(operations: List<SchemaOperation>, linear: LinearDocument): LinearDocument =
    try {
      LinearModel.apply(operations, linear)
    } catch (_: LinearException) {
      linear
    }

  private fun finishInsertBlocks(
    operations: List<SchemaOperation>,
    inserted: List<SchemaNode>,
    insertAt: Int,
    linear: LinearDocument,
    storedMarks: List<LinearMark>,
    revision: Int,
  ): EditPlan {
    val ops = operations.toMutableList()
    val result = tryApply(ops, linear)
    val ids = mutableSetOf<String>()
    inserted.forEach { collectIds(it, ids) }
    var selectionAfter: SchemaSelection? = null
    val last = result.blocks.indexOfLast { it.id in ids }
    if (last >= 0) {
      val target = result.blocks[last]
      if (LinearModel.isAtomicKind(target.kind)) {
        if (last + 1 < result.blocks.size) {
          selectionAfter = caret(result.blocks[last + 1], 0, "before", revision)
        } else {
          val paragraphId = JotIds.createId()
          ops.add(SchemaOperation.InsertNode(linear.id, insertAt + inserted.size, paragraphNode(paragraphId, emptyList())))
          selectionAfter = SchemaSelection(paragraphId, 0, "before", revision)
        }
      } else {
        selectionAfter = caret(target, target.utf16Length, "after", revision)
      }
    }
    return EditPlan(ops, storedMarks, false, selectionAfter, false)
  }

  private fun collectIds(node: SchemaNode, ids: MutableSet<String>) {
    ids.add(node.id)
    node.content.forEach { collectIds(it, ids) }
  }

  private fun setImageWidth(
    nodeId: String,
    widthBasisPoints: Int?,
    linear: LinearDocument,
    selection: SchemaSelection,
    storedMarks: List<LinearMark>,
  ): EditPlan {
    val target = LinearModel.block(nodeId, linear)
    val node = target?.placeholderNode
    if (target == null || target.kind != LinearBlockKind.IMAGE || node == null) {
      return EditPlan.empty(storedMarks)
    }
    val prior = Json.int(node.attrs["widthBasisPoints"]) ?: 10000
    val next = (widthBasisPoints ?: prior).coerceIn(MINIMUM_IMAGE_WIDTH_BASIS_POINTS, 10000)
    if (next == prior) {
      return EditPlan.empty(storedMarks)
    }
    return EditPlan(
      listOf(SchemaOperation.SetNodeAttributes(target.id, mapOf("widthBasisPoints" to next), mapOf("widthBasisPoints" to prior))),
      storedMarks,
      false,
      selection,
      false,
    )
  }

  private fun toggleMark(
    type: String,
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: List<LinearMark>,
    collapsed: Boolean,
  ): EditPlan {
    if (collapsed) {
      val next = storedMarks.filter { it.type != type }.toMutableList()
      if (storedMarks.none { it.type == type }) {
        next.add(LinearMark(type))
      }
      return EditPlan(emptyList(), next, true, null, false)
    }
    val to = selectionEnd ?: selection
    if (LinearModel.rangeHasMark(type, selection, to, linear)) {
      return EditPlan(listOf(SchemaOperation.RemoveMark(selection, to, type)), storedMarks.filter { it.type != type }, false, null, false)
    }
    return EditPlan(listOf(SchemaOperation.AddMark(selection, to, LinearMark(type))), storedMarks, false, null, false)
  }

  private fun removeMarkOnly(
    type: String,
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: List<LinearMark>,
    collapsed: Boolean,
  ): EditPlan {
    val remaining = storedMarks.filter { it.type != type }
    if (collapsed) {
      val block = LinearModel.block(selection.nodeId, linear) ?: return EditPlan(emptyList(), remaining, true, null, false)
      // A caret inside a link removes the whole link run it sits in.
      var offset = 0
      for (run in block.runs) {
        val length = run.utf16Length
        if (selection.offsetUtf16 in offset..(offset + length) && run.marks.any { it.type == type } && length > 0) {
          return EditPlan(
            listOf(
              SchemaOperation.RemoveMark(
                caret(block, offset, "after", selection.revision),
                caret(block, offset + length, "before", selection.revision),
                type,
              ),
            ),
            remaining,
            false,
            selection,
            false,
          )
        }
        offset += length
      }
      return EditPlan(emptyList(), remaining, true, null, false)
    }
    return EditPlan(listOf(SchemaOperation.RemoveMark(selection, selectionEnd ?: selection, type)), remaining, false, null, false)
  }

  private fun toggleQuote(index: Int, linear: LinearDocument, storedMarks: List<LinearMark>, caretOffset: Int, revision: Int): EditPlan {
    val block = linear.blocks[index]
    val converted = if (block.quoteChain.isEmpty()) {
      block.copy(quoteChain = block.quoteChain + JotIds.createId())
    } else {
      block.copy(quoteChain = block.quoteChain.dropLast(1))
    }
    val next = linear.copy(blocks = linear.blocks.toMutableList().also { it[index] = converted })
    val ops = contentDiffOps(LinearModel.linearToDocument(linear), LinearModel.linearToDocument(next))
    if (ops.isEmpty()) {
      return EditPlan.empty(storedMarks)
    }
    return EditPlan(ops, storedMarks, false, caret(converted, caretOffset.coerceIn(0, converted.utf16Length), "after", revision), false)
  }

  private fun insertIntoEmpty(
    name: String,
    fields: Map<String, Any?>,
    linear: LinearDocument,
    storedMarks: List<LinearMark>,
    revision: Int,
  ): EditPlan =
    when (name) {
      "insertHorizontalRule" -> insertAtomicBlock(horizontalRuleNode(), -1, linear, storedMarks, revision)
      "insertImage" -> insertAtomicBlock(imageNode(fields), -1, linear, storedMarks, revision)
      else -> EditPlan.empty(storedMarks)
    }

  private fun horizontalRuleNode(): SchemaNode = SchemaNode(type = "horizontalRule", id = JotIds.createId())

  private fun imageNode(fields: Map<String, Any?>): SchemaNode {
    val attachmentId = Json.str(fields["attachmentId"])?.takeIf { it.isNotEmpty() } ?: JotIds.createId()
    val width = Json.int(fields["widthBasisPoints"]) ?: 10000
    return SchemaNode(
      type = "image",
      id = JotIds.createId(),
      attrs = mapOf(
        "attachmentId" to attachmentId,
        "widthBasisPoints" to width.coerceIn(MINIMUM_IMAGE_WIDTH_BASIS_POINTS, 10000),
        "alt" to (Json.str(fields["alt"]) ?: ""),
      ),
    )
  }

  /** Images and dividers are top-level blocks. Typing continues in a paragraph below them. */
  private fun insertAtomicBlock(node: SchemaNode, index: Int, linear: LinearDocument, storedMarks: List<LinearMark>, revision: Int): EditPlan {
    if (linear.blocks.isEmpty() || index < 0) {
      val paragraphId = JotIds.createId()
      return EditPlan(
        listOf(
          SchemaOperation.InsertNode(linear.id, 0, node),
          SchemaOperation.InsertNode(linear.id, 1, paragraphNode(paragraphId, emptyList())),
        ),
        storedMarks,
        false,
        SchemaSelection(paragraphId, 0, "before", revision),
        false,
      )
    }
    val block = linear.blocks[index]
    val tree = LinearModel.linearToDocument(linear)
    val top = LinearModel.topLevelIndex(block.id, tree) ?: index
    if (block.kind == LinearBlockKind.PARAGRAPH && block.quoteChain.isEmpty() && block.indent == 0 && block.utf16Length == 0) {
      return EditPlan(listOf(SchemaOperation.InsertNode(linear.id, top, node)), storedMarks, false, caret(block, 0, "before", revision), false)
    }
    val ops = mutableListOf<SchemaOperation>(SchemaOperation.InsertNode(linear.id, top + 1, node))
    if (top + 1 < tree.content.size) {
      val following = tree.content[top + 1]
      if (following.type == "paragraph" && following.content.isEmpty()) {
        return EditPlan(ops, storedMarks, false, SchemaSelection(following.id, 0, "before", revision), false)
      }
    }
    val paragraphId = JotIds.createId()
    ops.add(SchemaOperation.InsertNode(linear.id, top + 2, paragraphNode(paragraphId, emptyList())))
    return EditPlan(ops, storedMarks, false, SchemaSelection(paragraphId, 0, "before", revision), false)
  }

  private fun insertParagraphAfter(index: Int, linear: LinearDocument, storedMarks: List<LinearMark>, revision: Int): EditPlan {
    val id = JotIds.createId()
    val block = linear.blocks[index]
    val location = LinearModel.parentLocation(block.id, LinearModel.linearToDocument(linear)) ?: (linear.id to index)
    return EditPlan(
      listOf(SchemaOperation.InsertNode(location.first, location.second + 1, paragraphNode(id, emptyList()))),
      storedMarks,
      false,
      SchemaSelection(id, 0, "before", revision),
      false,
    )
  }

  fun deleteBlock(selection: SchemaSelection, linear: LinearDocument, storedMarks: List<LinearMark>): EditPlan {
    val index = LinearModel.indexOfBlock(selection.nodeId, linear) ?: return EditPlan.empty(storedMarks)
    val block = linear.blocks[index]
    val node = LinearModel.findNode(block.id, LinearModel.linearToDocument(linear)) ?: return EditPlan.empty(storedMarks)
    val ops = mutableListOf<SchemaOperation>(SchemaOperation.DeleteNode(block.id, node))
    val after = when {
      index > 0 -> {
        val previous = linear.blocks[index - 1]
        caret(previous, previous.utf16Length, "after", selection.revision)
      }
      index + 1 < linear.blocks.size -> caret(linear.blocks[index + 1], 0, "before", selection.revision)
      else -> {
        // The note would have no body left, so keep an empty paragraph to type into.
        val paragraphId = JotIds.createId()
        ops.add(SchemaOperation.InsertNode(linear.id, 0, paragraphNode(paragraphId, emptyList())))
        SchemaSelection(paragraphId, 0, "before", selection.revision)
      }
    }
    return EditPlan(ops, storedMarks, false, after, false)
  }

  private fun convertBlock(
    index: Int,
    kind: LinearBlockKind,
    headingLevel: Int?,
    checked: Int?,
    listStart: Int?,
    linear: LinearDocument,
    storedMarks: List<LinearMark>,
    caretOffset: Int = 0,
    revision: Int = 0,
  ): EditPlan {
    val blocks = linear.blocks.toMutableList()
    blocks[index] = applyKind(kind, headingLevel, checked, listStart, blocks[index])
    splitFollowingListIfNeeded(index, blocks)
    val next = linear.copy(blocks = blocks)
    val ops = contentDiffOps(LinearModel.linearToDocument(linear), LinearModel.linearToDocument(next))
    if (ops.isEmpty()) {
      return EditPlan.empty(storedMarks)
    }
    val converted = next.blocks[index]
    return EditPlan(ops, storedMarks, false, caret(converted, caretOffset.coerceIn(0, converted.utf16Length), "after", revision), false)
  }

  private fun toggleList(
    kind: LinearBlockKind,
    index: Int,
    linear: LinearDocument,
    storedMarks: List<LinearMark>,
    caretOffset: Int,
    revision: Int,
  ): EditPlan {
    if (linear.blocks[index].kind == kind) {
      return convertBlock(index, LinearBlockKind.PARAGRAPH, null, null, null, linear, storedMarks, caretOffset, revision)
    }
    return convertBlock(
      index,
      kind,
      null,
      if (kind == LinearBlockKind.TASK_ITEM) 0 else null,
      if (kind == LinearBlockKind.ORDERED_ITEM) 1 else null,
      linear,
      storedMarks,
      caretOffset,
      revision,
    )
  }

  private fun applyKind(kind: LinearBlockKind, headingLevel: Int?, checked: Int?, listStart: Int?, block: LinearBlock): LinearBlock {
    var next = block.copy(kind = kind, headingLevel = if (kind == LinearBlockKind.HEADING) headingLevel else null)
    next = if (kind == LinearBlockKind.TASK_ITEM) next.copy(checked = checked ?: next.checked ?: 0) else next.copy(checked = null)
    next = if (kind == LinearBlockKind.CODE_BLOCK) {
      // Code has no marks in the schema.
      next.copy(languageId = next.languageId ?: "", runs = next.runs.map { it.copy(marks = emptyList()) })
    } else {
      next.copy(languageId = null)
    }
    next = if (LinearModel.isListKind(kind)) {
      next.copy(
        listId = next.listId ?: JotIds.createId(),
        paragraphId = next.paragraphId ?: JotIds.createId(),
        listStart = if (kind == LinearBlockKind.ORDERED_ITEM) (listStart ?: next.listStart ?: 1) else null,
      )
    } else {
      next.copy(listId = null, listStart = null, paragraphId = null)
    }
    return next
  }

  private fun splitFollowingListIfNeeded(index: Int, blocks: MutableList<LinearBlock>) {
    if (LinearModel.isListKind(blocks[index].kind) || index + 1 >= blocks.size) {
      return
    }
    val follower = blocks[index + 1]
    val oldId = follower.listId
    if (!LinearModel.isListKind(follower.kind) || oldId == null) {
      return
    }
    val fresh = JotIds.createId()
    val indent = follower.indent
    for (i in (index + 1) until blocks.size) {
      if (blocks[i].indent < indent) {
        break
      }
      if (blocks[i].indent == indent) {
        if (blocks[i].listId == oldId && LinearModel.isListKind(blocks[i].kind)) {
          blocks[i] = blocks[i].copy(listId = fresh)
        } else {
          break
        }
      }
    }
  }

  fun contentDiffOps(oldDoc: SchemaNode, newDoc: SchemaNode): List<SchemaOperation> {
    var prefix = 0
    while (prefix < oldDoc.content.size && prefix < newDoc.content.size && oldDoc.content[prefix] == newDoc.content[prefix]) {
      prefix += 1
    }
    var oldSuffix = oldDoc.content.size
    var newSuffix = newDoc.content.size
    while (oldSuffix > prefix && newSuffix > prefix && oldDoc.content[oldSuffix - 1] == newDoc.content[newSuffix - 1]) {
      oldSuffix -= 1
      newSuffix -= 1
    }
    val ops = mutableListOf<SchemaOperation>()
    for (node in oldDoc.content.subList(prefix, oldSuffix).reversed()) {
      ops.add(SchemaOperation.DeleteNode(node.id, node))
    }
    newDoc.content.subList(prefix, newSuffix).forEachIndexed { offset, node ->
      ops.add(SchemaOperation.InsertNode(oldDoc.id, prefix + offset, node))
    }
    return ops
  }

  private fun itemIndex(blockIndex: Int, linear: LinearDocument): Int {
    val block = linear.blocks[blockIndex]
    return (0 until blockIndex).count {
      val candidate = linear.blocks[it]
      candidate.listId == block.listId && candidate.indent == block.indent && candidate.kind == block.kind
    }
  }

  private fun previousSiblingItem(index: Int, linear: LinearDocument): Pair<Int, LinearBlock>? {
    val block = linear.blocks[index]
    var i = index - 1
    while (i >= 0) {
      val candidate = linear.blocks[i]
      if (candidate.indent < block.indent) {
        return null
      }
      if (candidate.indent == block.indent && candidate.kind == block.kind && candidate.listId == block.listId) {
        return i to candidate
      }
      i -= 1
    }
    return null
  }

  private fun caret(block: LinearBlock, offset: Int, affinity: String, revision: Int): SchemaSelection =
    SchemaSelection(block.textNodeId, offset, affinity, revision)

  private fun textSlice(text: String, marks: List<LinearMark>): List<SchemaNode> = listOf(LinearModel.textNode(text, marks))

  private fun paragraphNode(id: String, runs: List<LinearRun>): SchemaNode =
    SchemaNode(
      type = "paragraph",
      id = id,
      content = runs.filter { !it.isPlaceholder && it.text.isNotEmpty() }.map { LinearModel.textNode(it.text, it.marks) },
    )

  private fun listItemNode(kind: LinearBlockKind, id: String, paragraphId: String, runs: List<LinearRun>, checked: Int?): SchemaNode {
    val paragraph = paragraphNode(paragraphId, runs)
    if (kind == LinearBlockKind.TASK_ITEM) {
      return SchemaNode(type = "taskItem", id = id, attrs = mapOf("checked" to (checked ?: 0)), content = listOf(paragraph))
    }
    return SchemaNode(type = "listItem", id = id, content = listOf(paragraph))
  }
}

internal object InlineMarkdown {
  data class Rule(val delimiter: String, val markType: String)

  data class Match(val openStart: Int, val innerStart: Int, val innerEnd: Int)

  data class LinkMatch(val textStart: Int, val textEnd: Int, val href: String)

  /** Longer delimiters first, so `**` wins over `*`. */
  val rules = listOf(
    Rule("**", "bold"),
    Rule("__", "bold"),
    Rule("~~", "strikethrough"),
    Rule("*", "italic"),
    Rule("_", "italic"),
    Rule("`", "inlineCode"),
  )

  val triggers = setOf("*", "_", "~", "`", ")")

  private val linkPattern = Regex("\\[([^\\[\\]\\n]+)\\]\\(([^()\\s]+)\\)$")

  /** `full` is the block text before the caret plus the character being typed. */
  fun match(full: String, delimiter: String): Match? {
    val length = delimiter.length
    val count = full.length
    if (count < length * 2 + 1 || !full.endsWith(delimiter)) {
      return null
    }
    val innerEnd = count - length
    val markerChar = delimiter[0]
    val lastInner = full[innerEnd - 1]
    if (lastInner.isWhitespace() || lastInner == markerChar) {
      return null
    }
    var searchLength = innerEnd - 1
    while (searchLength > 0) {
      val found = if (searchLength - length < 0) -1 else full.lastIndexOf(delimiter, searchLength - length)
      if (found < 0) {
        return null
      }
      val innerStart = found + length
      val before: Char? = if (found > 0) full[found - 1] else null
      val valid = innerStart < innerEnd &&
        !full[innerStart].isWhitespace() &&
        full[innerStart] != markerChar &&
        before != markerChar &&
        !(markerChar == '_' && before != null && before.isLetterOrDigit())
      if (valid) {
        val inner = full.substring(innerStart, innerEnd)
        if (inner.contains('\n') || inner.contains(LINE_SEPARATOR)) {
          return null
        }
        return Match(found, innerStart, innerEnd)
      }
      searchLength = found
    }
    return null
  }

  fun matchLink(full: String): LinkMatch? {
    val result = linkPattern.find(full) ?: return null
    val text = result.groups[1] ?: return null
    val url = result.groups[2] ?: return null
    return LinkMatch(text.range.first, text.range.last + 1, url.value)
  }
}

internal object NativeInputRules {
  data class Rule(
    val id: String,
    val kind: LinearBlockKind,
    val headingLevel: Int? = null,
    val checked: Int? = null,
    val listStart: Int? = null,
    val quote: Boolean = false,
    val matches: (String) -> Boolean,
  )

  val dividerMarkers = setOf("---", "***", "___")

  val rules = listOf(
    Rule("heading-1", LinearBlockKind.HEADING, headingLevel = 1) { it == "#" },
    Rule("heading-2", LinearBlockKind.HEADING, headingLevel = 2) { it == "##" },
    Rule("heading-3", LinearBlockKind.HEADING, headingLevel = 3) { it == "###" },
    Rule("heading-4", LinearBlockKind.HEADING, headingLevel = 4) { it == "####" },
    Rule("heading-5", LinearBlockKind.HEADING, headingLevel = 5) { it == "#####" },
    Rule("heading-6", LinearBlockKind.HEADING, headingLevel = 6) { it == "######" },
    Rule("bullet", LinearBlockKind.BULLET_ITEM) { it == "-" },
    Rule("bullet-star", LinearBlockKind.BULLET_ITEM) { it == "*" },
    Rule("bullet-plus", LinearBlockKind.BULLET_ITEM) { it == "+" },
    Rule("ordered", LinearBlockKind.ORDERED_ITEM, listStart = 1) { it == "1." },
    Rule("task-unchecked", LinearBlockKind.TASK_ITEM, checked = 0) { it == "[]" || it == "[ ]" },
    Rule("task-checked", LinearBlockKind.TASK_ITEM, checked = 1) { it == "[x]" || it == "[X]" },
    Rule("code", LinearBlockKind.CODE_BLOCK) { it == "```" },
    Rule("quote", LinearBlockKind.PARAGRAPH, quote = true) { it == ">" },
  )

  fun match(text: String): Rule? = rules.firstOrNull { it.matches(text) }
}
