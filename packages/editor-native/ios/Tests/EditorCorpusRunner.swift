import Foundation

/// Runs the shared editor corpus (`packages/editor-native/corpus`) through the Swift planner and
/// model, the way `JotEditorView` drives them. `EditorCorpusRunner.kt` does the same on the JVM, and
/// `scripts/native-editor-check.ts` checks both outputs against TypeScript and Yjs.
///
/// Steps address text by editor character index, so a scenario reads like keystrokes:
/// `caret`, `select`, `marks`, `type`, `key` (enter, backspace, undo, redo), and `command`.
enum EditorCorpusRunner {
  struct Failure: Error, CustomStringConvertible {
    let description: String
  }

  static let markdownTriggers: Set<String> = ["*", "_", "~", "`", ")"]

  static func readJSON(_ url: URL) throws -> JSONValue {
    let data = try Data(contentsOf: url)
    return JSONValue.from(try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
  }

  static func run(corpus: JSONValue, fixtures: [(name: String, document: JSONValue)]) -> JSONValue {
    let scenarios = corpus.objectValue()["scenarios"]?.arrayValue() ?? []
    return .object([
      "platform": .string("swift"),
      "scenarios": .array(scenarios.map { runScenario($0.objectValue()) }),
      "fixtures": .array(
        fixtures.map { fixture in
          let node = SchemaNode.parse(fixture.document)
          let back = LinearModel.linearToDocument(LinearModel.documentToLinear(node))
          return .object(["name": .string(fixture.name), "document": back.toJSON()])
        }
      )
    ])
  }

  private static func runScenario(_ scenario: [String: JSONValue]) -> JSONValue {
    let session = Session(document: SchemaNode.parse(scenario["doc"] ?? .null))
    var failure: JSONValue = .null
    do {
      for raw in scenario["steps"]?.arrayValue() ?? [] {
        try session.perform(raw.objectValue())
      }
    } catch {
      failure = .string(String(describing: error))
    }
    return .object([
      "name": .string(scenario["name"]?.stringValue() ?? ""),
      "steps": .array(session.records),
      "document": LinearModel.linearToDocument(session.linear).toJSON(),
      "caret": .int(session.caret),
      "text": .string(EditPlanner.displayText(session.linear)),
      "error": failure
    ])
  }

  private final class Session {
    var linear: LinearDocument
    var caret = 0
    var anchor: Int?
    var storedMarks: [LinearMark] = []
    var inputRuleBlockId: String?
    var revision = 0
    var records: [JSONValue] = []
    let history = UndoStack()

    init(document: SchemaNode) {
      linear = LinearModel.withEditableBody(LinearModel.documentToLinear(document))
    }

    func perform(_ step: [String: JSONValue]) throws {
      if let index = step["caret"]?.intValue() {
        place(index, anchor: nil)
      } else if let range = step["select"]?.arrayValue(), range.count == 2 {
        place(range[0].intValue() ?? 0, anchor: range[1].intValue() ?? 0)
      } else if let marks = step["marks"]?.arrayValue() {
        storedMarks = marks.compactMap { $0.stringValue() }.map { LinearMark(type: $0) }
      } else if let text = step["type"]?.stringValue() {
        try type(text)
      } else if let key = step["key"]?.stringValue() {
        switch key {
        case "enter":
          try type("\n")
        case "backspace":
          try backspace()
        case "undo":
          try undo()
        case "redo":
          try redo()
        default:
          throw Failure(description: "unknown key \(key)")
        }
      } else if let name = step["command"]?.stringValue() {
        var value = step["value"]
        if let target = step["targetBlock"]?.intValue(), target < linear.blocks.count {
          var fields = value?.objectValue() ?? [:]
          fields["nodeId"] = .string(linear.blocks[target].id)
          value = .object(fields)
        }
        try command(name, value: value)
      } else {
        throw Failure(description: "unknown step")
      }
    }

    private func selection(_ index: Int, _ affinity: String) -> SchemaSelection {
      EditPlanner.location(displayIndex: index, affinity: affinity, linear: linear, revision: revision)
    }

    private var range: (lower: Int, upper: Int) {
      (min(caret, anchor ?? caret), max(caret, anchor ?? caret))
    }

    private func place(_ index: Int, anchor end: Int?) {
      caret = index
      anchor = end
      let start = selection(min(index, end ?? index), end == nil ? "after" : "before")
      if let block = LinearModel.block(nodeId: start.nodeId, in: linear) {
        storedMarks = block.markTypes(at: start.offsetUtf16)
      }
    }

    private func type(_ text: String) throws {
      for scalar in text.unicodeScalars {
        try edit(start: range.lower, end: range.upper, replacement: String(scalar))
      }
    }

    private func backspace() throws {
      if let anchor, anchor != caret {
        try edit(start: range.lower, end: range.upper, replacement: "")
        return
      }
      guard caret > 0 else {
        records.append(.object(["step": .string("ignored")]))
        return
      }
      let units = Array(EditPlanner.displayText(linear).utf16)
      var start = caret - 1
      if start > 0, start < units.count, (0xDC00...0xDFFF).contains(units[start]), (0xD800...0xDBFF).contains(units[start - 1]) {
        start -= 1
      }
      try edit(start: start, end: caret, replacement: "")
    }

    private func edit(start: Int, end: Int, replacement: String) throws {
      let change = EditPlanner.change(start: start, length: end - start, replacement: replacement, linear: linear, revision: revision)
      switch EditPlanner.plan(change, linear: linear, storedMarks: storedMarks, inputRuleBlockId: inputRuleBlockId) {
      case .ignore:
        records.append(.object(["step": .string("ignored")]))
      case .undoInputRule:
        try undo()
      case let .plan(plan):
        try commit(plan, kind: "edit")
        if plan.storedMarks != storedMarks && EditorCorpusRunner.markdownTriggers.contains(replacement) {
          storedMarks = plan.storedMarks
        }
      }
    }

    private func command(_ name: String, value: JSONValue?) throws {
      let collapsed = range.lower == range.upper
      let plan = LinearCommands.commandPlan(
        name: name,
        value: value,
        linear: linear,
        selection: selection(range.lower, collapsed ? "after" : "before"),
        selectionEnd: collapsed ? nil : selection(range.upper, "after"),
        storedMarks: storedMarks
      )
      storedMarks = plan.storedMarks
      if plan.collapsedOnly || plan.operations.isEmpty {
        records.append(.object(["step": .string("noChange")]))
        return
      }
      try commit(plan, kind: "command")
    }

    private func undo() throws {
      guard let entry = history.popUndo() else {
        records.append(.object(["step": .string("noChange")]))
        return
      }
      let operations = entry.beforeSnapshot.map {
        LinearCommands.contentDiffOps(from: LinearModel.linearToDocument(linear), to: LinearModel.linearToDocument($0))
      } ?? entry.inverse
      try replay(operations, target: entry.selectionBefore, kind: "undo")
    }

    private func redo() throws {
      guard let entry = history.popRedo() else {
        records.append(.object(["step": .string("noChange")]))
        return
      }
      let operations = entry.afterSnapshot.map {
        LinearCommands.contentDiffOps(from: LinearModel.linearToDocument(linear), to: LinearModel.linearToDocument($0))
      } ?? entry.forward
      try replay(operations, target: entry.selectionAfter, kind: "redo")
    }

    private func replay(_ operations: [SchemaOperation], target: SchemaSelection, kind: String) throws {
      guard !operations.isEmpty else {
        records.append(.object(["step": .string("noChange")]))
        return
      }
      let exists = LinearModel.block(nodeId: target.nodeId, in: linear) != nil
      let plan = EditPlan(operations: operations, storedMarks: storedMarks, collapsedOnly: false, selectionAfter: exists ? target : nil, isInputRule: false)
      try commit(plan, kind: kind, recordUndo: false)
      if !exists, LinearModel.block(nodeId: target.nodeId, in: linear) != nil {
        caret = EditPlanner.displayIndex(selection: target, linear: linear)
        anchor = nil
      }
    }

    private func commit(_ plan: EditPlan, kind: String, recordUndo: Bool = true) throws {
      let before = linear
      let start = selection(range.lower, "after")
      try LinearModel.apply(plan.operations, to: &linear)
      revision += 1
      let inverse = LinearModel.invert(plan.operations, before: before)
      if let after = plan.selectionAfter {
        caret = EditPlanner.displayIndex(selection: after, linear: linear)
        anchor = nil
      } else if let end = anchor {
        let length = Utf16.count(EditPlanner.displayText(linear))
        caret = min(caret, length)
        anchor = min(end, length)
      } else {
        caret = EditPlanner.displayIndex(selection: start, linear: linear)
      }
      if recordUndo {
        history.push(
          UndoEntry(
            transactionId: "",
            forward: plan.operations,
            inverse: inverse ?? [],
            selectionBefore: start,
            selectionAfter: plan.selectionAfter ?? start,
            beforeSnapshot: inverse == nil ? before : nil,
            afterSnapshot: inverse == nil ? linear : nil
          )
        )
      }
      inputRuleBlockId = plan.isInputRule ? plan.selectionAfter?.nodeId : nil
      records.append(
        .object([
          "step": .string(kind),
          "operations": .array(plan.operations.map { $0.toJSON() }),
          "inverse": inverse.map { .array($0.map { $0.toJSON() }) } ?? .null
        ])
      )
    }
  }
}
