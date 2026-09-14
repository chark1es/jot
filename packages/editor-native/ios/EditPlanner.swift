import Foundation

/// What a text change in the editor means for the document. Text views report a replaced range of
/// editor characters; this decides whether that is typing, a Markdown shortcut, a split, a join, or
/// a block edit. It has no UIKit dependency, so the host tests and the cross-platform editor corpus
/// run the planner the app runs. `EditPlanner.kt` is the Android port.
///
/// Editor characters follow the layout in `AttributedBridge`: each block draws its leading markers
/// (quote bar, then bullet, number, or checkbox), then its text, then a newline unless it is last.
enum EditPlanner {
  struct Change {
    var from: SchemaSelection
    var to: SchemaSelection
    var replacement: String
    /// Length of the replaced range in editor characters, counting markers and newlines.
    var rangeLength: Int
    /// The range is a single image, divider, or unsupported-block character.
    var deletesAtomic: Bool
  }

  enum Outcome {
    case plan(EditPlan)
    /// Backspace right after a Markdown shortcut. The caller undoes the conversion instead.
    case undoInputRule
    case ignore
  }

  static func change(start: Int, length: Int, replacement: String, linear: LinearDocument, revision: Int) -> Change {
    Change(
      from: location(displayIndex: start, affinity: "before", linear: linear, revision: revision),
      to: location(displayIndex: start + length, affinity: "after", linear: linear, revision: revision),
      replacement: replacement,
      rangeLength: length,
      deletesAtomic: length == 1 && isAtomicCharacter(displayIndex: start, linear: linear)
    )
  }

  static func plan(
    _ change: Change,
    linear: LinearDocument,
    storedMarks: [LinearMark],
    inputRuleBlockId: String?
  ) -> Outcome {
    let from = change.from
    let to = change.to
    let replacement = change.replacement
    var plan: EditPlan?
    if replacement.isEmpty && change.rangeLength == 1 && change.deletesAtomic {
      plan = LinearCommands.deleteBlock(at: from, linear: linear, storedMarks: storedMarks)
    }
    if plan == nil && replacement.isEmpty && change.rangeLength > 0 && to.offsetUtf16 == 0 && (from.nodeId != to.nodeId || from.offsetUtf16 == 0) {
      guard let current = LinearModel.block(nodeId: to.nodeId, in: linear) else {
        return .ignore
      }
      if let ruleBlock = inputRuleBlockId, current.id == ruleBlock || current.paragraphId == ruleBlock {
        return .undoInputRule
      }
      guard let joined = backspaceAtBlockStart(current: current, from: from, to: to, linear: linear, storedMarks: storedMarks) else {
        return .ignore
      }
      plan = joined
    }
    if plan == nil && change.rangeLength > 0 && from.nodeId != to.nodeId {
      plan = crossBlockReplacement(from: from, to: to, replacement: replacement, linear: linear, storedMarks: storedMarks)
    }
    if plan == nil, let block = LinearModel.block(nodeId: from.nodeId, in: linear), LinearModel.isAtomicKind(block.kind), !replacement.isEmpty {
      plan = typingBesideAtomic(block: block, at: from, replacement: replacement, linear: linear)
    }
    if plan == nil && change.rangeLength == 0 && Utf16.count(replacement) == 1 {
      plan = LinearCommands.inlineMarkdownRule(typed: replacement, linear: linear, selection: from, storedMarks: storedMarks)
    }
    if plan == nil && change.rangeLength == 0 && (replacement == "\n" || replacement == " ") {
      plan = LinearCommands.inputRule(terminator: replacement, linear: linear, selection: from, storedMarks: storedMarks)
    }
    if plan == nil && replacement == "\n" {
      plan = change.rangeLength > 0
        ? replaceThenSplit(from: from, to: to, linear: linear, storedMarks: storedMarks)
        : LinearCommands.split(at: from, linear: linear, storedMarks: storedMarks)
    }
    if plan == nil {
      plan = textReplacement(from: from, to: to, rangeLength: change.rangeLength, replacement: replacement, linear: linear, storedMarks: storedMarks)
    }
    guard let plan, !plan.operations.isEmpty else {
      return .ignore
    }
    return .plan(plan)
  }

  static func textReplacement(
    from: SchemaSelection,
    to: SchemaSelection,
    rangeLength: Int,
    replacement: String,
    linear: LinearDocument,
    storedMarks: [LinearMark]
  ) -> EditPlan? {
    if rangeLength == 0 && replacement.isEmpty {
      return nil
    }
    let operation: SchemaOperation
    if rangeLength == 0 {
      operation = .insertText(position: from, text: replacement, storedMarks: storedMarks.map { $0.toSchema() })
    } else if replacement.isEmpty {
      operation = .deleteRange(from: from, to: to, deletedSlice: deletedSlice(from: from, to: to, linear: linear))
    } else {
      operation = .replaceRange(
        from: from,
        to: to,
        slice: [LinearModel.textNode(replacement, marks: storedMarks)],
        deletedSlice: deletedSlice(from: from, to: to, linear: linear)
      )
    }
    var after = from
    after.offsetUtf16 += Utf16.count(replacement)
    after.affinity = "after"
    return EditPlan(operations: [operation], storedMarks: storedMarks, collapsedOnly: false, selectionAfter: after, isInputRule: false)
  }

  /// A selection that spans blocks. Only whole top-level nodes change, which TypeScript and Yjs apply exactly.
  static func crossBlockReplacement(
    from: SchemaSelection,
    to: SchemaSelection,
    replacement: String,
    linear: LinearDocument,
    storedMarks: [LinearMark]
  ) -> EditPlan? {
    var next = linear
    do {
      try LinearModel.apply([.deleteRange(from: from, to: to, deletedSlice: [])], to: &next)
      if !replacement.isEmpty {
        try LinearModel.apply([.insertText(position: from, text: replacement, storedMarks: storedMarks.map { $0.toSchema() })], to: &next)
      }
    } catch {
      return nil
    }
    let operations = LinearCommands.contentDiffOps(
      from: LinearModel.linearToDocument(linear),
      to: LinearModel.linearToDocument(next)
    )
    guard !operations.isEmpty else { return nil }
    var after = from
    after.offsetUtf16 += Utf16.count(replacement)
    after.affinity = "after"
    return EditPlan(operations: operations, storedMarks: storedMarks, collapsedOnly: false, selectionAfter: after, isInputRule: false)
  }

  static func deletedSlice(from: SchemaSelection, to: SchemaSelection, linear: LinearDocument) -> [SchemaNode] {
    guard let block = LinearModel.block(nodeId: from.nodeId, in: linear) else { return [] }
    return LinearModel.sliceRuns(block, from: from.offsetUtf16, to: to.offsetUtf16)
      .filter { !$0.isPlaceholder }
      .map { LinearModel.textNode($0.text, marks: $0.marks) }
  }

  // MARK: Editor character layout

  /// The editor's text: leading markers as object replacement characters, runs, and newlines.
  static func displayText(_ linear: LinearDocument) -> String {
    var parts: [String] = []
    for (index, block) in linear.blocks.enumerated() {
      parts.append(String(repeating: "\u{FFFC}", count: LinearModel.leadingCount(block)))
      for run in block.runs {
        parts.append(run.isPlaceholder ? "\u{FFFC}" : run.text)
      }
      if index + 1 < linear.blocks.count {
        parts.append("\n")
      }
    }
    return parts.joined()
  }

  static func location(displayIndex: Int, affinity: String, linear: LinearDocument, revision: Int) -> SchemaSelection {
    if linear.blocks.isEmpty {
      return SchemaSelection(nodeId: linear.id, offsetUtf16: 0, affinity: affinity, revision: revision)
    }
    var cursor = 0
    for (index, block) in linear.blocks.enumerated() {
      let contentStart = cursor + LinearModel.leadingCount(block)
      let contentEnd = contentStart + block.utf16Length
      // List and task text lives in the item's paragraph. Naming the paragraph, not the item,
      // keeps every layer from having to guess where inside the item the text goes.
      let nodeId = block.paragraphId ?? block.id
      if displayIndex < contentStart {
        return SchemaSelection(nodeId: nodeId, offsetUtf16: 0, affinity: affinity, revision: revision)
      }
      if displayIndex <= contentEnd {
        return SchemaSelection(nodeId: nodeId, offsetUtf16: displayIndex - contentStart, affinity: affinity, revision: revision)
      }
      cursor = contentEnd + (index < linear.blocks.count - 1 ? 1 : 0)
    }
    let last = linear.blocks[linear.blocks.count - 1]
    return SchemaSelection(nodeId: last.paragraphId ?? last.id, offsetUtf16: last.utf16Length, affinity: affinity, revision: revision)
  }

  static func displayIndex(selection: SchemaSelection, linear: LinearDocument) -> Int {
    var cursor = 0
    for (index, block) in linear.blocks.enumerated() {
      let leading = LinearModel.leadingCount(block)
      if block.id == selection.nodeId || block.paragraphId == selection.nodeId {
        return cursor + leading + min(max(0, selection.offsetUtf16), block.utf16Length)
      }
      cursor += leading + block.utf16Length
      if index < linear.blocks.count - 1 {
        cursor += 1
      }
    }
    return cursor
  }

  /// True when the editor character at `displayIndex` is an image, divider, or unsupported node.
  static func isAtomicCharacter(displayIndex: Int, linear: LinearDocument) -> Bool {
    var cursor = 0
    for (index, block) in linear.blocks.enumerated() {
      let contentStart = cursor + LinearModel.leadingCount(block)
      let contentEnd = contentStart + block.utf16Length
      if displayIndex < contentStart {
        return false
      }
      if displayIndex < contentEnd {
        var offset = contentStart
        for run in block.runs {
          if displayIndex < offset + run.utf16Length {
            return run.isPlaceholder || LinearModel.isAtomicKind(block.kind)
          }
          offset += run.utf16Length
        }
        return false
      }
      cursor = contentEnd + (index < linear.blocks.count - 1 ? 1 : 0)
    }
    return false
  }

  // MARK: Block-boundary edits

  /// Backspace with the caret at the start of a block.
  private static func backspaceAtBlockStart(
    current: LinearBlock,
    from: SchemaSelection,
    to: SchemaSelection,
    linear: LinearDocument,
    storedMarks: [LinearMark]
  ) -> EditPlan? {
    let start = SchemaSelection(nodeId: current.paragraphId ?? current.id, offsetUtf16: 0, affinity: "before", revision: to.revision)
    let joined = LinearCommands.join(at: start, linear: linear, storedMarks: storedMarks)
    if !joined.operations.isEmpty {
      return joined
    }
    if !current.quoteChain.isEmpty {
      return LinearCommands.commandPlan(
        name: "toggleBlockquote",
        value: nil,
        linear: linear,
        selection: start,
        selectionEnd: nil,
        storedMarks: storedMarks
      )
    }
    guard from.nodeId != to.nodeId, let previous = LinearModel.block(nodeId: from.nodeId, in: linear) else {
      return nil
    }
    if LinearModel.isAtomicKind(previous.kind) {
      return LinearCommands.deleteBlock(at: from, linear: linear, storedMarks: storedMarks)
    }
    return crossBlockReplacement(from: from, to: to, replacement: "", linear: linear, storedMarks: storedMarks)
  }

  private static func replaceThenSplit(from: SchemaSelection, to: SchemaSelection, linear: LinearDocument, storedMarks: [LinearMark]) -> EditPlan? {
    guard from.nodeId == to.nodeId else {
      return crossBlockReplacement(from: from, to: to, replacement: "", linear: linear, storedMarks: storedMarks)
    }
    let deletion = SchemaOperation.deleteRange(from: from, to: to, deletedSlice: deletedSlice(from: from, to: to, linear: linear))
    var next = linear
    try? LinearModel.apply([deletion], to: &next)
    let split = LinearCommands.split(at: from, linear: next, storedMarks: storedMarks)
    return EditPlan(
      operations: [deletion] + split.operations,
      storedMarks: split.storedMarks,
      collapsedOnly: false,
      selectionAfter: split.selectionAfter ?? from,
      isInputRule: false
    )
  }

  /// Typing with the caret beside an image or divider starts a new paragraph on that side.
  private static func typingBesideAtomic(block: LinearBlock, at position: SchemaSelection, replacement: String, linear: LinearDocument) -> EditPlan? {
    let tree = LinearModel.linearToDocument(linear)
    guard let top = LinearModel.topLevelIndex(nodeId: block.id, in: tree) else { return nil }
    let text = replacement == "\n" ? "" : replacement
    let id = JotIds.create()
    let paragraph = SchemaNode(
      type: "paragraph",
      id: id,
      attrs: [:],
      content: text.isEmpty ? [] : [LinearModel.textNode(text, marks: [])],
      text: nil,
      marks: []
    )
    return EditPlan(
      operations: [.insertNode(parentId: linear.id, index: position.offsetUtf16 == 0 ? top : top + 1, node: paragraph)],
      storedMarks: [],
      collapsedOnly: false,
      selectionAfter: SchemaSelection(nodeId: id, offsetUtf16: Utf16.count(text), affinity: "after", revision: position.revision),
      isInputRule: false
    )
  }
}
