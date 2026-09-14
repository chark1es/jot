package app.jot.editor

/**
 * Kotlin port of `EditPlanner.swift`: what a replaced range of editor characters means for the
 * document. Editor characters follow the same layout on both platforms. Each block draws its
 * leading markers (quote bar, then bullet, number, or checkbox), then its text, then a newline
 * unless it is the last block.
 */
internal object EditPlanner {
  data class Change(
    val from: SchemaSelection,
    val to: SchemaSelection,
    val replacement: String,
    /** Length of the replaced range in editor characters, counting markers and newlines. */
    val rangeLength: Int,
    /** The range is a single image, divider, or unsupported-block character. */
    val deletesAtomic: Boolean,
  )

  sealed class Outcome {
    data class Plan(val plan: EditPlan) : Outcome()

    /** Backspace right after a Markdown shortcut. The caller undoes the conversion instead. */
    object UndoInputRule : Outcome()

    object Ignore : Outcome()
  }

  fun change(start: Int, length: Int, replacement: String, linear: LinearDocument, revision: Int): Change =
    Change(
      from = location(start, "before", linear, revision),
      to = location(start + length, "after", linear, revision),
      replacement = replacement,
      rangeLength = length,
      deletesAtomic = length == 1 && isAtomicCharacter(start, linear),
    )

  fun plan(change: Change, linear: LinearDocument, storedMarks: List<LinearMark>, inputRuleBlockId: String?): Outcome {
    val from = change.from
    val to = change.to
    val replacement = change.replacement
    var plan: EditPlan? = null
    if (replacement.isEmpty() && change.rangeLength == 1 && change.deletesAtomic) {
      plan = LinearCommands.deleteBlock(from, linear, storedMarks)
    }
    if (plan == null && replacement.isEmpty() && change.rangeLength > 0 && to.offsetUtf16 == 0 &&
      (from.nodeId != to.nodeId || from.offsetUtf16 == 0)
    ) {
      val current = LinearModel.block(to.nodeId, linear) ?: return Outcome.Ignore
      if (inputRuleBlockId != null && (current.id == inputRuleBlockId || current.paragraphId == inputRuleBlockId)) {
        return Outcome.UndoInputRule
      }
      plan = backspaceAtBlockStart(current, from, to, linear, storedMarks) ?: return Outcome.Ignore
    }
    if (plan == null && change.rangeLength > 0 && from.nodeId != to.nodeId) {
      plan = crossBlockReplacement(from, to, replacement, linear, storedMarks)
    }
    if (plan == null && replacement.isNotEmpty()) {
      val block = LinearModel.block(from.nodeId, linear)
      if (block != null && LinearModel.isAtomicKind(block.kind)) {
        plan = typingBesideAtomic(block, from, replacement, linear)
      }
    }
    if (plan == null && change.rangeLength == 0 && replacement.length == 1) {
      plan = LinearCommands.inlineMarkdownRule(replacement, linear, from, storedMarks)
    }
    if (plan == null && change.rangeLength == 0 && (replacement == "\n" || replacement == " ")) {
      plan = LinearCommands.inputRule(replacement, linear, from, storedMarks)
    }
    if (plan == null && replacement == "\n") {
      plan = if (change.rangeLength > 0) {
        replaceThenSplit(from, to, linear, storedMarks)
      } else {
        LinearCommands.split(from, linear, storedMarks)
      }
    }
    if (plan == null) {
      plan = textReplacement(from, to, change.rangeLength, replacement, linear, storedMarks)
    }
    if (plan == null || plan.operations.isEmpty()) {
      return Outcome.Ignore
    }
    return Outcome.Plan(plan)
  }

  fun textReplacement(
    from: SchemaSelection,
    to: SchemaSelection,
    rangeLength: Int,
    replacement: String,
    linear: LinearDocument,
    storedMarks: List<LinearMark>,
  ): EditPlan? {
    if (rangeLength == 0 && replacement.isEmpty()) {
      return null
    }
    val operation = when {
      rangeLength == 0 -> SchemaOperation.InsertText(from, replacement, storedMarks)
      replacement.isEmpty() -> SchemaOperation.DeleteRange(from, to, deletedSlice(from, to, linear))
      else -> SchemaOperation.ReplaceRange(from, to, listOf(LinearModel.textNode(replacement, storedMarks)), deletedSlice(from, to, linear))
    }
    val after = from.copy(offsetUtf16 = from.offsetUtf16 + replacement.length, affinity = "after")
    return EditPlan(listOf(operation), storedMarks, false, after, false)
  }

  /** A selection that spans blocks. Only whole top-level nodes change, which TypeScript and Yjs apply exactly. */
  fun crossBlockReplacement(
    from: SchemaSelection,
    to: SchemaSelection,
    replacement: String,
    linear: LinearDocument,
    storedMarks: List<LinearMark>,
  ): EditPlan? {
    val next = try {
      var working = LinearModel.apply(SchemaOperation.DeleteRange(from, to, emptyList()), linear)
      if (replacement.isNotEmpty()) {
        working = LinearModel.apply(SchemaOperation.InsertText(from, replacement, storedMarks), working)
      }
      working
    } catch (_: LinearException) {
      return null
    }
    val operations = LinearCommands.contentDiffOps(LinearModel.linearToDocument(linear), LinearModel.linearToDocument(next))
    if (operations.isEmpty()) {
      return null
    }
    val after = from.copy(offsetUtf16 = from.offsetUtf16 + replacement.length, affinity = "after")
    return EditPlan(operations, storedMarks, false, after, false)
  }

  fun deletedSlice(from: SchemaSelection, to: SchemaSelection, linear: LinearDocument): List<SchemaNode> {
    val block = LinearModel.block(from.nodeId, linear) ?: return emptyList()
    return LinearModel.sliceRuns(block, from.offsetUtf16, to.offsetUtf16)
      .filter { !it.isPlaceholder }
      .map { LinearModel.textNode(it.text, it.marks) }
  }

  // Editor character layout

  /** The editor's text: leading markers as object replacement characters, runs, and newlines. */
  fun displayText(linear: LinearDocument): String {
    val out = StringBuilder()
    linear.blocks.forEachIndexed { index, block ->
      repeat(LinearModel.leadingCount(block)) { out.append(OBJECT_REPLACEMENT) }
      for (run in block.runs) {
        out.append(if (run.isPlaceholder) OBJECT_REPLACEMENT else run.text)
      }
      if (index + 1 < linear.blocks.size) {
        out.append('\n')
      }
    }
    return out.toString()
  }

  fun location(displayIndex: Int, affinity: String, linear: LinearDocument, revision: Int): SchemaSelection {
    if (linear.blocks.isEmpty()) {
      return SchemaSelection(linear.id, 0, affinity, revision)
    }
    var cursor = 0
    linear.blocks.forEachIndexed { index, block ->
      val contentStart = cursor + LinearModel.leadingCount(block)
      val contentEnd = contentStart + block.utf16Length
      if (displayIndex < contentStart) {
        return SchemaSelection(block.textNodeId, 0, affinity, revision)
      }
      if (displayIndex <= contentEnd) {
        return SchemaSelection(block.textNodeId, displayIndex - contentStart, affinity, revision)
      }
      cursor = contentEnd + (if (index < linear.blocks.size - 1) 1 else 0)
    }
    val last = linear.blocks.last()
    return SchemaSelection(last.textNodeId, last.utf16Length, affinity, revision)
  }

  fun displayIndex(selection: SchemaSelection, linear: LinearDocument): Int {
    var cursor = 0
    linear.blocks.forEachIndexed { index, block ->
      val leading = LinearModel.leadingCount(block)
      if (block.id == selection.nodeId || block.paragraphId == selection.nodeId) {
        return cursor + leading + selection.offsetUtf16.coerceIn(0, block.utf16Length)
      }
      cursor += leading + block.utf16Length
      if (index < linear.blocks.size - 1) {
        cursor += 1
      }
    }
    return cursor
  }

  /** True when the editor character at `displayIndex` is an image, divider, or unsupported node. */
  fun isAtomicCharacter(displayIndex: Int, linear: LinearDocument): Boolean {
    var cursor = 0
    linear.blocks.forEachIndexed { index, block ->
      val contentStart = cursor + LinearModel.leadingCount(block)
      val contentEnd = contentStart + block.utf16Length
      if (displayIndex < contentStart) {
        return false
      }
      if (displayIndex < contentEnd) {
        var offset = contentStart
        for (run in block.runs) {
          if (displayIndex < offset + run.utf16Length) {
            return run.isPlaceholder || LinearModel.isAtomicKind(block.kind)
          }
          offset += run.utf16Length
        }
        return false
      }
      cursor = contentEnd + (if (index < linear.blocks.size - 1) 1 else 0)
    }
    return false
  }

  // Block-boundary edits

  /** Backspace with the caret at the start of a block. */
  private fun backspaceAtBlockStart(
    current: LinearBlock,
    from: SchemaSelection,
    to: SchemaSelection,
    linear: LinearDocument,
    storedMarks: List<LinearMark>,
  ): EditPlan? {
    val start = SchemaSelection(current.textNodeId, 0, "before", to.revision)
    val joined = LinearCommands.join(start, linear, storedMarks)
    if (joined.operations.isNotEmpty()) {
      return joined
    }
    if (current.quoteChain.isNotEmpty()) {
      return LinearCommands.commandPlan("toggleBlockquote", null, linear, start, null, storedMarks)
    }
    if (from.nodeId == to.nodeId) {
      return null
    }
    val previous = LinearModel.block(from.nodeId, linear) ?: return null
    if (LinearModel.isAtomicKind(previous.kind)) {
      return LinearCommands.deleteBlock(from, linear, storedMarks)
    }
    return crossBlockReplacement(from, to, "", linear, storedMarks)
  }

  private fun replaceThenSplit(from: SchemaSelection, to: SchemaSelection, linear: LinearDocument, storedMarks: List<LinearMark>): EditPlan? {
    if (from.nodeId != to.nodeId) {
      return crossBlockReplacement(from, to, "", linear, storedMarks)
    }
    val deletion = SchemaOperation.DeleteRange(from, to, deletedSlice(from, to, linear))
    val next = try {
      LinearModel.apply(deletion, linear)
    } catch (_: LinearException) {
      linear
    }
    val split = LinearCommands.split(from, next, storedMarks)
    return EditPlan(listOf(deletion) + split.operations, split.storedMarks, false, split.selectionAfter ?: from, false)
  }

  /** Typing with the caret beside an image or divider starts a new paragraph on that side. */
  private fun typingBesideAtomic(block: LinearBlock, position: SchemaSelection, replacement: String, linear: LinearDocument): EditPlan? {
    val top = LinearModel.topLevelIndex(block.id, LinearModel.linearToDocument(linear)) ?: return null
    val text = if (replacement == "\n") "" else replacement
    val id = JotIds.createId()
    val paragraph = SchemaNode(
      type = "paragraph",
      id = id,
      content = if (text.isEmpty()) emptyList() else listOf(LinearModel.textNode(text, emptyList())),
    )
    return EditPlan(
      listOf(SchemaOperation.InsertNode(linear.id, if (position.offsetUtf16 == 0) top else top + 1, paragraph)),
      emptyList(),
      false,
      SchemaSelection(id, text.length, "after", position.revision),
      false,
    )
  }
}
