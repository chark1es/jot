package app.jot.editor

internal data class EditPlan(
  val document: LinearDocument,
  val operations: List<Map<String, Any?>>,
  val selection: LinearSelection,
  val inputRuleNodeId: String? = null,
)

internal data class IntakePayload(
  val transactionId: String,
  val baseRevision: Int,
  val operations: List<Map<String, Any?>>,
  val selection: Map<String, Any?>,
)

internal object EditorEdits {
  private data class InputRule(
    val id: String,
    val marker: String,
    val kind: LinearBlockKind,
    val level: Int = 1,
    val checked: Boolean = false,
  )

  private val INPUT_RULES = listOf(
    InputRule("heading-6", "######", LinearBlockKind.HEADING, level = 6),
    InputRule("heading-5", "#####", LinearBlockKind.HEADING, level = 5),
    InputRule("heading-4", "####", LinearBlockKind.HEADING, level = 4),
    InputRule("heading-3", "###", LinearBlockKind.HEADING, level = 3),
    InputRule("heading-2", "##", LinearBlockKind.HEADING, level = 2),
    InputRule("heading-1", "#", LinearBlockKind.HEADING, level = 1),
    InputRule("code", "```", LinearBlockKind.CODE_BLOCK),
    InputRule("ordered", "1.", LinearBlockKind.ORDERED_ITEM),
    InputRule("task-checked", "[x]", LinearBlockKind.TASK_ITEM, checked = true),
    InputRule("task-checked-X", "[X]", LinearBlockKind.TASK_ITEM, checked = true),
    InputRule("task-unchecked", "[]", LinearBlockKind.TASK_ITEM),
    InputRule("bullet", "-", LinearBlockKind.BULLET_ITEM),
    InputRule("quote", ">", LinearBlockKind.BLOCKQUOTE),
  )

  fun parseIntakePayload(payload: String): IntakePayload {
    val root = JsonParser.parseObject(payload)
    val transactionId = JsonMaps.string(root["transactionId"])
    require(transactionId.isNotEmpty()) { "missing transactionId" }
    val operations = JsonMaps.listOf(root["operations"]).map { JsonMaps.mapOf(it) }
    return IntakePayload(
      transactionId = transactionId,
      baseRevision = JsonMaps.int(root["baseRevision"]),
      operations = operations,
      selection = JsonMaps.mapOf(root["selection"]),
    )
  }

  fun planInputRule(
    document: LinearDocument,
    selection: LinearSelection,
    revision: Int,
  ): EditPlan? {
    val block = LinearModel.blockAt(document, selection.nodeId) ?: return null
    if (block.kind != LinearBlockKind.PARAGRAPH) {
      return null
    }
    if (selection.offsetUtf16 != block.text.length) {
      return null
    }
    val rule = INPUT_RULES.firstOrNull { it.marker == block.text } ?: return null
    val from = selection.copy(offsetUtf16 = 0)
    val to = selection.copy(offsetUtf16 = block.text.length)
    val deleteOp = mapOf(
      "type" to "deleteRange",
      "from" to LinearModel.selectionMap(from),
      "to" to LinearModel.selectionMap(to),
      "deletedSlice" to mapOf(
        "nodes" to listOf(LinearModel.textSliceNode(block.text, emptyList(), block.nodeId)),
      ),
    )
    val patch = mutableMapOf<String, Any?>()
    val prior = mutableMapOf<String, Any?>("type" to "paragraph")
    when (rule.kind) {
      LinearBlockKind.HEADING -> {
        patch["level"] = rule.level
        prior["level"] = 1
      }
      LinearBlockKind.CODE_BLOCK -> {
        patch["type"] = "codeBlock"
        patch["languageId"] = ""
      }
      LinearBlockKind.BULLET_ITEM -> patch["listKind"] = "bulletList"
      LinearBlockKind.ORDERED_ITEM -> patch["listKind"] = "orderedList"
      LinearBlockKind.TASK_ITEM -> {
        patch["listKind"] = "taskList"
        patch["checked"] = if (rule.checked) 1 else 0
        prior["checked"] = 0
      }
      LinearBlockKind.BLOCKQUOTE -> patch["type"] = "blockquote"
      else -> return null
    }
    val attrOp = mapOf(
      "type" to "setNodeAttributes",
      "nodeId" to block.nodeId,
      "patch" to patch,
      "priorValues" to prior,
    )
    val ops = listOf(deleteOp, attrOp)
    val next = LinearModel.applyOperations(document, ops)
    return EditPlan(
      document = next,
      operations = ops,
      selection = LinearSelection(block.nodeId, 0, "after", revision + 1),
      inputRuleNodeId = block.nodeId,
    )
  }

  fun planEnter(
    document: LinearDocument,
    selection: LinearSelection,
    revision: Int,
  ): EditPlan? {
    val current = LinearModel.ensureEditableBlock(document)
    val index = LinearModel.findBlockIndex(current, selection.nodeId) ?: return null
    val block = current.blocks[index]
    val offset = selection.offsetUtf16.coerceIn(0, block.text.length)
    if (block.kind == LinearBlockKind.CODE_BLOCK) {
      val ops = listOf(
        insertTextOp(selection.copy(offsetUtf16 = offset, revision = revision), "\n"),
      )
      val next = LinearModel.applyOperations(current, ops)
      return EditPlan(
        document = next,
        operations = ops,
        selection = LinearSelection(block.nodeId, offset + 1, "after", revision + 1),
      )
    }
    if (LinearModel.isListKind(block.kind) && block.text.isEmpty()) {
      val ops = listOf(liftToParagraphOp(block))
      val next = LinearModel.applyOperations(current, ops)
      return EditPlan(
        document = next,
        operations = ops,
        selection = LinearSelection(block.nodeId, 0, "after", revision + 1),
      )
    }
    if (LinearModel.isQuoted(block) && block.text.isEmpty()) {
      val ops = listOf(liftToParagraphOp(block))
      val next = LinearModel.applyOperations(current, ops)
      return EditPlan(
        document = next,
        operations = ops,
        selection = LinearSelection(block.nodeId, 0, "after", revision + 1),
      )
    }
    val remaining = block.text.substring(offset)
    val ops = mutableListOf<Map<String, Any?>>()
    if (remaining.isNotEmpty()) {
      ops.add(
        mapOf(
          "type" to "deleteRange",
          "from" to LinearModel.selectionMap(selection.copy(offsetUtf16 = offset, revision = revision)),
          "to" to LinearModel.selectionMap(selection.copy(offsetUtf16 = block.text.length, revision = revision)),
          "deletedSlice" to mapOf(
            "nodes" to listOf(LinearModel.textSliceNode(remaining, emptyList(), block.nodeId)),
          ),
        ),
      )
    }
    val newParagraphId = JotIds.createId()
    val node = splitNode(block, remaining, newParagraphId)
    ops.add(
      mapOf(
        "type" to "insertNode",
        "parentId" to current.docId,
        "index" to (index + 1),
        "node" to node,
      ),
    )
    val next = LinearModel.applyOperations(current, ops)
    val newBlock = next.blocks.getOrNull(index + 1) ?: return null
    return EditPlan(
      document = next,
      operations = ops,
      selection = LinearSelection(newBlock.listItemId ?: newBlock.nodeId, 0, "after", revision + 1),
    )
  }

  fun planBackspaceAtStart(
    document: LinearDocument,
    selection: LinearSelection,
    revision: Int,
  ): EditPlan? {
    if (selection.offsetUtf16 != 0) {
      return null
    }
    val index = LinearModel.findBlockIndex(document, selection.nodeId) ?: return null
    val block = document.blocks[index]
    if (LinearModel.isListKind(block.kind) && (index == 0 || !LinearModel.isListKind(document.blocks[index - 1].kind))) {
      val ops = listOf(liftToParagraphOp(block))
      return EditPlan(
        document = LinearModel.applyOperations(document, ops),
        operations = ops,
        selection = LinearSelection(block.nodeId, 0, "after", revision + 1),
      )
    }
    if (LinearModel.isQuoted(block)) {
      val previousQuoted = index > 0 && LinearModel.isQuoted(document.blocks[index - 1]) &&
        document.blocks[index - 1].blockquoteId == block.blockquoteId
      if (!previousQuoted) {
        val ops = listOf(liftToParagraphOp(block))
        return EditPlan(
          document = LinearModel.applyOperations(document, ops),
          operations = ops,
          selection = LinearSelection(block.nodeId, 0, "after", revision + 1),
        )
      }
    }
    if (index == 0) {
      return null
    }
    val previous = document.blocks[index - 1]
    if (previous.kind == LinearBlockKind.ATOMIC) {
      return null
    }
    val ops = mutableListOf<Map<String, Any?>>()
    if (block.text.isNotEmpty()) {
      ops.add(
        insertTextOp(
          LinearSelection(previous.nodeId, previous.text.length, "before", revision),
          block.text,
        ),
      )
    }
    ops.add(
      mapOf(
        "type" to "deleteNode",
        "nodeId" to block.nodeId,
        "deletedNode" to JsonMaps.listOf(
          LinearModel.toDocument(LinearDocument(document.docId, listOf(block)))["content"],
        ).first(),
      ),
    )
    val next = LinearModel.applyOperations(document, ops)
    return EditPlan(
      document = next,
      operations = ops,
      selection = LinearSelection(previous.listItemId ?: previous.nodeId, previous.text.length, "after", revision + 1),
    )
  }

  fun planReplace(
    document: LinearDocument,
    from: LinearSelection,
    to: LinearSelection,
    inserted: String,
    deleted: String,
    marks: List<LinearMark>,
    revision: Int,
  ): EditPlan {
    val current = LinearModel.ensureEditableBlock(document)
    val nodeId = from.nodeId.ifEmpty { current.blocks.first().nodeId }
    val parent = nodeId
    val op = mapOf(
      "type" to "replaceRange",
      "from" to LinearModel.selectionMap(from.copy(nodeId = nodeId)),
      "to" to LinearModel.selectionMap(to.copy(nodeId = nodeId)),
      "slice" to mapOf("nodes" to listOf(LinearModel.textSliceNode(inserted, marks, parent))),
      "deletedSlice" to mapOf("nodes" to listOf(LinearModel.textSliceNode(deleted, emptyList(), parent))),
    )
    val ops = listOf(op)
    val next = LinearModel.applyOperations(current, ops)
    return EditPlan(
      document = next,
      operations = ops,
      selection = LinearSelection(nodeId, from.offsetUtf16 + inserted.length, "after", revision + 1),
    )
  }

  fun planToggleMark(
    document: LinearDocument,
    from: LinearSelection,
    to: LinearSelection,
    type: String,
    revision: Int,
    attrs: Map<String, Any?> = emptyMap(),
  ): EditPlan {
    val beforeMarks = LinearModel.activeMarks(document, from)
    val adding = beforeMarks.none { it.type == type }
    val next = LinearModel.toggleMark(document, from, to, type, attrs)
    val range = mapOf("from" to LinearModel.selectionMap(from), "to" to LinearModel.selectionMap(to))
    val op = if (adding) {
      mapOf("type" to "addMark", "range" to range, "mark" to LinearModel.markToMap(LinearMark(type, attrs)))
    } else {
      mapOf("type" to "removeMark", "range" to range, "markType" to type)
    }
    return EditPlan(
      document = next,
      operations = listOf(op),
      selection = to.copy(revision = revision + 1),
    )
  }

  fun planSetLink(
    document: LinearDocument,
    from: LinearSelection,
    to: LinearSelection,
    href: String,
    title: String,
    revision: Int,
  ): EditPlan? {
    if (!LinearModel.isAllowedHref(href)) {
      return null
    }
    if (from.nodeId != to.nodeId) {
      return null
    }
    val start = minOf(from.offsetUtf16, to.offsetUtf16)
    val stop = maxOf(from.offsetUtf16, to.offsetUtf16)
    if (start == stop) {
      return null
    }
    val mark = LinearMark("link", mapOf("href" to href, "title" to title))
    val op = mapOf(
      "type" to "addMark",
      "range" to mapOf("from" to LinearModel.selectionMap(from), "to" to LinearModel.selectionMap(to)),
      "mark" to LinearModel.markToMap(mark),
    )
    return EditPlan(
      document = LinearModel.applyOperations(document, listOf(op)),
      operations = listOf(op),
      selection = to.copy(revision = revision + 1),
    )
  }

  fun planUnsetLink(
    document: LinearDocument,
    from: LinearSelection,
    to: LinearSelection,
    revision: Int,
  ): EditPlan {
    val op = mapOf(
      "type" to "removeMark",
      "range" to mapOf("from" to LinearModel.selectionMap(from), "to" to LinearModel.selectionMap(to)),
      "markType" to "link",
    )
    return EditPlan(
      document = LinearModel.applyOperations(document, listOf(op)),
      operations = listOf(op),
      selection = to.copy(revision = revision + 1),
    )
  }

  fun planToggleBlockquote(
    document: LinearDocument,
    selection: LinearSelection,
    revision: Int,
  ): EditPlan {
    val block = LinearModel.blockAt(document, selection.nodeId) ?: return EditPlan(document, emptyList(), selection)
    val quoted = LinearModel.isQuoted(block)
    val kind = if (quoted) LinearBlockKind.PARAGRAPH else LinearBlockKind.BLOCKQUOTE
    val next = LinearModel.setBlockKind(document, selection.nodeId, kind)
    val op = mapOf(
      "type" to "setNodeAttributes",
      "nodeId" to block.nodeId,
      "patch" to mapOf("type" to if (quoted) "paragraph" else "blockquote"),
      "priorValues" to mapOf("type" to if (quoted) "blockquote" else "paragraph"),
    )
    return EditPlan(
      document = next,
      operations = listOf(op),
      selection = selection.copy(revision = revision + 1),
    )
  }

  fun planInsertHorizontalRule(
    document: LinearDocument,
    selection: LinearSelection,
    revision: Int,
  ): EditPlan {
    val current = LinearModel.ensureEditableBlock(document)
    val index = LinearModel.findBlockIndex(current, selection.nodeId) ?: (current.blocks.size - 1).coerceAtLeast(0)
    val hrId = JotIds.createId()
    val paraId = JotIds.createId()
    val hr = mapOf("type" to "horizontalRule", "id" to hrId)
    val para = mapOf("type" to "paragraph", "id" to paraId, "content" to emptyList<Any>())
    val ops = listOf(
      mapOf("type" to "insertNode", "parentId" to current.docId, "index" to (index + 1), "node" to hr),
      mapOf("type" to "insertNode", "parentId" to current.docId, "index" to (index + 2), "node" to para),
    )
    val next = LinearModel.applyOperations(current, ops)
    return EditPlan(
      document = next,
      operations = ops,
      selection = LinearSelection(paraId, 0, "after", revision + 1),
    )
  }

  fun planInsertImage(
    document: LinearDocument,
    selection: LinearSelection,
    attachmentId: String,
    alt: String,
    revision: Int,
  ): EditPlan {
    val current = LinearModel.ensureEditableBlock(document)
    val index = LinearModel.findBlockIndex(current, selection.nodeId) ?: (current.blocks.size - 1).coerceAtLeast(0)
    val imageId = JotIds.createId()
    val paraId = JotIds.createId()
    val imageIdOr = attachmentId.ifEmpty { JotIds.createId() }
    val image = mapOf(
      "type" to "image",
      "id" to imageId,
      "attrs" to mapOf(
        "attachmentId" to imageIdOr,
        "widthBasisPoints" to 10000,
        "alt" to alt,
      ),
    )
    val para = mapOf("type" to "paragraph", "id" to paraId, "content" to emptyList<Any>())
    val ops = listOf(
      mapOf("type" to "insertNode", "parentId" to current.docId, "index" to (index + 1), "node" to image),
      mapOf("type" to "insertNode", "parentId" to current.docId, "index" to (index + 2), "node" to para),
    )
    val next = LinearModel.applyOperations(current, ops)
    return EditPlan(
      document = next,
      operations = ops,
      selection = LinearSelection(paraId, 0, "after", revision + 1),
    )
  }

  private fun insertTextOp(position: LinearSelection, text: String): Map<String, Any?> =
    mapOf(
      "type" to "insertText",
      "position" to LinearModel.selectionMap(position),
      "text" to text,
      "storedMarks" to emptyList<Map<String, Any?>>(),
    )

  private fun liftToParagraphOp(block: LinearBlock): Map<String, Any?> =
    mapOf(
      "type" to "setNodeAttributes",
      "nodeId" to block.nodeId,
      "patch" to mapOf("type" to "paragraph"),
      "priorValues" to mapOf("type" to listTypeName(block.kind)),
    )

  private fun listTypeName(kind: LinearBlockKind): String =
    when (kind) {
      LinearBlockKind.ORDERED_ITEM -> "orderedList"
      LinearBlockKind.TASK_ITEM -> "taskList"
      LinearBlockKind.BULLET_ITEM -> "bulletList"
      LinearBlockKind.HEADING -> "heading"
      LinearBlockKind.CODE_BLOCK -> "codeBlock"
      LinearBlockKind.BLOCKQUOTE -> "blockquote"
      else -> "paragraph"
    }

  private fun splitNode(block: LinearBlock, remaining: String, newParagraphId: String): Map<String, Any?> {
    val content = if (remaining.isEmpty()) {
      emptyList()
    } else {
      listOf(LinearModel.textSliceNode(remaining, emptyList(), newParagraphId))
    }
    val paragraph = mapOf(
      "type" to "paragraph",
      "id" to newParagraphId,
      "content" to content,
    )
    if (!LinearModel.isListKind(block.kind)) {
      if (LinearModel.isQuoted(block)) {
        return mapOf(
          "type" to "blockquote",
          "id" to (block.blockquoteId ?: JotIds.createId()),
          "content" to listOf(paragraph),
        )
      }
      return paragraph
    }
    val itemId = JotIds.createId()
    val itemType = if (block.kind == LinearBlockKind.TASK_ITEM) "taskItem" else "listItem"
    val item = mutableMapOf<String, Any?>(
      "type" to itemType,
      "id" to itemId,
      "content" to listOf(paragraph),
    )
    if (itemType == "taskItem") {
      item["attrs"] = mapOf("checked" to 0)
    }
    val listType = when (block.kind) {
      LinearBlockKind.ORDERED_ITEM -> "orderedList"
      LinearBlockKind.TASK_ITEM -> "taskList"
      else -> "bulletList"
    }
    val list = mutableMapOf<String, Any?>(
      "type" to listType,
      "id" to (block.listId ?: JotIds.createId()),
      "content" to listOf(item),
    )
    if (listType == "orderedList") {
      list["attrs"] = mapOf("start" to block.orderedStart)
    }
    return list
  }
}
