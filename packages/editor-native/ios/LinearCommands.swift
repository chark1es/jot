import Foundation

enum EditorCommandName: String {
  case toggleBold
  case toggleItalic
  case toggleUnderline
  case toggleStrikethrough
  case toggleInlineCode
  case setHeading
  case setParagraph
  case toggleBulletList
  case toggleOrderedList
  case toggleTaskList
  case toggleCodeBlock
  case toggleTaskItemChecked
  case toggleBlockquote
  case insertHorizontalRule
  case insertImage
  case setImageWidth
  case removeBlock
  case insertBlocks
  case setLink
  case unsetLink
}

struct EditPlan {
  var operations: [SchemaOperation]
  var storedMarks: [LinearMark]
  var collapsedOnly: Bool
  var selectionAfter: SchemaSelection?
  var isInputRule: Bool

  static func empty(_ storedMarks: [LinearMark]) -> EditPlan {
    EditPlan(operations: [], storedMarks: storedMarks, collapsedOnly: true, selectionAfter: nil, isInputRule: false)
  }
}

enum LinearCommands {
  static let minimumImageWidthBasisPoints = 2000
  static let allowedHrefSchemes: Set<String> = ["https", "http", "mailto"]

  static func operations(
    name: String,
    value: JSONValue?,
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection? = nil,
    storedMarks: [LinearMark]
  ) -> (operations: [SchemaOperation], storedMarks: [LinearMark], collapsedOnly: Bool) {
    let plan = commandPlan(
      name: name,
      value: value,
      linear: linear,
      selection: selection,
      selectionEnd: selectionEnd,
      storedMarks: storedMarks
    )
    return (plan.operations, plan.storedMarks, plan.collapsedOnly)
  }

  static func commandPlan(
    name: String,
    value: JSONValue?,
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: [LinearMark]
  ) -> EditPlan {
    let command = EditorCommandName(rawValue: name)
    let fields = value?.objectValue() ?? [:]
    switch command {
    case .setImageWidth:
      return setImageWidth(
        nodeId: fields["nodeId"]?.stringValue() ?? "",
        widthBasisPoints: fields["widthBasisPoints"]?.intValue(),
        linear: linear,
        selection: selection,
        storedMarks: storedMarks
      )
    case .removeBlock:
      guard let target = LinearModel.block(nodeId: fields["nodeId"]?.stringValue() ?? "", in: linear) else {
        return .empty(storedMarks)
      }
      return deleteBlock(
        at: caret(target, offset: 0, affinity: "before", revision: selection.revision),
        linear: linear,
        storedMarks: storedMarks
      )
    case .insertBlocks:
      let nodes = (fields["nodes"]?.arrayValue() ?? []).map { SchemaNode.parse($0) }
      return insertBlocks(
        nodes,
        linear: linear,
        selection: selection,
        selectionEnd: selectionEnd,
        storedMarks: storedMarks
      )
    default:
      break
    }
    if linear.blocks.isEmpty {
      return insertIntoEmpty(
        name: name,
        value: value,
        linear: linear,
        storedMarks: storedMarks,
        revision: selection.revision
      )
    }
    guard let index = LinearModel.indexOfBlock(nodeId: selection.nodeId, in: linear) else {
      return .empty(storedMarks)
    }
    let block = linear.blocks[index]
    let collapsed = selectionEnd == nil || selectionEnd == selection
    let caretOffset = selection.offsetUtf16
    let revision = selection.revision
    switch command {
    case .toggleBold:
      return toggleMark("bold", linear: linear, selection: selection, selectionEnd: selectionEnd, storedMarks: storedMarks, collapsed: collapsed)
    case .toggleItalic:
      return toggleMark("italic", linear: linear, selection: selection, selectionEnd: selectionEnd, storedMarks: storedMarks, collapsed: collapsed)
    case .toggleUnderline:
      return toggleMark("underline", linear: linear, selection: selection, selectionEnd: selectionEnd, storedMarks: storedMarks, collapsed: collapsed)
    case .toggleStrikethrough:
      return toggleMark("strikethrough", linear: linear, selection: selection, selectionEnd: selectionEnd, storedMarks: storedMarks, collapsed: collapsed)
    case .toggleInlineCode:
      return toggleMark("inlineCode", linear: linear, selection: selection, selectionEnd: selectionEnd, storedMarks: storedMarks, collapsed: collapsed)
    case .setLink:
      let href = fields["href"]?.stringValue() ?? ""
      if !isAllowedHref(href) {
        return .empty(storedMarks)
      }
      let title = fields["title"]?.stringValue() ?? ""
      let mark = LinearMark(type: "link", attrs: ["href": .string(href), "title": .string(title)])
      if collapsed {
        // Nothing is selected, so the link text is the address itself.
        guard !LinearModel.isAtomicKind(block.kind) else {
          return .empty(storedMarks)
        }
        let offset = min(max(0, caretOffset), block.utf16Length)
        let marks = storedMarks.filter { $0.type != "link" } + [mark]
        return EditPlan(
          operations: [
            .insertText(
              position: caret(block, offset: offset, affinity: "after", revision: revision),
              text: href,
              storedMarks: marks.map { $0.toSchema() }
            )
          ],
          storedMarks: storedMarks.filter { $0.type != "link" },
          collapsedOnly: false,
          selectionAfter: caret(block, offset: offset + Utf16.count(href), affinity: "after", revision: revision),
          isInputRule: false
        )
      }
      return EditPlan(
        operations: [.addMark(from: selection, to: selectionEnd ?? selection, mark: mark.toSchema())],
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: nil,
        isInputRule: false
      )
    case .unsetLink:
      return removeMarkOnly(
        "link",
        linear: linear,
        selection: selection,
        selectionEnd: selectionEnd,
        storedMarks: storedMarks,
        collapsed: collapsed
      )
    case .setHeading:
      let level = min(max(value?.intValue() ?? fields["level"]?.intValue() ?? 1, 1), 6)
      if block.kind == .heading {
        if block.headingLevel == level {
          return .empty(storedMarks)
        }
        return EditPlan(
          operations: [
            .setNodeAttributes(
              nodeId: block.id,
              patch: ["level": .int(level)],
              priorValues: ["level": .int(block.headingLevel ?? 1)]
            )
          ],
          storedMarks: storedMarks,
          collapsedOnly: false,
          selectionAfter: selection,
          isInputRule: false
        )
      }
      return convertBlock(at: index, to: .heading, headingLevel: level, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks, caretOffset: caretOffset, revision: revision)
    case .setParagraph:
      return convertBlock(at: index, to: .paragraph, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks, caretOffset: caretOffset, revision: revision)
    case .toggleBulletList:
      return toggleList(.bulletItem, at: index, linear: linear, storedMarks: storedMarks, caretOffset: caretOffset, revision: revision)
    case .toggleOrderedList:
      return toggleList(.orderedItem, at: index, linear: linear, storedMarks: storedMarks, caretOffset: caretOffset, revision: revision)
    case .toggleTaskList:
      return toggleList(.taskItem, at: index, linear: linear, storedMarks: storedMarks, caretOffset: caretOffset, revision: revision)
    case .toggleCodeBlock:
      let next: LinearBlockKind = block.kind == .codeBlock ? .paragraph : .codeBlock
      return convertBlock(at: index, to: next, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks, caretOffset: caretOffset, revision: revision)
    case .toggleTaskItemChecked:
      guard block.kind == .taskItem else { return .empty(storedMarks) }
      let next = (block.checked ?? 0) == 0 ? 1 : 0
      return EditPlan(
        operations: [
          .setNodeAttributes(
            nodeId: block.id,
            patch: ["checked": .int(next)],
            priorValues: ["checked": .int(block.checked ?? 0)]
          )
        ],
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: selection,
        isInputRule: false
      )
    case .toggleBlockquote:
      return toggleQuote(at: index, linear: linear, storedMarks: storedMarks, caretOffset: caretOffset, revision: revision)
    case .insertHorizontalRule:
      return insertAtomicBlock(horizontalRuleNode(), at: index, linear: linear, storedMarks: storedMarks, revision: revision)
    case .insertImage:
      return insertAtomicBlock(imageNode(fields), at: index, linear: linear, storedMarks: storedMarks, revision: revision)
    case .setImageWidth, .removeBlock, .insertBlocks, nil:
      return .empty(storedMarks)
    }
  }

  static func split(at selection: SchemaSelection, linear: LinearDocument, storedMarks: [LinearMark]) -> EditPlan {
    guard let index = LinearModel.indexOfBlock(nodeId: selection.nodeId, in: linear) else {
      return .empty(storedMarks)
    }
    let block = linear.blocks[index]
    let offset = min(max(0, selection.offsetUtf16), block.utf16Length)
    if LinearModel.isAtomicKind(block.kind) {
      return insertParagraphAfter(at: index, linear: linear, storedMarks: storedMarks, revision: selection.revision)
    }
    if block.kind == .codeBlock {
      return EditPlan(
        operations: [
          .insertText(position: caret(block, offset: offset, affinity: "before", revision: selection.revision), text: "\n", storedMarks: [])
        ],
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: caret(block, offset: offset + 1, affinity: "after", revision: selection.revision),
        isInputRule: false
      )
    }
    if LinearModel.isListKind(block.kind) && block.plainText.isEmpty {
      return convertBlock(at: index, to: .paragraph, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks, revision: selection.revision)
    }
    if !block.quoteChain.isEmpty && block.plainText.isEmpty {
      return toggleQuote(at: index, linear: linear, storedMarks: storedMarks, caretOffset: 0, revision: selection.revision)
    }
    let tailRuns = LinearModel.sliceRuns(block, from: offset, to: block.utf16Length)
    let tail = Utf16.slice(block.plainText, offset: offset, length: block.utf16Length - offset)
    var ops: [SchemaOperation] = []
    if !tail.isEmpty {
      ops.append(
        .deleteRange(
          from: caret(block, offset: offset, affinity: "before", revision: selection.revision),
          to: caret(block, offset: block.utf16Length, affinity: "after", revision: selection.revision),
          deletedSlice: textSlice(tail, marks: [])
        )
      )
    }
    if LinearModel.isListKind(block.kind) {
      let newItemId = JotIds.create()
      let newParagraphId = JotIds.create()
      let item = listItemNode(
        kind: block.kind,
        id: newItemId,
        paragraphId: newParagraphId,
        runs: tailRuns,
        checked: block.kind == .taskItem ? 0 : nil
      )
      let listId = block.listId ?? linear.id
      ops.append(.insertNode(parentId: listId, index: itemIndex(at: index, in: linear) + 1, node: item))
      return EditPlan(
        operations: ops,
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: SchemaSelection(nodeId: newParagraphId, offsetUtf16: 0, affinity: "before", revision: selection.revision),
        isInputRule: false
      )
    }
    let newId = JotIds.create()
    let node = paragraphNode(id: newId, runs: tailRuns)
    let parent = LinearModel.linearToDocument(linear)
    let loc = LinearModel.parentLocation(nodeId: block.id, in: parent) ?? (linear.id, index)
    ops.append(.insertNode(parentId: loc.parentId, index: loc.index + 1, node: node))
    return EditPlan(
      operations: ops,
      storedMarks: block.kind == .heading ? [] : storedMarks,
      collapsedOnly: false,
      selectionAfter: SchemaSelection(nodeId: newId, offsetUtf16: 0, affinity: "before", revision: selection.revision),
      isInputRule: false
    )
  }

  static func join(at selection: SchemaSelection, linear: LinearDocument, storedMarks: [LinearMark]) -> EditPlan {
    guard let index = LinearModel.indexOfBlock(nodeId: selection.nodeId, in: linear) else {
      return .empty(storedMarks)
    }
    if selection.offsetUtf16 > 0 {
      return .empty(storedMarks)
    }
    let block = linear.blocks[index]
    if LinearModel.isListKind(block.kind) {
      if let previous = previousSiblingItem(at: index, in: linear), previous.index == index - 1 {
        let from = caret(previous.block, offset: previous.block.utf16Length, affinity: "after", revision: selection.revision)
        let to = caret(block, offset: 0, affinity: "before", revision: selection.revision)
        return EditPlan(
          operations: [
            .deleteRange(from: from, to: to, deletedSlice: textSlice(block.plainText, marks: []))
          ],
          storedMarks: storedMarks,
          collapsedOnly: false,
          selectionAfter: from,
          isInputRule: false
        )
      }
      if let previous = previousSiblingItem(at: index, in: linear) {
        let from = caret(previous.block, offset: previous.block.utf16Length, affinity: "after", revision: selection.revision)
        var ops: [SchemaOperation] = []
        var offset = from.offsetUtf16
        for run in block.runs where !run.isPlaceholder && !run.text.isEmpty {
          var at = from
          at.offsetUtf16 = offset
          ops.append(.insertText(position: at, text: run.text, storedMarks: run.marks.map { $0.toSchema() }))
          offset += Utf16.count(run.text)
        }
        let tree = LinearModel.linearToDocument(linear)
        if let item = LinearModel.findNode(block.id, in: tree) {
          ops.append(.deleteNode(nodeId: block.id, deletedNode: item))
        }
        return EditPlan(
          operations: ops,
          storedMarks: storedMarks,
          collapsedOnly: false,
          selectionAfter: from,
          isInputRule: false
        )
      }
      return convertBlock(at: index, to: .paragraph, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks, revision: selection.revision)
    }
    if block.kind == .heading || block.kind == .codeBlock {
      // Backspace at the start of a heading or code block turns it back into body text.
      return convertBlock(at: index, to: .paragraph, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks, revision: selection.revision)
    }
    if index > 0, LinearModel.isAtomicKind(linear.blocks[index - 1].kind) {
      // Backspace right after an image or divider removes it instead of merging into it.
      let previous = linear.blocks[index - 1]
      let tree = LinearModel.linearToDocument(linear)
      guard let node = LinearModel.findNode(previous.id, in: tree) else {
        return .empty(storedMarks)
      }
      return EditPlan(
        operations: [.deleteNode(nodeId: previous.id, deletedNode: node)],
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: caret(block, offset: 0, affinity: "before", revision: selection.revision),
        isInputRule: false
      )
    }
    return .empty(storedMarks)
  }

  static func inputRule(terminator: String, linear: LinearDocument, selection: SchemaSelection, storedMarks: [LinearMark]) -> EditPlan? {
    guard terminator == " " || terminator == "\n" else { return nil }
    guard let index = LinearModel.indexOfBlock(nodeId: selection.nodeId, in: linear) else { return nil }
    let block = linear.blocks[index]
    if block.kind != .paragraph {
      return nil
    }
    if selection.offsetUtf16 != block.utf16Length {
      return nil
    }
    if NativeInputRules.dividerMarkers.contains(block.plainText), block.quoteChain.isEmpty, block.indent == 0 {
      let tree = LinearModel.linearToDocument(linear)
      guard let top = LinearModel.topLevelIndex(nodeId: block.id, in: tree),
            let original = LinearModel.findNode(block.id, in: tree) else {
        return nil
      }
      let paragraphId = JotIds.create()
      return EditPlan(
        operations: [
          .deleteNode(nodeId: block.id, deletedNode: original),
          .insertNode(parentId: linear.id, index: top, node: horizontalRuleNode()),
          .insertNode(parentId: linear.id, index: top + 1, node: paragraphNode(id: paragraphId, runs: []))
        ],
        storedMarks: [],
        collapsedOnly: false,
        selectionAfter: SchemaSelection(nodeId: paragraphId, offsetUtf16: 0, affinity: "before", revision: selection.revision),
        isInputRule: false
      )
    }
    guard let rule = NativeInputRules.match(block.plainText) else { return nil }
    var next = linear
    next.blocks[index].runs = []
    applyKind(
      rule.kind,
      headingLevel: rule.headingLevel,
      checked: rule.checked,
      listStart: rule.listStart,
      to: &next.blocks[index]
    )
    if rule.quote {
      next.blocks[index].quoteChain.append(JotIds.create())
    }
    let ops = contentDiffOps(
      from: LinearModel.linearToDocument(linear),
      to: LinearModel.linearToDocument(next)
    )
    if ops.isEmpty {
      return nil
    }
    let converted = next.blocks[index]
    return EditPlan(
      operations: ops,
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: caret(converted, offset: 0, affinity: "before", revision: selection.revision),
      isInputRule: true
    )
  }

  /// Markdown emphasis typed inline. The closing delimiter is never inserted: the plan
  /// removes both delimiters and marks the text between them.
  static func inlineMarkdownRule(
    typed: String,
    linear: LinearDocument,
    selection: SchemaSelection,
    storedMarks: [LinearMark]
  ) -> EditPlan? {
    guard InlineMarkdown.triggers.contains(typed),
          let index = LinearModel.indexOfBlock(nodeId: selection.nodeId, in: linear) else {
      return nil
    }
    let block = linear.blocks[index]
    guard block.kind != .codeBlock,
          !LinearModel.isAtomicKind(block.kind),
          !block.runs.contains(where: \.isPlaceholder) else {
      return nil
    }
    let caretOffset = min(max(0, selection.offsetUtf16), block.utf16Length)
    let full = (Utf16.slice(block.plainText, offset: 0, length: caretOffset) + typed) as NSString
    let revision = selection.revision
    if typed == ")" {
      guard let link = InlineMarkdown.matchLink(full), isAllowedHref(link.href) else {
        return nil
      }
      return EditPlan(
        operations: [
          .deleteRange(
            from: caret(block, offset: link.textEnd, affinity: "before", revision: revision),
            to: caret(block, offset: caretOffset, affinity: "after", revision: revision),
            deletedSlice: textSlice(full.substring(with: NSRange(location: link.textEnd, length: caretOffset - link.textEnd)), marks: [])
          ),
          .addMark(
            from: caret(block, offset: link.textStart, affinity: "after", revision: revision),
            to: caret(block, offset: link.textEnd, affinity: "before", revision: revision),
            mark: SchemaMark(type: "link", attrs: ["href": .string(link.href), "title": .string("")])
          ),
          .deleteRange(
            from: caret(block, offset: link.textStart - 1, affinity: "before", revision: revision),
            to: caret(block, offset: link.textStart, affinity: "after", revision: revision),
            deletedSlice: textSlice("[", marks: [])
          )
        ],
        storedMarks: storedMarks.filter { $0.type != "link" },
        collapsedOnly: false,
        selectionAfter: caret(block, offset: link.textEnd - 1, affinity: "after", revision: revision),
        isInputRule: false
      )
    }
    for rule in InlineMarkdown.rules where rule.delimiter.hasSuffix(typed) {
      guard let match = InlineMarkdown.match(full, delimiter: rule.delimiter) else {
        continue
      }
      let length = (rule.delimiter as NSString).length
      var ops: [SchemaOperation] = []
      if caretOffset > match.innerEnd {
        ops.append(
          .deleteRange(
            from: caret(block, offset: match.innerEnd, affinity: "before", revision: revision),
            to: caret(block, offset: caretOffset, affinity: "after", revision: revision),
            deletedSlice: textSlice(full.substring(with: NSRange(location: match.innerEnd, length: caretOffset - match.innerEnd)), marks: [])
          )
        )
      }
      ops.append(
        .addMark(
          from: caret(block, offset: match.innerStart, affinity: "after", revision: revision),
          to: caret(block, offset: match.innerEnd, affinity: "before", revision: revision),
          mark: SchemaMark(type: rule.markType)
        )
      )
      ops.append(
        .deleteRange(
          from: caret(block, offset: match.openStart, affinity: "before", revision: revision),
          to: caret(block, offset: match.innerStart, affinity: "after", revision: revision),
          deletedSlice: textSlice(rule.delimiter, marks: [])
        )
      )
      return EditPlan(
        operations: ops,
        storedMarks: storedMarks.filter { $0.type != rule.markType },
        collapsedOnly: false,
        selectionAfter: caret(block, offset: match.innerEnd - length, affinity: "after", revision: revision),
        isInputRule: false
      )
    }
    return nil
  }

  static func isAllowedHref(_ href: String) -> Bool {
    guard let colon = href.firstIndex(of: ":"), colon != href.startIndex else {
      return false
    }
    return allowedHrefSchemes.contains(href[..<colon].lowercased())
  }

  /// Pasted Markdown arrives as schema blocks. A single paragraph flows into the current
  /// block; anything larger lands after the caret's top-level block, splitting it if needed.
  static func insertBlocks(
    _ nodes: [SchemaNode],
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: [LinearMark]
  ) -> EditPlan {
    let blocks = nodes.filter { $0.type != "text" && $0.type != "hardBreak" }
    guard !blocks.isEmpty else {
      return .empty(storedMarks)
    }
    let revision = selection.revision
    var working = linear
    var ops: [SchemaOperation] = []
    var caretSelection = selection
    if let end = selectionEnd, end != selection,
       let fromIndex = LinearModel.indexOfBlock(nodeId: selection.nodeId, in: working),
       LinearModel.indexOfBlock(nodeId: end.nodeId, in: working) == fromIndex {
      let block = working.blocks[fromIndex]
      let lower = min(selection.offsetUtf16, end.offsetUtf16)
      let upper = max(selection.offsetUtf16, end.offsetUtf16)
      let from = caret(block, offset: lower, affinity: "before", revision: revision)
      let removal = SchemaOperation.deleteRange(
        from: from,
        to: caret(block, offset: upper, affinity: "after", revision: revision),
        deletedSlice: textSlice(Utf16.slice(block.plainText, offset: lower, length: upper - lower), marks: [])
      )
      ops.append(removal)
      try? LinearModel.apply([removal], to: &working)
      caretSelection = from
    }
    if working.blocks.isEmpty {
      for (i, node) in blocks.enumerated() {
        ops.append(.insertNode(parentId: linear.id, index: i, node: node))
      }
      return finishInsertBlocks(ops, inserted: blocks, insertAt: 0, linear: linear, storedMarks: storedMarks, revision: revision)
    }
    guard let index = LinearModel.indexOfBlock(nodeId: caretSelection.nodeId, in: working) else {
      return .empty(storedMarks)
    }
    let block = working.blocks[index]
    let offset = min(max(0, caretSelection.offsetUtf16), block.utf16Length)
    if blocks.count == 1, blocks[0].type == "paragraph", !LinearModel.isAtomicKind(block.kind) {
      var position = offset
      for child in blocks[0].content {
        let text = child.type == "hardBreak" ? " " : child.plainText()
        guard !text.isEmpty else { continue }
        ops.append(
          .insertText(
            position: caret(block, offset: position, affinity: "after", revision: revision),
            text: text,
            storedMarks: block.kind == .codeBlock ? [] : child.marks
          )
        )
        position += Utf16.count(text)
      }
      return EditPlan(
        operations: ops,
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: caret(block, offset: position, affinity: "after", revision: revision),
        isInputRule: false
      )
    }
    let tree = LinearModel.linearToDocument(working)
    let top = LinearModel.topLevelIndex(nodeId: block.id, in: tree) ?? index
    let insertAt: Int
    if block.kind == .paragraph, block.quoteChain.isEmpty, block.indent == 0, block.utf16Length == 0,
       let original = LinearModel.findNode(block.id, in: tree) {
      ops.append(.deleteNode(nodeId: block.id, deletedNode: original))
      insertAt = top
    } else if offset == 0 && !LinearModel.isAtomicKind(block.kind) && block.indent == 0 {
      insertAt = top
    } else {
      if offset < block.utf16Length && !LinearModel.isAtomicKind(block.kind) && block.kind != .codeBlock {
        let splitPlan = split(
          at: caret(block, offset: offset, affinity: "before", revision: revision),
          linear: working,
          storedMarks: []
        )
        ops.append(contentsOf: splitPlan.operations)
        try? LinearModel.apply(splitPlan.operations, to: &working)
      }
      let afterSplit = LinearModel.linearToDocument(working)
      insertAt = (LinearModel.topLevelIndex(nodeId: block.id, in: afterSplit) ?? top) + 1
    }
    for (i, node) in blocks.enumerated() {
      ops.append(.insertNode(parentId: linear.id, index: insertAt + i, node: node))
    }
    return finishInsertBlocks(ops, inserted: blocks, insertAt: insertAt, linear: linear, storedMarks: storedMarks, revision: revision)
  }

  private static func finishInsertBlocks(
    _ operations: [SchemaOperation],
    inserted: [SchemaNode],
    insertAt: Int,
    linear: LinearDocument,
    storedMarks: [LinearMark],
    revision: Int
  ) -> EditPlan {
    var ops = operations
    var result = linear
    try? LinearModel.apply(ops, to: &result)
    var ids = Set<String>()
    for node in inserted {
      collectIds(node, into: &ids)
    }
    var selectionAfter: SchemaSelection?
    if let last = result.blocks.lastIndex(where: { ids.contains($0.id) }) {
      let target = result.blocks[last]
      if LinearModel.isAtomicKind(target.kind) {
        if last + 1 < result.blocks.count {
          selectionAfter = caret(result.blocks[last + 1], offset: 0, affinity: "before", revision: revision)
        } else {
          let paragraphId = JotIds.create()
          ops.append(.insertNode(parentId: linear.id, index: insertAt + inserted.count, node: paragraphNode(id: paragraphId, runs: [])))
          selectionAfter = SchemaSelection(nodeId: paragraphId, offsetUtf16: 0, affinity: "before", revision: revision)
        }
      } else {
        selectionAfter = caret(target, offset: target.utf16Length, affinity: "after", revision: revision)
      }
    }
    return EditPlan(
      operations: ops,
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: selectionAfter,
      isInputRule: false
    )
  }

  private static func collectIds(_ node: SchemaNode, into ids: inout Set<String>) {
    ids.insert(node.id)
    for child in node.content {
      collectIds(child, into: &ids)
    }
  }

  private static func setImageWidth(
    nodeId: String,
    widthBasisPoints: Int?,
    linear: LinearDocument,
    selection: SchemaSelection,
    storedMarks: [LinearMark]
  ) -> EditPlan {
    guard let target = LinearModel.block(nodeId: nodeId, in: linear),
          target.kind == .image,
          let json = target.placeholderJSON else {
      return .empty(storedMarks)
    }
    let prior = SchemaNode.parse(json).attrs["widthBasisPoints"]?.intValue() ?? 10000
    let next = min(max(widthBasisPoints ?? prior, minimumImageWidthBasisPoints), 10000)
    if next == prior {
      return .empty(storedMarks)
    }
    return EditPlan(
      operations: [
        .setNodeAttributes(
          nodeId: target.id,
          patch: ["widthBasisPoints": .int(next)],
          priorValues: ["widthBasisPoints": .int(prior)]
        )
      ],
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: selection,
      isInputRule: false
    )
  }

  private static func toggleMark(
    _ type: String,
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: [LinearMark],
    collapsed: Bool
  ) -> EditPlan {
    if collapsed {
      var next = storedMarks.filter { $0.type != type }
      if !storedMarks.contains(where: { $0.type == type }) {
        next.append(LinearMark(type: type))
      }
      return EditPlan(operations: [], storedMarks: next, collapsedOnly: true, selectionAfter: nil, isInputRule: false)
    }
    let from = selection
    let to = selectionEnd ?? selection
    if LinearModel.rangeHasMark(type, from: from, to: to, in: linear) {
      return EditPlan(
        operations: [.removeMark(from: from, to: to, markType: type)],
        storedMarks: storedMarks.filter { $0.type != type },
        collapsedOnly: false,
        selectionAfter: nil,
        isInputRule: false
      )
    }
    return EditPlan(
      operations: [.addMark(from: from, to: to, mark: SchemaMark(type: type))],
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: nil,
      isInputRule: false
    )
  }

  private static func removeMarkOnly(
    _ type: String,
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: [LinearMark],
    collapsed: Bool
  ) -> EditPlan {
    if collapsed {
      guard let block = LinearModel.block(nodeId: selection.nodeId, in: linear) else {
        return EditPlan(operations: [], storedMarks: storedMarks.filter { $0.type != type }, collapsedOnly: true, selectionAfter: nil, isInputRule: false)
      }
      // A caret inside a link removes the whole link run it sits in.
      var offset = 0
      for run in block.runs {
        let length = run.utf16Length
        if selection.offsetUtf16 >= offset && selection.offsetUtf16 <= offset + length,
           run.marks.contains(where: { $0.type == type }), length > 0 {
          return EditPlan(
            operations: [
              .removeMark(
                from: caret(block, offset: offset, affinity: "after", revision: selection.revision),
                to: caret(block, offset: offset + length, affinity: "before", revision: selection.revision),
                markType: type
              )
            ],
            storedMarks: storedMarks.filter { $0.type != type },
            collapsedOnly: false,
            selectionAfter: selection,
            isInputRule: false
          )
        }
        offset += length
      }
      return EditPlan(operations: [], storedMarks: storedMarks.filter { $0.type != type }, collapsedOnly: true, selectionAfter: nil, isInputRule: false)
    }
    return EditPlan(
      operations: [.removeMark(from: selection, to: selectionEnd ?? selection, markType: type)],
      storedMarks: storedMarks.filter { $0.type != type },
      collapsedOnly: false,
      selectionAfter: nil,
      isInputRule: false
    )
  }

  private static func toggleQuote(
    at index: Int,
    linear: LinearDocument,
    storedMarks: [LinearMark],
    caretOffset: Int,
    revision: Int
  ) -> EditPlan {
    var next = linear
    if next.blocks[index].quoteChain.isEmpty {
      next.blocks[index].quoteChain.append(JotIds.create())
    } else {
      next.blocks[index].quoteChain.removeLast()
    }
    let ops = contentDiffOps(
      from: LinearModel.linearToDocument(linear),
      to: LinearModel.linearToDocument(next)
    )
    if ops.isEmpty {
      return .empty(storedMarks)
    }
    let converted = next.blocks[index]
    return EditPlan(
      operations: ops,
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: caret(converted, offset: min(max(0, caretOffset), converted.utf16Length), affinity: "after", revision: revision),
      isInputRule: false
    )
  }

  private static func insertIntoEmpty(
    name: String,
    value: JSONValue?,
    linear: LinearDocument,
    storedMarks: [LinearMark],
    revision: Int
  ) -> EditPlan {
    switch EditorCommandName(rawValue: name) {
    case .insertHorizontalRule:
      return insertAtomicBlock(horizontalRuleNode(), at: -1, linear: linear, storedMarks: storedMarks, revision: revision)
    case .insertImage:
      return insertAtomicBlock(imageNode(value?.objectValue() ?? [:]), at: -1, linear: linear, storedMarks: storedMarks, revision: revision)
    default:
      return .empty(storedMarks)
    }
  }

  private static func horizontalRuleNode() -> SchemaNode {
    SchemaNode(type: "horizontalRule", id: JotIds.create(), attrs: [:], content: [], text: nil, marks: [])
  }

  private static func imageNode(_ fields: [String: JSONValue]) -> SchemaNode {
    let attachmentId: String
    if let id = fields["attachmentId"]?.stringValue(), !id.isEmpty {
      attachmentId = id
    } else {
      attachmentId = JotIds.create()
    }
    let width = fields["widthBasisPoints"]?.intValue() ?? 10000
    return SchemaNode(
      type: "image",
      id: JotIds.create(),
      attrs: [
        "attachmentId": .string(attachmentId),
        "widthBasisPoints": .int(min(max(width, minimumImageWidthBasisPoints), 10000)),
        "alt": .string(fields["alt"]?.stringValue() ?? "")
      ],
      content: [],
      text: nil,
      marks: []
    )
  }

  /// Images and dividers are top-level blocks. Typing continues in a paragraph below them.
  private static func insertAtomicBlock(
    _ node: SchemaNode,
    at index: Int,
    linear: LinearDocument,
    storedMarks: [LinearMark],
    revision: Int
  ) -> EditPlan {
    if linear.blocks.isEmpty || index < 0 {
      let paragraphId = JotIds.create()
      return EditPlan(
        operations: [
          .insertNode(parentId: linear.id, index: 0, node: node),
          .insertNode(parentId: linear.id, index: 1, node: paragraphNode(id: paragraphId, runs: []))
        ],
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: SchemaSelection(nodeId: paragraphId, offsetUtf16: 0, affinity: "before", revision: revision),
        isInputRule: false
      )
    }
    let block = linear.blocks[index]
    let tree = LinearModel.linearToDocument(linear)
    let top = LinearModel.topLevelIndex(nodeId: block.id, in: tree) ?? index
    if block.kind == .paragraph && block.quoteChain.isEmpty && block.indent == 0 && block.utf16Length == 0 {
      return EditPlan(
        operations: [.insertNode(parentId: linear.id, index: top, node: node)],
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: caret(block, offset: 0, affinity: "before", revision: revision),
        isInputRule: false
      )
    }
    var ops: [SchemaOperation] = [.insertNode(parentId: linear.id, index: top + 1, node: node)]
    if top + 1 < tree.content.count {
      let following = tree.content[top + 1]
      if following.type == "paragraph" && following.content.isEmpty {
        return EditPlan(
          operations: ops,
          storedMarks: storedMarks,
          collapsedOnly: false,
          selectionAfter: SchemaSelection(nodeId: following.id, offsetUtf16: 0, affinity: "before", revision: revision),
          isInputRule: false
        )
      }
    }
    let paragraphId = JotIds.create()
    ops.append(.insertNode(parentId: linear.id, index: top + 2, node: paragraphNode(id: paragraphId, runs: [])))
    return EditPlan(
      operations: ops,
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: SchemaSelection(nodeId: paragraphId, offsetUtf16: 0, affinity: "before", revision: revision),
      isInputRule: false
    )
  }

  private static func insertParagraphAfter(
    at index: Int,
    linear: LinearDocument,
    storedMarks: [LinearMark],
    revision: Int
  ) -> EditPlan {
    let id = JotIds.create()
    let block = linear.blocks[index]
    let tree = LinearModel.linearToDocument(linear)
    let loc = LinearModel.parentLocation(nodeId: block.id, in: tree) ?? (linear.id, index)
    return EditPlan(
      operations: [.insertNode(parentId: loc.parentId, index: loc.index + 1, node: paragraphNode(id: id, runs: []))],
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: SchemaSelection(nodeId: id, offsetUtf16: 0, affinity: "before", revision: revision),
      isInputRule: false
    )
  }

  static func deleteBlock(
    at selection: SchemaSelection,
    linear: LinearDocument,
    storedMarks: [LinearMark]
  ) -> EditPlan {
    guard let index = LinearModel.indexOfBlock(nodeId: selection.nodeId, in: linear) else {
      return .empty(storedMarks)
    }
    let block = linear.blocks[index]
    let tree = LinearModel.linearToDocument(linear)
    guard let node = LinearModel.findNode(block.id, in: tree) else {
      return .empty(storedMarks)
    }
    var ops: [SchemaOperation] = [.deleteNode(nodeId: block.id, deletedNode: node)]
    let after: SchemaSelection
    if index > 0 {
      let previous = linear.blocks[index - 1]
      after = caret(previous, offset: previous.utf16Length, affinity: "after", revision: selection.revision)
    } else if index + 1 < linear.blocks.count {
      let next = linear.blocks[index + 1]
      after = caret(next, offset: 0, affinity: "before", revision: selection.revision)
    } else {
      // The note would have no body left, so keep an empty paragraph to type into.
      let paragraphId = JotIds.create()
      ops.append(.insertNode(parentId: linear.id, index: 0, node: paragraphNode(id: paragraphId, runs: [])))
      after = SchemaSelection(nodeId: paragraphId, offsetUtf16: 0, affinity: "before", revision: selection.revision)
    }
    return EditPlan(
      operations: ops,
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: after,
      isInputRule: false
    )
  }

  private static func convertBlock(
    at index: Int,
    to kind: LinearBlockKind,
    headingLevel: Int?,
    checked: Int?,
    listStart: Int?,
    linear: LinearDocument,
    storedMarks: [LinearMark],
    caretOffset: Int = 0,
    revision: Int = 0
  ) -> EditPlan {
    var next = linear
    applyKind(kind, headingLevel: headingLevel, checked: checked, listStart: listStart, to: &next.blocks[index])
    splitFollowingListIfNeeded(at: index, in: &next)
    let ops = contentDiffOps(
      from: LinearModel.linearToDocument(linear),
      to: LinearModel.linearToDocument(next)
    )
    if ops.isEmpty {
      return .empty(storedMarks)
    }
    let converted = next.blocks[index]
    return EditPlan(
      operations: ops,
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: caret(converted, offset: min(max(0, caretOffset), converted.utf16Length), affinity: "after", revision: revision),
      isInputRule: false
    )
  }

  private static func toggleList(
    _ kind: LinearBlockKind,
    at index: Int,
    linear: LinearDocument,
    storedMarks: [LinearMark],
    caretOffset: Int,
    revision: Int
  ) -> EditPlan {
    let current = linear.blocks[index].kind
    if current == kind {
      return convertBlock(at: index, to: .paragraph, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks, caretOffset: caretOffset, revision: revision)
    }
    return convertBlock(
      at: index,
      to: kind,
      headingLevel: nil,
      checked: kind == .taskItem ? 0 : nil,
      listStart: kind == .orderedItem ? 1 : nil,
      linear: linear,
      storedMarks: storedMarks,
      caretOffset: caretOffset,
      revision: revision
    )
  }

  private static func applyKind(
    _ kind: LinearBlockKind,
    headingLevel: Int?,
    checked: Int?,
    listStart: Int?,
    to block: inout LinearBlock
  ) {
    block.kind = kind
    block.headingLevel = kind == .heading ? headingLevel : nil
    if kind == .taskItem {
      block.checked = checked ?? block.checked ?? 0
    } else {
      block.checked = nil
    }
    if kind == .codeBlock {
      block.languageId = block.languageId ?? ""
      // Code has no marks in the schema.
      block.runs = block.runs.map { run in
        var plain = run
        plain.marks = []
        return plain
      }
    } else {
      block.languageId = nil
    }
    if LinearModel.isListKind(kind) {
      block.listId = block.listId ?? JotIds.create()
      block.paragraphId = block.paragraphId ?? JotIds.create()
      block.listStart = kind == .orderedItem ? (listStart ?? block.listStart ?? 1) : nil
    } else {
      block.listId = nil
      block.listStart = nil
      block.paragraphId = nil
    }
  }

  private static func splitFollowingListIfNeeded(at index: Int, in linear: inout LinearDocument) {
    guard !LinearModel.isListKind(linear.blocks[index].kind) else { return }
    guard index + 1 < linear.blocks.count else { return }
    let follower = linear.blocks[index + 1]
    guard LinearModel.isListKind(follower.kind), let oldId = follower.listId else { return }
    let fresh = JotIds.create()
    let indent = follower.indent
    for i in (index + 1)..<linear.blocks.count {
      if linear.blocks[i].indent < indent {
        break
      }
      if linear.blocks[i].indent == indent {
        if linear.blocks[i].listId == oldId && LinearModel.isListKind(linear.blocks[i].kind) {
          linear.blocks[i].listId = fresh
        } else {
          break
        }
      }
    }
  }

  static func contentDiffOps(from oldDoc: SchemaNode, to newDoc: SchemaNode) -> [SchemaOperation] {
    var prefix = 0
    while prefix < oldDoc.content.count && prefix < newDoc.content.count && oldDoc.content[prefix] == newDoc.content[prefix] {
      prefix += 1
    }
    var oldSuffix = oldDoc.content.count
    var newSuffix = newDoc.content.count
    while oldSuffix > prefix && newSuffix > prefix && oldDoc.content[oldSuffix - 1] == newDoc.content[newSuffix - 1] {
      oldSuffix -= 1
      newSuffix -= 1
    }
    var ops: [SchemaOperation] = []
    for node in oldDoc.content[prefix..<oldSuffix].reversed() {
      ops.append(.deleteNode(nodeId: node.id, deletedNode: node))
    }
    for (offset, node) in newDoc.content[prefix..<newSuffix].enumerated() {
      ops.append(.insertNode(parentId: oldDoc.id, index: prefix + offset, node: node))
    }
    return ops
  }

  private static func itemIndex(at blockIndex: Int, in linear: LinearDocument) -> Int {
    let block = linear.blocks[blockIndex]
    var count = 0
    for i in 0..<blockIndex {
      let candidate = linear.blocks[i]
      if candidate.listId == block.listId && candidate.indent == block.indent && candidate.kind == block.kind {
        count += 1
      }
    }
    return count
  }

  private static func previousSiblingItem(at index: Int, in linear: LinearDocument) -> (index: Int, block: LinearBlock)? {
    let block = linear.blocks[index]
    var i = index - 1
    while i >= 0 {
      let candidate = linear.blocks[i]
      if candidate.indent < block.indent {
        return nil
      }
      if candidate.indent == block.indent && candidate.kind == block.kind && candidate.listId == block.listId {
        return (i, candidate)
      }
      i -= 1
    }
    return nil
  }

  private static func caret(_ block: LinearBlock, offset: Int, affinity: String, revision: Int) -> SchemaSelection {
    SchemaSelection(
      nodeId: block.paragraphId ?? block.id,
      offsetUtf16: offset,
      affinity: affinity,
      revision: revision
    )
  }

  private static func textSlice(_ text: String, marks: [LinearMark]) -> [SchemaNode] {
    [LinearModel.textNode(text, marks: marks)]
  }

  private static func paragraphNode(id: String, runs: [LinearRun]) -> SchemaNode {
    let content = runs
      .filter { !$0.isPlaceholder && !$0.text.isEmpty }
      .map { LinearModel.textNode($0.text, marks: $0.marks) }
    return SchemaNode(type: "paragraph", id: id, attrs: [:], content: content, text: nil, marks: [])
  }

  private static func listItemNode(
    kind: LinearBlockKind,
    id: String,
    paragraphId: String,
    runs: [LinearRun],
    checked: Int?
  ) -> SchemaNode {
    let paragraph = paragraphNode(id: paragraphId, runs: runs)
    if kind == .taskItem {
      return SchemaNode(
        type: "taskItem",
        id: id,
        attrs: ["checked": .int(checked ?? 0)],
        content: [paragraph],
        text: nil,
        marks: []
      )
    }
    return SchemaNode(type: "listItem", id: id, attrs: [:], content: [paragraph], text: nil, marks: [])
  }
}

enum InlineMarkdown {
  struct Rule {
    let delimiter: String
    let markType: String
  }

  /// Longer delimiters first, so `**` wins over `*`.
  static let rules: [Rule] = [
    Rule(delimiter: "**", markType: "bold"),
    Rule(delimiter: "__", markType: "bold"),
    Rule(delimiter: "~~", markType: "strikethrough"),
    Rule(delimiter: "*", markType: "italic"),
    Rule(delimiter: "_", markType: "italic"),
    Rule(delimiter: "`", markType: "inlineCode")
  ]

  static let triggers: Set<String> = ["*", "_", "~", "`", ")"]

  private static let linkPattern = try? NSRegularExpression(pattern: "\\[([^\\[\\]\\n]+)\\]\\(([^()\\s]+)\\)$")

  /// `full` is the block text before the caret plus the character being typed.
  static func match(_ full: NSString, delimiter: String) -> (openStart: Int, innerStart: Int, innerEnd: Int)? {
    let marker = delimiter as NSString
    let length = marker.length
    let count = full.length
    guard count >= length * 2 + 1, full.substring(from: count - length) == delimiter else {
      return nil
    }
    let innerEnd = count - length
    let markerChar = marker.character(at: 0)
    let lastInner = full.character(at: innerEnd - 1)
    if isSpace(lastInner) || lastInner == markerChar {
      return nil
    }
    var search = NSRange(location: 0, length: innerEnd - 1)
    while search.length > 0 {
      let found = full.range(of: delimiter, options: .backwards, range: search)
      if found.location == NSNotFound {
        return nil
      }
      let innerStart = found.location + length
      let before: unichar? = found.location > 0 ? full.character(at: found.location - 1) : nil
      let valid = innerStart < innerEnd
        && !isSpace(full.character(at: innerStart))
        && full.character(at: innerStart) != markerChar
        && before != markerChar
        && !(markerChar == 0x5F && before.map(isWordChar) == true)
      if valid {
        let inner = full.substring(with: NSRange(location: innerStart, length: innerEnd - innerStart))
        if inner.contains("\n") || inner.contains("\u{2028}") {
          return nil
        }
        return (found.location, innerStart, innerEnd)
      }
      search = NSRange(location: 0, length: found.location)
    }
    return nil
  }

  static func matchLink(_ full: NSString) -> (textStart: Int, textEnd: Int, href: String)? {
    guard let regex = linkPattern,
          let result = regex.firstMatch(in: full as String, range: NSRange(location: 0, length: full.length)) else {
      return nil
    }
    let text = result.range(at: 1)
    let url = result.range(at: 2)
    return (text.location, text.location + text.length, full.substring(with: url))
  }

  private static func isSpace(_ unit: unichar) -> Bool {
    guard let scalar = UnicodeScalar(unit) else { return false }
    return CharacterSet.whitespacesAndNewlines.contains(scalar)
  }

  private static func isWordChar(_ unit: unichar) -> Bool {
    guard let scalar = UnicodeScalar(unit) else { return false }
    return CharacterSet.alphanumerics.contains(scalar)
  }
}

enum NativeInputRules {
  struct Rule {
    var id: String
    var kind: LinearBlockKind
    var headingLevel: Int?
    var checked: Int?
    var listStart: Int?
    var quote: Bool
    var matches: (String) -> Bool

    init(
      id: String,
      kind: LinearBlockKind,
      headingLevel: Int?,
      checked: Int?,
      listStart: Int?,
      quote: Bool = false,
      matches: @escaping (String) -> Bool
    ) {
      self.id = id
      self.kind = kind
      self.headingLevel = headingLevel
      self.checked = checked
      self.listStart = listStart
      self.quote = quote
      self.matches = matches
    }
  }

  static let dividerMarkers: Set<String> = ["---", "***", "___"]

  static let rules: [Rule] = [
    Rule(id: "heading-1", kind: .heading, headingLevel: 1, checked: nil, listStart: nil) { $0 == "#" },
    Rule(id: "heading-2", kind: .heading, headingLevel: 2, checked: nil, listStart: nil) { $0 == "##" },
    Rule(id: "heading-3", kind: .heading, headingLevel: 3, checked: nil, listStart: nil) { $0 == "###" },
    Rule(id: "heading-4", kind: .heading, headingLevel: 4, checked: nil, listStart: nil) { $0 == "####" },
    Rule(id: "heading-5", kind: .heading, headingLevel: 5, checked: nil, listStart: nil) { $0 == "#####" },
    Rule(id: "heading-6", kind: .heading, headingLevel: 6, checked: nil, listStart: nil) { $0 == "######" },
    Rule(id: "bullet", kind: .bulletItem, headingLevel: nil, checked: nil, listStart: nil) { $0 == "-" },
    Rule(id: "bullet-star", kind: .bulletItem, headingLevel: nil, checked: nil, listStart: nil) { $0 == "*" },
    Rule(id: "bullet-plus", kind: .bulletItem, headingLevel: nil, checked: nil, listStart: nil) { $0 == "+" },
    Rule(id: "ordered", kind: .orderedItem, headingLevel: nil, checked: nil, listStart: 1) { $0 == "1." },
    Rule(id: "task-unchecked", kind: .taskItem, headingLevel: nil, checked: 0, listStart: nil) { $0 == "[]" || $0 == "[ ]" },
    Rule(id: "task-checked", kind: .taskItem, headingLevel: nil, checked: 1, listStart: nil) { $0 == "[x]" || $0 == "[X]" },
    Rule(id: "code", kind: .codeBlock, headingLevel: nil, checked: nil, listStart: nil) { $0 == "```" },
    Rule(id: "quote", kind: .paragraph, headingLevel: nil, checked: nil, listStart: nil, quote: true) { $0 == ">" }
  ]

  static func match(_ text: String) -> Rule? {
    rules.first { $0.matches(text) }
  }
}
