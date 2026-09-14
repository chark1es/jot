import Foundation

struct LinearMark: Equatable {
  var type: String
  var attrs: [String: JSONValue]

  init(type: String, attrs: [String: JSONValue] = [:]) {
    self.type = type
    self.attrs = attrs
  }

  var isBold: Bool { type == "bold" }
  var isItalic: Bool { type == "italic" }
  var isUnderline: Bool { type == "underline" }
  var isStrikethrough: Bool { type == "strikethrough" }
  var isInlineCode: Bool { type == "inlineCode" }
  var isLink: Bool { type == "link" }

  var href: String? { attrs["href"]?.stringValue() }
  var title: String { attrs["title"]?.stringValue() ?? "" }

  func toSchema() -> SchemaMark {
    SchemaMark(type: type, attrs: attrs)
  }

  static func from(_ mark: SchemaMark) -> LinearMark {
    LinearMark(type: mark.type, attrs: mark.attrs)
  }
}

struct LinearRun: Equatable {
  var text: String
  var marks: [LinearMark]
  var id: String?
  var placeholderJSON: JSONValue?
  var fallbackText: String

  init(
    text: String,
    marks: [LinearMark] = [],
    id: String? = nil,
    placeholderJSON: JSONValue? = nil,
    fallbackText: String = ""
  ) {
    self.text = text
    self.marks = marks
    self.id = id
    self.placeholderJSON = placeholderJSON
    self.fallbackText = fallbackText
  }

  var isPlaceholder: Bool { placeholderJSON != nil }

  var utf16Length: Int {
    if isPlaceholder {
      return 1
    }
    return Utf16.count(text)
  }

  var attributedText: String {
    if isPlaceholder {
      return "\u{FFFC}"
    }
    return text
  }
}

enum LinearBlockKind: String, Equatable {
  case paragraph
  case heading
  case codeBlock
  case bulletItem
  case orderedItem
  case taskItem
  case placeholder
  case horizontalRule
  case image
}

struct LinearBlock: Equatable {
  var id: String
  var kind: LinearBlockKind
  var headingLevel: Int?
  var listStart: Int?
  var checked: Int?
  var indent: Int
  var runs: [LinearRun]
  var languageId: String?
  var paragraphId: String?
  var listId: String?
  var quoteChain: [String] = []
  var placeholderJSON: JSONValue?

  var quoteDepth: Int { quoteChain.count }

  var utf16Length: Int {
    runs.reduce(0) { $0 + $1.utf16Length }
  }

  var plainText: String {
    runs.map { $0.isPlaceholder ? $0.fallbackText : $0.text }.joined()
  }

  func markTypes(at offset: Int) -> [LinearMark] {
    var remaining = offset
    for run in runs {
      let length = run.utf16Length
      if remaining <= length {
        return run.marks
      }
      remaining -= length
    }
    return runs.last?.marks ?? []
  }
}

struct LinearDocument: Equatable {
  var id: String
  var blocks: [LinearBlock]
}

enum LinearModel {
  static let objectReplacement = "\u{FFFC}"

  static func documentToLinear(_ doc: SchemaNode) -> LinearDocument {
    var blocks: [LinearBlock] = []
    flatten(doc.content, indent: 0, into: &blocks)
    return LinearDocument(id: doc.id, blocks: blocks)
  }

  /// Same derivation as `emptyDocument` and `apply-operations` in TypeScript, so the first
  /// keystroke in an empty note targets an id every layer agrees on.
  static func bodyParagraphId(_ docId: String) -> String {
    JotIds.derive(parentId: docId, purpose: "paragraph", index: 0)
  }

  static func withEditableBody(_ linear: LinearDocument) -> LinearDocument {
    guard linear.blocks.isEmpty else { return linear }
    var next = linear
    next.blocks = [LinearBlock(id: bodyParagraphId(linear.id), kind: .paragraph, indent: 0, runs: [])]
    return next
  }

  static func linearToDocument(_ linear: LinearDocument) -> SchemaNode {
    let content = nestBlocks(linear.blocks, from: 0, minIndent: 0).nodes
    return SchemaNode(type: "doc", id: linear.id, attrs: [:], content: content, text: nil, marks: [])
  }

  static func apply(_ operations: [SchemaOperation], to linear: inout LinearDocument) throws {
    for operation in operations {
      try apply(operation, to: &linear)
    }
  }

  static func apply(_ operation: SchemaOperation, to linear: inout LinearDocument) throws {
    switch operation {
    case let .insertText(position, text, storedMarks):
      guard !Utf16.hasUnpairedSurrogates(text) else {
        throw LinearError.unpairedSurrogate
      }
      insertText(text, at: position, marks: storedMarks.map { LinearMark.from($0) }, in: &linear)
    case let .deleteRange(from, to, _):
      deleteRange(from: from, to: to, in: &linear)
    case let .replaceRange(from, to, slice, _):
      deleteRange(from: from, to: to, in: &linear)
      let text = slice.map { $0.plainText() }.joined()
      let marks = firstMarks(in: slice)
      insertText(text, at: from, marks: marks, in: &linear)
    case let .addMark(from, to, mark):
      applyMark(LinearMark.from(mark), from: from, to: to, add: true, in: &linear)
    case let .removeMark(from, to, markType):
      applyMark(LinearMark(type: markType), from: from, to: to, add: false, in: &linear)
    case let .setNodeAttributes(nodeId, patch, _):
      setAttributes(nodeId: nodeId, patch: patch, in: &linear)
    case let .insertNode(parentId, index, node):
      var tree = linearToDocument(linear)
      tree = insertNode(node, parentId: parentId, index: index, into: tree)
      linear = documentToLinear(tree)
    case let .deleteNode(nodeId, _):
      var tree = linearToDocument(linear)
      tree = deleteNode(nodeId: nodeId, from: tree)
      linear = documentToLinear(tree)
    }
  }

  static func indexOfBlock(nodeId: String, in linear: LinearDocument) -> Int? {
    linear.blocks.firstIndex { $0.id == nodeId || $0.paragraphId == nodeId }
  }

  static func block(nodeId: String, in linear: LinearDocument) -> LinearBlock? {
    guard let index = indexOfBlock(nodeId: nodeId, in: linear) else { return nil }
    return linear.blocks[index]
  }

  static func isListKind(_ kind: LinearBlockKind) -> Bool {
    kind == .bulletItem || kind == .orderedItem || kind == .taskItem
  }

  static func isAtomicKind(_ kind: LinearBlockKind) -> Bool {
    kind == .horizontalRule || kind == .image || kind == .placeholder
  }

  /// Characters drawn before a block's text: a quote bar, then a bullet, number, or checkbox.
  static func leadingCount(_ block: LinearBlock) -> Int {
    (isListKind(block.kind) ? 1 : 0) + (block.quoteChain.isEmpty ? 0 : 1)
  }

  static func parentLocation(nodeId: String, in tree: SchemaNode) -> (parentId: String, index: Int)? {
    for (index, child) in tree.content.enumerated() {
      if child.id == nodeId {
        return (tree.id, index)
      }
      if let nested = parentLocation(nodeId: nodeId, in: child) {
        return nested
      }
    }
    return nil
  }

  enum LinearError: Error {
    case unpairedSurrogate
    case unsupportedMark(String)
  }

  private static func flatten(
    _ nodes: [SchemaNode],
    indent: Int,
    quoteChain: [String] = [],
    into blocks: inout [LinearBlock]
  ) {
    for node in nodes {
      switch node.type {
      case "paragraph":
        blocks.append(
          LinearBlock(
            id: node.id,
            kind: .paragraph,
            indent: indent,
            runs: inlineRuns(node.content),
            quoteChain: quoteChain
          )
        )
      case "heading":
        blocks.append(
          LinearBlock(
            id: node.id,
            kind: .heading,
            headingLevel: node.attrs["level"]?.intValue() ?? 1,
            indent: indent,
            runs: inlineRuns(node.content),
            quoteChain: quoteChain
          )
        )
      case "codeBlock":
        blocks.append(
          LinearBlock(
            id: node.id,
            kind: .codeBlock,
            indent: indent,
            runs: codeRuns(node.content),
            languageId: node.attrs["languageId"]?.stringValue() ?? "",
            quoteChain: quoteChain
          )
        )
      case "blockquote":
        flatten(node.content, indent: indent, quoteChain: quoteChain + [node.id], into: &blocks)
      case "horizontalRule":
        blocks.append(
          LinearBlock(
            id: node.id,
            kind: .horizontalRule,
            indent: indent,
            runs: [
              LinearRun(text: objectReplacement, id: node.id, fallbackText: "divider")
            ],
            quoteChain: quoteChain
          )
        )
      case "image":
        let alt = node.attrs["alt"]?.stringValue() ?? ""
        blocks.append(
          LinearBlock(
            id: node.id,
            kind: .image,
            indent: indent,
            runs: [
              LinearRun(
                text: objectReplacement,
                id: node.id,
                placeholderJSON: node.toJSON(),
                fallbackText: alt
              )
            ],
            quoteChain: quoteChain,
            placeholderJSON: node.toJSON()
          )
        )
      case "bulletList":
        flattenList(node, kind: .bulletItem, indent: indent, quoteChain: quoteChain, into: &blocks)
      case "orderedList":
        flattenList(node, kind: .orderedItem, indent: indent, quoteChain: quoteChain, into: &blocks)
      case "taskList":
        flattenList(node, kind: .taskItem, indent: indent, quoteChain: quoteChain, into: &blocks)
      default:
        blocks.append(
          LinearBlock(
            id: node.id,
            kind: .placeholder,
            indent: indent,
            runs: [
              LinearRun(
                text: objectReplacement,
                id: node.id,
                placeholderJSON: node.toJSON(),
                fallbackText: node.plainText()
              )
            ],
            quoteChain: quoteChain,
            placeholderJSON: node.toJSON()
          )
        )
      }
    }
  }

  private static func flattenList(
    _ list: SchemaNode,
    kind: LinearBlockKind,
    indent: Int,
    quoteChain: [String],
    into blocks: inout [LinearBlock]
  ) {
    let start = list.attrs["start"]?.intValue()
    for (index, item) in list.content.enumerated() {
      var runs: [LinearRun] = []
      var paragraphId: String?
      var nested: [SchemaNode] = []
      for child in item.content {
        if child.type == "paragraph" {
          if paragraphId == nil {
            paragraphId = child.id
            runs.append(contentsOf: inlineRuns(child.content))
          } else {
            runs.append(LinearRun(text: "\n"))
            runs.append(contentsOf: inlineRuns(child.content))
          }
        } else if child.type == "bulletList" || child.type == "orderedList" || child.type == "taskList" {
          nested.append(child)
        } else if child.type == "listItem" || child.type == "taskItem" {
          continue
        } else {
          nested.append(child)
        }
      }
      blocks.append(
        LinearBlock(
          id: item.id,
          kind: kind,
          listStart: index == 0 ? start : nil,
          checked: item.attrs["checked"]?.intValue(),
          indent: indent,
          runs: runs,
          paragraphId: paragraphId,
          listId: list.id,
          quoteChain: quoteChain
        )
      )
      flatten(nested, indent: indent + 1, quoteChain: quoteChain, into: &blocks)
    }
  }

  private static func inlineRuns(_ nodes: [SchemaNode]) -> [LinearRun] {
    nodes.map { node in
      switch node.type {
      case "text":
        return LinearRun(
          text: node.text ?? "",
          marks: node.marks.map { LinearMark.from($0) },
          id: node.id
        )
      case "hardBreak":
        return LinearRun(text: "\u{2028}", id: node.id)
      default:
        return LinearRun(
          text: objectReplacement,
          id: node.id,
          placeholderJSON: node.toJSON(),
          fallbackText: node.plainText()
        )
      }
    }
  }

  private static func codeRuns(_ nodes: [SchemaNode]) -> [LinearRun] {
    nodes.map { node in
      LinearRun(text: node.type == "text" ? (node.text ?? "") : node.plainText(), id: node.id)
    }
  }

  private static func nestBlocks(
    _ blocks: [LinearBlock],
    from start: Int,
    minIndent: Int,
    minQuote: Int = 0,
    expectedQuote: String? = nil
  ) -> (nodes: [SchemaNode], next: Int) {
    var nodes: [SchemaNode] = []
    var i = start
    while i < blocks.count {
      let block = blocks[i]
      if block.indent < minIndent {
        break
      }
      if let expectedQuote {
        if block.quoteChain.count < minQuote {
          break
        }
        if minQuote > 0 && block.quoteChain[minQuote - 1] != expectedQuote {
          break
        }
      } else if minQuote > 0 && block.quoteChain.count < minQuote {
        break
      }
      if block.quoteChain.count > minQuote {
        let quoteId = block.quoteChain[minQuote]
        let parsed = nestBlocks(
          blocks,
          from: i,
          minIndent: minIndent,
          minQuote: minQuote + 1,
          expectedQuote: quoteId
        )
        nodes.append(
          SchemaNode(
            type: "blockquote",
            id: quoteId,
            attrs: [:],
            content: parsed.nodes,
            text: nil,
            marks: []
          )
        )
        i = parsed.next
        continue
      }
      switch block.kind {
      case .paragraph, .heading, .codeBlock, .placeholder, .horizontalRule, .image:
        nodes.append(blockToNode(block))
        i += 1
      case .bulletItem, .orderedItem, .taskItem:
        let parsed = parseList(
          blocks,
          from: i,
          indent: block.indent,
          kind: block.kind,
          minQuote: minQuote,
          expectedQuote: expectedQuote
        )
        nodes.append(parsed.node)
        i = parsed.next
      }
    }
    return (nodes, i)
  }

  private static func parseList(
    _ blocks: [LinearBlock],
    from start: Int,
    indent: Int,
    kind: LinearBlockKind,
    minQuote: Int,
    expectedQuote: String?
  ) -> (node: SchemaNode, next: Int) {
    let first = blocks[start]
    let listId = first.listId ?? JotIds.create()
    var items: [SchemaNode] = []
    var i = start
    var listStart = first.listStart
    while i < blocks.count {
      let block = blocks[i]
      if block.indent < indent {
        break
      }
      if block.quoteChain.count != minQuote {
        break
      }
      if let expectedQuote, minQuote > 0, block.quoteChain[minQuote - 1] != expectedQuote {
        break
      }
      if block.indent == indent && (block.kind != kind || (block.listId != nil && first.listId != nil && block.listId != first.listId)) {
        break
      }
      if block.indent > indent {
        break
      }
      if listStart == nil {
        listStart = block.listStart
      }
      i += 1
      let nested = nestBlocks(
        blocks,
        from: i,
        minIndent: indent + 1,
        minQuote: minQuote,
        expectedQuote: expectedQuote
      )
      i = nested.next
      items.append(itemNode(block, nested: nested.nodes))
    }
    var attrs: [String: JSONValue] = [:]
    let listType: String
    switch kind {
    case .bulletItem:
      listType = "bulletList"
    case .orderedItem:
      listType = "orderedList"
      attrs["start"] = .int(listStart ?? 1)
    case .taskItem:
      listType = "taskList"
    default:
      listType = "bulletList"
    }
    return (
      SchemaNode(type: listType, id: listId, attrs: attrs, content: items, text: nil, marks: []),
      i
    )
  }

  private static func itemNode(_ block: LinearBlock, nested: [SchemaNode]) -> SchemaNode {
    let paragraph = SchemaNode(
      type: "paragraph",
      id: block.paragraphId ?? JotIds.derive(parentId: block.id, purpose: "paragraph", index: 0),
      attrs: [:],
      content: runsToInlines(block.runs),
      text: nil,
      marks: []
    )
    var content = [paragraph]
    content.append(contentsOf: nested)
    var attrs: [String: JSONValue] = [:]
    let type: String
    if block.kind == .taskItem {
      type = "taskItem"
      attrs["checked"] = .int(block.checked ?? 0)
    } else {
      type = "listItem"
    }
    return SchemaNode(type: type, id: block.id, attrs: attrs, content: content, text: nil, marks: [])
  }

  private static func blockToNode(_ block: LinearBlock) -> SchemaNode {
    switch block.kind {
    case .heading:
      return SchemaNode(
        type: "heading",
        id: block.id,
        attrs: ["level": .int(block.headingLevel ?? 1)],
        content: runsToInlines(block.runs),
        text: nil,
        marks: []
      )
    case .codeBlock:
      return SchemaNode(
        type: "codeBlock",
        id: block.id,
        attrs: ["languageId": .string(block.languageId ?? "")],
        content: runsToText(block.runs, parentId: block.id),
        text: nil,
        marks: []
      )
    case .placeholder:
      if let json = block.placeholderJSON {
        return SchemaNode.parse(json)
      }
      return SchemaNode(
        type: "paragraph",
        id: block.id,
        attrs: [:],
        content: runsToInlines(block.runs),
        text: nil,
        marks: []
      )
    case .horizontalRule:
      return SchemaNode(
        type: "horizontalRule",
        id: block.id,
        attrs: [:],
        content: [],
        text: nil,
        marks: []
      )
    case .image:
      if let json = block.placeholderJSON {
        return SchemaNode.parse(json)
      }
      return SchemaNode(
        type: "image",
        id: block.id,
        attrs: [
          "attachmentId": .string(block.runs.first?.id ?? block.id),
          "widthBasisPoints": .int(10000),
          "alt": .string(block.plainText)
        ],
        content: [],
        text: nil,
        marks: []
      )
    default:
      return SchemaNode(
        type: "paragraph",
        id: block.id,
        attrs: [:],
        content: runsToInlines(block.runs),
        text: nil,
        marks: []
      )
    }
  }

  private static func runsToInlines(_ runs: [LinearRun]) -> [SchemaNode] {
    runs.map { run in
      if let json = run.placeholderJSON {
        return SchemaNode.parse(json)
      }
      if run.text == "\u{2028}" {
        return SchemaNode(
          type: "hardBreak",
          id: run.id ?? JotIds.create(),
          attrs: [:],
          content: [],
          text: nil,
          marks: []
        )
      }
      return SchemaNode(
        type: "text",
        id: run.id ?? JotIds.create(),
        attrs: [:],
        content: [],
        text: run.text,
        marks: run.marks.map { $0.toSchema() }
      )
    }
  }

  private static func runsToText(_ runs: [LinearRun], parentId: String) -> [SchemaNode] {
    let text = runs.map { $0.text }.joined()
    if text.isEmpty {
      return []
    }
    return [
      SchemaNode(
        type: "text",
        id: runs.first?.id ?? JotIds.derive(parentId: parentId, purpose: "text", index: 0),
        attrs: [:],
        content: [],
        text: text,
        marks: []
      )
    ]
  }

  private static func insertText(
    _ text: String,
    at position: SchemaSelection,
    marks: [LinearMark],
    in linear: inout LinearDocument
  ) {
    if linear.blocks.isEmpty {
      let targetsRoot = position.nodeId.isEmpty || position.nodeId == linear.id
      linear.blocks.append(
        LinearBlock(
          id: targetsRoot ? bodyParagraphId(linear.id) : position.nodeId,
          kind: .paragraph,
          indent: 0,
          runs: [LinearRun(text: text, marks: marks, id: JotIds.create())]
        )
      )
      return
    }
    guard let index = indexOfBlock(nodeId: position.nodeId, in: linear) else { return }
    insert(text, at: position.offsetUtf16, marks: marks, into: &linear.blocks[index].runs)
  }

  private static func insert(_ text: String, at offset: Int, marks: [LinearMark], into runs: inout [LinearRun]) {
    if runs.isEmpty {
      runs.append(LinearRun(text: text, marks: marks, id: JotIds.create()))
      return
    }
    var remaining = max(0, offset)
    for i in 0..<runs.count {
      if runs[i].isPlaceholder {
        if remaining == 0 {
          runs.insert(LinearRun(text: text, marks: marks, id: JotIds.create()), at: i)
          return
        }
        remaining -= 1
        continue
      }
      let length = Utf16.count(runs[i].text)
      if remaining <= length {
        if marksEqual(runs[i].marks, marks) {
          runs[i].text = Utf16.insert(runs[i].text, offset: remaining, text: text)
        } else {
          let left = Utf16.slice(runs[i].text, offset: 0, length: remaining)
          let right = Utf16.slice(runs[i].text, offset: remaining, length: length - remaining)
          var next: [LinearRun] = []
          if !left.isEmpty {
            next.append(LinearRun(text: left, marks: runs[i].marks, id: runs[i].id))
          }
          next.append(LinearRun(text: text, marks: marks, id: JotIds.create()))
          if !right.isEmpty {
            next.append(LinearRun(text: right, marks: runs[i].marks, id: JotIds.create()))
          }
          runs.replaceSubrange(i...i, with: next)
        }
        return
      }
      remaining -= length
    }
    runs.append(LinearRun(text: text, marks: marks, id: JotIds.create()))
  }

  private static func deleteRange(
    from: SchemaSelection,
    to: SchemaSelection,
    in linear: inout LinearDocument
  ) {
    guard let fromIndex = indexOfBlock(nodeId: from.nodeId, in: linear) else { return }
    guard let toIndex = indexOfBlock(nodeId: to.nodeId, in: linear) else { return }
    if fromIndex == toIndex {
      deleteText(from: from.offsetUtf16, to: to.offsetUtf16, in: &linear.blocks[fromIndex].runs)
      return
    }
    let start = min(fromIndex, toIndex)
    let end = max(fromIndex, toIndex)
    let startOffset = fromIndex <= toIndex ? from.offsetUtf16 : to.offsetUtf16
    let endOffset = fromIndex <= toIndex ? to.offsetUtf16 : from.offsetUtf16
    deleteText(from: startOffset, to: linear.blocks[start].utf16Length, in: &linear.blocks[start].runs)
    deleteText(from: 0, to: endOffset, in: &linear.blocks[end].runs)
    linear.blocks[start].runs.append(contentsOf: linear.blocks[end].runs)
    linear.blocks.removeSubrange((start + 1)...end)
  }

  private static func deleteText(from: Int, to: Int, in runs: inout [LinearRun]) {
    let start = max(0, min(from, to))
    let end = max(from, to)
    var offset = 0
    var next: [LinearRun] = []
    for run in runs {
      let length = run.utf16Length
      let runStart = offset
      let runEnd = offset + length
      offset = runEnd
      if runEnd <= start || runStart >= end {
        next.append(run)
        continue
      }
      if run.isPlaceholder {
        continue
      }
      let keepLeft = max(0, start - runStart)
      let keepRight = max(0, runEnd - end)
      let left = Utf16.slice(run.text, offset: 0, length: keepLeft)
      let right = Utf16.slice(run.text, offset: length - keepRight, length: keepRight)
      if !left.isEmpty {
        next.append(LinearRun(text: left, marks: run.marks, id: run.id))
      }
      if !right.isEmpty {
        next.append(LinearRun(text: right, marks: run.marks, id: JotIds.create()))
      }
    }
    runs = next
  }

  private static func applyMark(
    _ mark: LinearMark,
    from: SchemaSelection,
    to: SchemaSelection,
    add: Bool,
    in linear: inout LinearDocument
  ) {
    guard let fromIndex = indexOfBlock(nodeId: from.nodeId, in: linear) else { return }
    guard let toIndex = indexOfBlock(nodeId: to.nodeId, in: linear) else { return }
    let start = min(fromIndex, toIndex)
    let end = max(fromIndex, toIndex)
    for i in start...end {
      let startOffset = i == fromIndex ? from.offsetUtf16 : 0
      let endOffset = i == toIndex ? to.offsetUtf16 : linear.blocks[i].utf16Length
      markRuns(&linear.blocks[i].runs, from: startOffset, to: endOffset, mark: mark, add: add)
    }
  }

  private static func markRuns(
    _ runs: inout [LinearRun],
    from: Int,
    to: Int,
    mark: LinearMark,
    add: Bool
  ) {
    let start = max(0, min(from, to))
    let end = max(from, to)
    var offset = 0
    var next: [LinearRun] = []
    for run in runs {
      let length = run.utf16Length
      let runStart = offset
      let runEnd = offset + length
      offset = runEnd
      if run.isPlaceholder || runEnd <= start || runStart >= end {
        next.append(run)
        continue
      }
      let leftLen = max(0, start - runStart)
      let rightLen = max(0, runEnd - end)
      let midLen = length - leftLen - rightLen
      if leftLen > 0 {
        next.append(
          LinearRun(
            text: Utf16.slice(run.text, offset: 0, length: leftLen),
            marks: run.marks,
            id: run.id
          )
        )
      }
      if midLen > 0 {
        var marks = run.marks.filter { $0.type != mark.type }
        if add {
          marks.append(mark)
        }
        next.append(
          LinearRun(
            text: Utf16.slice(run.text, offset: leftLen, length: midLen),
            marks: marks,
            id: JotIds.create()
          )
        )
      }
      if rightLen > 0 {
        next.append(
          LinearRun(
            text: Utf16.slice(run.text, offset: length - rightLen, length: rightLen),
            marks: run.marks,
            id: JotIds.create()
          )
        )
      }
    }
    runs = next
  }

  private static func setAttributes(nodeId: String, patch: [String: JSONValue], in linear: inout LinearDocument) {
    guard let index = indexOfBlock(nodeId: nodeId, in: linear) else { return }
    if let checked = patch["checked"]?.intValue() {
      linear.blocks[index].checked = checked
    }
    if let level = patch["level"]?.intValue() {
      linear.blocks[index].headingLevel = level
      if linear.blocks[index].kind == .paragraph {
        linear.blocks[index].kind = .heading
      }
    }
    if let languageId = patch["languageId"]?.stringValue() {
      linear.blocks[index].languageId = languageId
    }
    if linear.blocks[index].kind == .image, let json = linear.blocks[index].placeholderJSON {
      var node = SchemaNode.parse(json)
      for key in ["widthBasisPoints", "alt"] {
        if let value = patch[key] {
          node.attrs[key] = value
        }
      }
      let updated = node.toJSON()
      linear.blocks[index].placeholderJSON = updated
      linear.blocks[index].runs = [
        LinearRun(
          text: objectReplacement,
          id: node.id,
          placeholderJSON: updated,
          fallbackText: node.attrs["alt"]?.stringValue() ?? ""
        )
      ]
    }
  }

  /// Index of the top-level document child that contains `nodeId`.
  static func topLevelIndex(nodeId: String, in tree: SchemaNode) -> Int? {
    tree.content.firstIndex { contains($0, nodeId: nodeId) }
  }

  static func contains(_ node: SchemaNode, nodeId: String) -> Bool {
    node.id == nodeId || node.content.contains { contains($0, nodeId: nodeId) }
  }

  static func findNode(_ nodeId: String, in tree: SchemaNode) -> SchemaNode? {
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

  static func textNode(_ text: String, marks: [LinearMark]) -> SchemaNode {
    SchemaNode(
      type: "text",
      id: JotIds.create(),
      attrs: [:],
      content: [],
      text: text,
      marks: marks.map { $0.toSchema() }
    )
  }

  /// Runs covering `[from, to)` of a block, cut at the range edges, with their marks kept.
  static func sliceRuns(_ block: LinearBlock, from: Int, to: Int) -> [LinearRun] {
    let start = max(0, min(from, to))
    let end = max(from, to)
    var offset = 0
    var result: [LinearRun] = []
    for run in block.runs {
      let length = run.utf16Length
      let runStart = offset
      let runEnd = offset + length
      offset = runEnd
      if runEnd <= start || runStart >= end {
        continue
      }
      if run.isPlaceholder {
        result.append(run)
        continue
      }
      let lower = max(start, runStart) - runStart
      let upper = min(end, runEnd) - runStart
      result.append(
        LinearRun(text: Utf16.slice(run.text, offset: lower, length: upper - lower), marks: run.marks, id: run.id)
      )
    }
    return result
  }

  /// True when every character of text between the two carets carries `type`.
  static func rangeHasMark(_ type: String, from: SchemaSelection, to: SchemaSelection, in linear: LinearDocument) -> Bool {
    guard let fromIndex = indexOfBlock(nodeId: from.nodeId, in: linear),
          let toIndex = indexOfBlock(nodeId: to.nodeId, in: linear) else {
      return false
    }
    var sawText = false
    for i in min(fromIndex, toIndex)...max(fromIndex, toIndex) {
      let block = linear.blocks[i]
      let lower = i == fromIndex ? from.offsetUtf16 : 0
      let upper = i == toIndex ? to.offsetUtf16 : block.utf16Length
      for run in sliceRuns(block, from: lower, to: upper) where !run.isPlaceholder && !run.text.isEmpty {
        sawText = true
        if !run.marks.contains(where: { $0.type == type }) {
          return false
        }
      }
    }
    return sawText
  }

  /// Inverse operations for `operations` applied to `before`, in the order they must run.
  /// Nil means an operation joined or split blocks, and undo has to restore a snapshot instead.
  static func invert(_ operations: [SchemaOperation], before: LinearDocument) -> [SchemaOperation]? {
    var state = before
    var groups: [[SchemaOperation]] = []
    for operation in operations {
      guard let inverse = invertOne(operation, in: state) else {
        return nil
      }
      groups.append(inverse)
      do {
        try apply(operation, to: &state)
      } catch {
        return nil
      }
    }
    return groups.reversed().flatMap { $0 }
  }

  private static func invertOne(_ operation: SchemaOperation, in linear: LinearDocument) -> [SchemaOperation]? {
    switch operation {
    case let .insertText(position, text, storedMarks):
      var start = position
      if linear.blocks.isEmpty && (position.nodeId.isEmpty || position.nodeId == linear.id) {
        start.nodeId = bodyParagraphId(linear.id)
      } else if indexOfBlock(nodeId: position.nodeId, in: linear) == nil {
        return nil
      }
      var end = start
      end.offsetUtf16 += Utf16.count(text)
      end.affinity = "after"
      return [
        .deleteRange(from: start, to: end, deletedSlice: [textNode(text, marks: storedMarks.map { LinearMark.from($0) })])
      ]
    case let .deleteRange(from, to, _):
      guard let index = indexOfBlock(nodeId: from.nodeId, in: linear),
            indexOfBlock(nodeId: to.nodeId, in: linear) == index else {
        return nil
      }
      return reinsert(sliceRuns(linear.blocks[index], from: from.offsetUtf16, to: to.offsetUtf16), at: from)
    case let .replaceRange(from, to, slice, _):
      guard let index = indexOfBlock(nodeId: from.nodeId, in: linear),
            indexOfBlock(nodeId: to.nodeId, in: linear) == index,
            let restore = reinsert(sliceRuns(linear.blocks[index], from: from.offsetUtf16, to: to.offsetUtf16), at: from) else {
        return nil
      }
      let insertedLength = Utf16.count(slice.map { $0.plainText() }.joined())
      guard insertedLength > 0 else {
        return restore
      }
      var end = from
      end.offsetUtf16 += insertedLength
      end.affinity = "after"
      return [.deleteRange(from: from, to: end, deletedSlice: slice)] + restore
    case let .addMark(from, to, mark):
      return restoreMarks(mark.type, from: from, to: to, in: linear, removeFirst: true)
    case let .removeMark(from, to, markType):
      return restoreMarks(markType, from: from, to: to, in: linear, removeFirst: false)
    case let .setNodeAttributes(nodeId, patch, priorValues):
      return [.setNodeAttributes(nodeId: nodeId, patch: priorValues, priorValues: patch)]
    case let .insertNode(_, _, node):
      return [.deleteNode(nodeId: node.id, deletedNode: node)]
    case let .deleteNode(nodeId, _):
      let tree = linearToDocument(linear)
      guard let location = parentLocation(nodeId: nodeId, in: tree),
            let node = findNode(nodeId, in: tree) else {
        return nil
      }
      return [.insertNode(parentId: location.parentId, index: location.index, node: node)]
    }
  }

  private static func reinsert(_ runs: [LinearRun], at position: SchemaSelection) -> [SchemaOperation]? {
    var operations: [SchemaOperation] = []
    var offset = position.offsetUtf16
    for run in runs {
      if run.isPlaceholder || run.text.contains("\u{2028}") {
        return nil
      }
      if run.text.isEmpty {
        continue
      }
      var at = position
      at.offsetUtf16 = offset
      operations.append(.insertText(position: at, text: run.text, storedMarks: run.marks.map { $0.toSchema() }))
      offset += Utf16.count(run.text)
    }
    return operations
  }

  private static func restoreMarks(
    _ type: String,
    from: SchemaSelection,
    to: SchemaSelection,
    in linear: LinearDocument,
    removeFirst: Bool
  ) -> [SchemaOperation]? {
    guard let fromIndex = indexOfBlock(nodeId: from.nodeId, in: linear),
          let toIndex = indexOfBlock(nodeId: to.nodeId, in: linear) else {
      return nil
    }
    var operations: [SchemaOperation] = removeFirst ? [.removeMark(from: from, to: to, markType: type)] : []
    for i in min(fromIndex, toIndex)...max(fromIndex, toIndex) {
      let block = linear.blocks[i]
      let lower = i == fromIndex ? from.offsetUtf16 : 0
      let upper = i == toIndex ? to.offsetUtf16 : block.utf16Length
      let nodeId = block.paragraphId ?? block.id
      var offset = max(0, min(lower, upper))
      for run in sliceRuns(block, from: lower, to: upper) {
        let length = run.utf16Length
        if let mark = run.marks.first(where: { $0.type == type }) {
          operations.append(
            .addMark(
              from: SchemaSelection(nodeId: nodeId, offsetUtf16: offset, affinity: "after", revision: from.revision),
              to: SchemaSelection(nodeId: nodeId, offsetUtf16: offset + length, affinity: "before", revision: from.revision),
              mark: mark.toSchema()
            )
          )
        }
        offset += length
      }
    }
    return operations
  }

  private static func insertNode(
    _ node: SchemaNode,
    parentId: String,
    index: Int,
    into tree: SchemaNode
  ) -> SchemaNode {
    if tree.id == parentId {
      var content = tree.content
      let clamped = max(0, min(index, content.count))
      content.insert(node, at: clamped)
      var next = tree
      next.content = content
      return next
    }
    var next = tree
    next.content = tree.content.map { insertNode(node, parentId: parentId, index: index, into: $0) }
    return next
  }

  private static func deleteNode(nodeId: String, from tree: SchemaNode) -> SchemaNode {
    var next = tree
    next.content = tree.content.compactMap { child in
      if child.id == nodeId {
        return nil
      }
      return deleteNode(nodeId: nodeId, from: child)
    }
    return next
  }

  private static func marksEqual(_ left: [LinearMark], _ right: [LinearMark]) -> Bool {
    guard left.count == right.count else { return false }
    let a = left.sorted { $0.type < $1.type }
    let b = right.sorted { $0.type < $1.type }
    return a == b
  }

  private static func firstMarks(in slice: [SchemaNode]) -> [LinearMark] {
    for node in slice {
      if node.type == "text" {
        return node.marks.map { LinearMark.from($0) }
      }
      let nested = firstMarks(in: node.content)
      if !nested.isEmpty {
        return nested
      }
    }
    return []
  }
}
