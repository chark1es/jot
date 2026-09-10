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
    switch EditorCommandName(rawValue: name) {
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
      let href = value?.objectValue()["href"]?.stringValue() ?? ""
      if href.isEmpty {
        return .empty(storedMarks)
      }
      let title = value?.objectValue()["title"]?.stringValue() ?? ""
      return replaceMark(
        "link",
        attrs: ["href": .string(href), "title": .string(title)],
        linear: linear,
        selection: selection,
        selectionEnd: selectionEnd,
        storedMarks: storedMarks,
        collapsed: collapsed
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
      let level = value?.intValue() ?? value?.objectValue()["level"]?.intValue() ?? 1
      if block.kind == .heading {
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
          selectionAfter: nil,
          isInputRule: false
        )
      }
      return convertBlock(at: index, to: .heading, headingLevel: level, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks)
    case .setParagraph:
      return convertBlock(at: index, to: .paragraph, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks)
    case .toggleBulletList:
      return toggleList(.bulletItem, at: index, linear: linear, storedMarks: storedMarks)
    case .toggleOrderedList:
      return toggleList(.orderedItem, at: index, linear: linear, storedMarks: storedMarks)
    case .toggleTaskList:
      return toggleList(.taskItem, at: index, linear: linear, storedMarks: storedMarks)
    case .toggleCodeBlock:
      let next: LinearBlockKind = block.kind == .codeBlock ? .paragraph : .codeBlock
      return convertBlock(at: index, to: next, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks)
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
      return toggleQuote(at: index, linear: linear, storedMarks: storedMarks)
    case .insertHorizontalRule:
      return insertBlockAfter(
        SchemaNode(
          type: "horizontalRule",
          id: JotIds.create(),
          attrs: [:],
          content: [],
          text: nil,
          marks: []
        ),
        at: index,
        linear: linear,
        storedMarks: storedMarks,
        revision: selection.revision
      )
    case .insertImage:
      let fields = value?.objectValue() ?? [:]
      let attachmentId: String
      if let id = fields["attachmentId"]?.stringValue(), !id.isEmpty {
        attachmentId = id
      } else {
        attachmentId = JotIds.create()
      }
      let alt = fields["alt"]?.stringValue() ?? ""
      let width = fields["widthBasisPoints"]?.intValue() ?? 10000
      return insertBlockAfter(
        SchemaNode(
          type: "image",
          id: JotIds.create(),
          attrs: [
            "attachmentId": .string(attachmentId),
            "widthBasisPoints": .int(min(max(width, 1), 10000)),
            "alt": .string(alt)
          ],
          content: [],
          text: nil,
          marks: []
        ),
        at: index,
        linear: linear,
        storedMarks: storedMarks,
        revision: selection.revision
      )
    case nil:
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
      return convertBlock(at: index, to: .paragraph, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks)
    }
    if !block.quoteChain.isEmpty && block.plainText.isEmpty {
      return toggleQuote(at: index, linear: linear, storedMarks: storedMarks)
    }
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
        text: tail,
        checked: block.kind == .taskItem ? (block.checked ?? 0) : nil,
        marks: storedMarks
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
    let node = paragraphNode(id: newId, text: tail, marks: storedMarks)
    if block.kind == .heading {
      var after = node
      after.type = "paragraph"
      let parent = LinearModel.linearToDocument(linear)
      let loc = LinearModel.parentLocation(nodeId: block.id, in: parent) ?? (linear.id, index)
      ops.append(.insertNode(parentId: loc.parentId, index: loc.index + 1, node: after))
      return EditPlan(
        operations: ops,
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: SchemaSelection(nodeId: newId, offsetUtf16: 0, affinity: "before", revision: selection.revision),
        isInputRule: false
      )
    }
    let parent = LinearModel.linearToDocument(linear)
    let loc = LinearModel.parentLocation(nodeId: block.id, in: parent) ?? (linear.id, index)
    ops.append(.insertNode(parentId: loc.parentId, index: loc.index + 1, node: node))
    return EditPlan(
      operations: ops,
      storedMarks: storedMarks,
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
        if !block.plainText.isEmpty {
          ops.append(.insertText(position: from, text: block.plainText, storedMarks: storedMarks.map { $0.toSchema() }))
        }
        let tree = LinearModel.linearToDocument(linear)
        if let item = findNode(block.id, in: tree) {
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
      return convertBlock(at: index, to: .paragraph, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks)
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

  private static func toggleMark(
    _ type: String,
    attrs: [String: JSONValue] = [:],
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: [LinearMark],
    collapsed: Bool
  ) -> EditPlan {
    if collapsed {
      var next = storedMarks.filter { $0.type != type }
      if storedMarks.contains(where: { $0.type == type }) == false {
        next.append(LinearMark(type: type, attrs: attrs))
      }
      if let block = LinearModel.block(nodeId: selection.nodeId, in: linear) {
        let current = block.markTypes(at: max(0, selection.offsetUtf16 - 1))
        if storedMarks.isEmpty {
          next = current.filter { $0.type != type }
          if current.contains(where: { $0.type == type }) == false {
            next.append(LinearMark(type: type, attrs: attrs))
          }
        }
      }
      return EditPlan(operations: [], storedMarks: next, collapsedOnly: true, selectionAfter: nil, isInputRule: false)
    }
    let has = LinearModel.block(nodeId: selection.nodeId, in: linear)?
      .markTypes(at: selection.offsetUtf16)
      .contains(where: { $0.type == type }) ?? false
    let from = selection
    let to = selectionEnd ?? selection
    if has {
      return EditPlan(
        operations: [.removeMark(from: from, to: to, markType: type)],
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: nil,
        isInputRule: false
      )
    }
    return EditPlan(
      operations: [.addMark(from: from, to: to, mark: SchemaMark(type: type, attrs: attrs))],
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: nil,
      isInputRule: false
    )
  }

  private static func replaceMark(
    _ type: String,
    attrs: [String: JSONValue],
    linear: LinearDocument,
    selection: SchemaSelection,
    selectionEnd: SchemaSelection?,
    storedMarks: [LinearMark],
    collapsed: Bool
  ) -> EditPlan {
    let mark = LinearMark(type: type, attrs: attrs)
    if collapsed {
      var next = storedMarks.filter { $0.type != type }
      next.append(mark)
      return EditPlan(operations: [], storedMarks: next, collapsedOnly: true, selectionAfter: nil, isInputRule: false)
    }
    return EditPlan(
      operations: [
        .addMark(from: selection, to: selectionEnd ?? selection, mark: mark.toSchema())
      ],
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
      let next = storedMarks.filter { $0.type != type }
      return EditPlan(operations: [], storedMarks: next, collapsedOnly: true, selectionAfter: nil, isInputRule: false)
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
    storedMarks: [LinearMark]
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
      selectionAfter: caret(converted, offset: 0, affinity: "before", revision: 0),
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
      return insertBlockAfter(
        SchemaNode(
          type: "horizontalRule",
          id: JotIds.create(),
          attrs: [:],
          content: [],
          text: nil,
          marks: []
        ),
        at: -1,
        linear: linear,
        storedMarks: storedMarks,
        revision: revision
      )
    case .insertImage:
      let fields = value?.objectValue() ?? [:]
      let attachmentId: String
      if let id = fields["attachmentId"]?.stringValue(), !id.isEmpty {
        attachmentId = id
      } else {
        attachmentId = JotIds.create()
      }
      return insertBlockAfter(
        SchemaNode(
          type: "image",
          id: JotIds.create(),
          attrs: [
            "attachmentId": .string(attachmentId),
            "widthBasisPoints": .int(fields["widthBasisPoints"]?.intValue() ?? 10000),
            "alt": .string(fields["alt"]?.stringValue() ?? "")
          ],
          content: [],
          text: nil,
          marks: []
        ),
        at: -1,
        linear: linear,
        storedMarks: storedMarks,
        revision: revision
      )
    default:
      return .empty(storedMarks)
    }
  }

  private static func insertBlockAfter(
    _ node: SchemaNode,
    at index: Int,
    linear: LinearDocument,
    storedMarks: [LinearMark],
    revision: Int
  ) -> EditPlan {
    if linear.blocks.isEmpty || index < 0 {
      return EditPlan(
        operations: [.insertNode(parentId: linear.id, index: 0, node: node)],
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: SchemaSelection(nodeId: node.id, offsetUtf16: 0, affinity: "before", revision: revision),
        isInputRule: false
      )
    }
    let block = linear.blocks[index]
    let parent = LinearModel.linearToDocument(linear)
    let loc = LinearModel.parentLocation(nodeId: block.id, in: parent) ?? (linear.id, index)
    return EditPlan(
      operations: [.insertNode(parentId: loc.parentId, index: loc.index + 1, node: node)],
      storedMarks: storedMarks,
      collapsedOnly: false,
      selectionAfter: SchemaSelection(nodeId: node.id, offsetUtf16: 0, affinity: "before", revision: revision),
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
    return insertBlockAfter(
      paragraphNode(id: id, text: "", marks: storedMarks),
      at: index,
      linear: linear,
      storedMarks: storedMarks,
      revision: revision
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
    guard let node = findNode(block.id, in: tree) else {
      return .empty(storedMarks)
    }
    let after: SchemaSelection
    if index > 0 {
      let previous = linear.blocks[index - 1]
      after = caret(previous, offset: previous.utf16Length, affinity: "after", revision: selection.revision)
    } else if index + 1 < linear.blocks.count {
      let next = linear.blocks[index + 1]
      after = caret(next, offset: 0, affinity: "before", revision: selection.revision)
    } else {
      after = SchemaSelection(nodeId: linear.id, offsetUtf16: 0, affinity: "before", revision: selection.revision)
    }
    return EditPlan(
      operations: [.deleteNode(nodeId: block.id, deletedNode: node)],
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
    storedMarks: [LinearMark]
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
      selectionAfter: caret(converted, offset: min(converted.utf16Length, 0), affinity: "before", revision: 0),
      isInputRule: false
    )
  }

  private static func toggleList(
    _ kind: LinearBlockKind,
    at index: Int,
    linear: LinearDocument,
    storedMarks: [LinearMark]
  ) -> EditPlan {
    let current = linear.blocks[index].kind
    if current == kind {
      return convertBlock(at: index, to: .paragraph, headingLevel: nil, checked: nil, listStart: nil, linear: linear, storedMarks: storedMarks)
    }
    return convertBlock(at: index, to: kind, headingLevel: nil, checked: kind == .taskItem ? 0 : nil, listStart: kind == .orderedItem ? 1 : nil, linear: linear, storedMarks: storedMarks)
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
    if kind != .codeBlock {
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

  private static func findNode(_ nodeId: String, in tree: SchemaNode) -> SchemaNode? {
    if tree.id == nodeId {
      return tree
    }
    for child in tree.content {
      if let found = findNode(nodeId, in: child) {
        return found
      }
    }
    return nil
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
    [
      SchemaNode(
        type: "text",
        id: JotIds.create(),
        attrs: [:],
        content: [],
        text: text,
        marks: marks.map { $0.toSchema() }
      )
    ]
  }

  private static func paragraphNode(id: String, text: String, marks: [LinearMark]) -> SchemaNode {
    var content: [SchemaNode] = []
    if !text.isEmpty {
      content = textSlice(text, marks: marks)
    }
    return SchemaNode(type: "paragraph", id: id, attrs: [:], content: content, text: nil, marks: [])
  }

  private static func listItemNode(
    kind: LinearBlockKind,
    id: String,
    paragraphId: String,
    text: String,
    checked: Int?,
    marks: [LinearMark]
  ) -> SchemaNode {
    let paragraph = paragraphNode(id: paragraphId, text: text, marks: marks)
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

  static let rules: [Rule] = [
    Rule(id: "heading-1", kind: .heading, headingLevel: 1, checked: nil, listStart: nil) { $0 == "#" },
    Rule(id: "heading-2", kind: .heading, headingLevel: 2, checked: nil, listStart: nil) { $0 == "##" },
    Rule(id: "heading-3", kind: .heading, headingLevel: 3, checked: nil, listStart: nil) { $0 == "###" },
    Rule(id: "heading-4", kind: .heading, headingLevel: 4, checked: nil, listStart: nil) { $0 == "####" },
    Rule(id: "heading-5", kind: .heading, headingLevel: 5, checked: nil, listStart: nil) { $0 == "#####" },
    Rule(id: "heading-6", kind: .heading, headingLevel: 6, checked: nil, listStart: nil) { $0 == "######" },
    Rule(id: "bullet", kind: .bulletItem, headingLevel: nil, checked: nil, listStart: nil) { $0 == "-" },
    Rule(id: "ordered", kind: .orderedItem, headingLevel: nil, checked: nil, listStart: 1) { $0 == "1." },
    Rule(id: "task-unchecked", kind: .taskItem, headingLevel: nil, checked: 0, listStart: nil) { $0 == "[]" },
    Rule(id: "task-checked", kind: .taskItem, headingLevel: nil, checked: 1, listStart: nil) { $0 == "[x]" || $0 == "[X]" },
    Rule(id: "code", kind: .codeBlock, headingLevel: nil, checked: nil, listStart: nil) { $0 == "```" },
    Rule(id: "quote", kind: .paragraph, headingLevel: nil, checked: nil, listStart: nil, quote: true) { $0 == ">" }
  ]

  static func match(_ text: String) -> Rule? {
    rules.first { $0.matches(text) }
  }
}
