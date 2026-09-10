import ExpoModulesCore
import UIKit

enum JotEditorError: Error {
  case invalidDocument
  case journalAppendFailed
}

public final class JotEditorView: ExpoView, JotTextViewHost {
  let onReady = EventDispatcher()
  let onCommittedTransaction = EventDispatcher()
  let onSelectionChanged = EventDispatcher()
  let onCompositionChanged = EventDispatcher()
  let onContentSizeChanged = EventDispatcher()
  let onRecoverableError = EventDispatcher()

  private let textView = JotTextView()
  private let undoStack = UndoStack()
  private var journal: DurableJournal?
  private var linear = LinearDocument(id: JotIds.create(), blocks: [])
  private var documentId = ""
  private var schemaVersion = 1
  private var revision = 0
  private var selection = SchemaSelection(nodeId: "", offsetUtf16: 0, affinity: "before", revision: 0)
  private var anchor: SchemaSelection?
  private var storedMarks: [LinearMark] = []
  private var didEmitReady = false
  private var lastHeight: CGFloat = -1
  private var applyingInternally = false
  private var lastLoadedCanonical = ""
  private var boundDocumentId = ""
  private var hasCompletedLoad = false
  private var inputRuleBlockId: String?
  private var lastBoundsSize: CGSize = .zero
  private var rotationOffset: CGPoint = .zero
  private var rotationSelection: SchemaSelection?
  private var imagePaths: [String: String] = [:]
  private var lastImageWidth: CGFloat = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    textView.host = self
    addSubview(textView)
    journal = try? DurableJournal(fileURL: journalURL(documentId: "unbound"))
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(keyboardWillChange(_:)),
      name: UIResponder.keyboardWillChangeFrameNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(keyboardWillHide(_:)),
      name: UIResponder.keyboardWillHideNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  public override func layoutSubviews() {
    let rotated = lastBoundsSize != .zero && lastBoundsSize != bounds.size
    if rotated {
      rotationSelection = selection
      rotationOffset = textView.contentOffset
    }
    super.layoutSubviews()
    textView.frame = bounds.inset(by: safeAreaInsets)
    if rotated {
      if let stored = rotationSelection {
        selection = stored
        restoreCaret()
      }
      var offset = rotationOffset
      let maxOffset = max(0, textView.contentSize.height - textView.bounds.height + textView.contentInset.bottom)
      offset.y = min(max(0, offset.y), maxOffset)
      textView.setContentOffset(offset, animated: false)
    }
    lastBoundsSize = bounds.size
    let width = editorContentWidth()
    if abs(width - lastImageWidth) > 1,
       linear.blocks.contains(where: { $0.kind == .image || $0.kind == .horizontalRule }) {
      lastImageWidth = width
      rebuildText(preserveSelection: true)
    }
    reportHeight()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil && !didEmitReady {
      didEmitReady = true
      onReady([
        "capabilities": ["undo": true, "redo": true, "ime": true],
        "schemaVersion": schemaVersion
      ])
    }
  }

  func setDocumentId(_ value: String) {
    documentId = value
  }

  func setSchemaVersion(_ value: Int) {
    schemaVersion = value
  }

  func setRevision(_ value: Int) {
    revision = value
  }

  func setCanonicalDocument(_ value: [String: Any]?) {
    guard let value else {
      return
    }
    let id = documentId.isEmpty ? (value["id"] as? String ?? "") : documentId
    let node = SchemaNode.parseDictionary(value)
    let canonical = CanonicalJSON.stringify(node.toJSON())
    if hasCompletedLoad && id == boundDocumentId && canonical == lastLoadedCanonical {
      return
    }
    do {
      try loadDocument(
        documentId: id,
        canonicalDocument: value,
        schemaVersion: schemaVersion,
        revision: revision
      )
    } catch {
      emitError(code: "invalid_document", context: "canonicalDocument")
    }
  }

  func loadDocument(
    documentId: String,
    canonicalDocument: [String: Any],
    schemaVersion: Int,
    revision: Int
  ) throws {
    self.documentId = documentId
    self.schemaVersion = schemaVersion
    self.revision = revision
    let node = SchemaNode.parseDictionary(canonicalDocument)
    if node.type != "doc" {
      emitError(code: "invalid_document", context: "root type")
      throw JotEditorError.invalidDocument
    }
    linear = LinearModel.documentToLinear(node)
    undoStack.clear()
    storedMarks = []
    imagePaths = [:]
    inputRuleBlockId = nil
    journal = try DurableJournal(fileURL: journalURL(documentId: documentId))
    replayUnapplied()
    applyingInternally = true
    textView.replaceInternally(with: attributedContent())
    applyingInternally = false
    if let first = linear.blocks.first {
      selection = SchemaSelection(nodeId: first.paragraphId ?? first.id, offsetUtf16: 0, affinity: "before", revision: revision)
    } else {
      selection = SchemaSelection(nodeId: linear.id, offsetUtf16: 0, affinity: "before", revision: revision)
    }
    boundDocumentId = documentId
    lastLoadedCanonical = CanonicalJSON.stringify(node.toJSON())
    hasCompletedLoad = true
    emitSelection()
    reportHeight()
  }

  func applyTransactions(
    documentId: String,
    baseRevision: Int,
    transactions: [[String: Any]],
    origin: String
  ) throws {
    if documentId != self.documentId && !self.documentId.isEmpty {
      emitError(code: "document_mismatch", context: "applyTransactions")
      return
    }
    if origin == "local" {
      for raw in transactions {
        let id = raw["transactionId"] as? String ?? JotIds.create()
        let ops = SchemaOperation.parseList(raw["operations"] as? [Any] ?? [])
        try commit(operations: ops, transactionId: id, journalFirst: true)
      }
      return
    }
    for raw in transactions {
      let ops = SchemaOperation.parseList(raw["operations"] as? [Any] ?? [])
      try LinearModel.apply(ops, to: &linear)
    }
    revision = baseRevision + transactions.count
    rebuildText(preserveSelection: true)
  }

  func dispatchCommand(_ command: [String: Any]) throws {
    var command = command
    let name = command["name"] as? String ?? command["command"] as? String ?? ""
    if name == "insertImage" {
      let existing = command["attachmentId"] as? String
      if existing == nil || existing?.isEmpty == true {
        command["attachmentId"] = JotIds.create()
      }
      if let path = (command["path"] as? String) ?? (command["filePath"] as? String) ?? (command["localPath"] as? String),
         let id = command["attachmentId"] as? String {
        imagePaths[id] = path
      }
    }
    let value: JSONValue?
    if command["level"] != nil {
      value = JSONValue.from(command["level"] as Any)
    } else if command["value"] != nil {
      value = JSONValue.from(command["value"] as Any)
    } else {
      value = JSONValue.from(command)
    }
    let result = LinearCommands.commandPlan(
      name: name,
      value: value,
      linear: linear,
      selection: selection,
      selectionEnd: anchor,
      storedMarks: storedMarks
    )
    storedMarks = result.storedMarks
    if result.collapsedOnly || result.operations.isEmpty {
      emitSelection()
      return
    }
    try commit(
      operations: result.operations,
      transactionId: JotIds.create(),
      journalFirst: true,
      selectionAfter: result.selectionAfter,
      isInputRule: result.isInputRule
    )
  }

  func setSelection(_ raw: [String: Any]) {
    selection = SchemaSelection.parse(raw)
    let index = AttributedBridge.utf16Index(selection: selection, linear: linear)
    applyingInternally = true
    textView.selectedRange = NSRange(location: index, length: 0)
    applyingInternally = false
    emitSelection()
  }

  func snapshotDictionary() -> [String: Any] {
    let doc = LinearModel.linearToDocument(linear)
    return [
      "canonicalDocument": doc.toAny(),
      "revision": revision
    ]
  }

  func focusEditor() {
    textView.becomeFirstResponder()
  }

  func blurEditor() {
    textView.resignFirstResponder()
  }

  func undo() throws {
    guard let entry = undoStack.popUndo() else { return }
    try commit(operations: entry.inverse, transactionId: JotIds.create(), journalFirst: true, recordUndo: false)
    selection = entry.selectionBefore
    restoreCaret()
  }

  func redo() throws {
    guard let entry = undoStack.popRedo() else { return }
    try commit(operations: entry.forward, transactionId: JotIds.create(), journalFirst: true, recordUndo: false)
    selection = entry.selectionAfter
    restoreCaret()
  }

  func listUnappliedIntake() -> [[String: Any]] {
    (try? journal?.listUnapplied())?.map { row in
      ["transactionId": row.transactionId, "payload": row.payload]
    } ?? []
  }

  func markIntakeApplied(transactionId: String) throws {
    do {
      try journal?.markApplied(transactionId: transactionId)
    } catch {
      emitError(code: "journal_mark_failed", context: transactionId)
      throw JotEditorError.journalAppendFailed
    }
  }

  func textViewShouldCommit(_ textView: JotTextView, range: NSRange, replacement: String) -> Bool {
    if applyingInternally {
      return true
    }
    if textView.composition.active || textView.markedTextRange != nil {
      return false
    }
    if isAtomicRange(range) {
      if replacement.isEmpty && range.length > 0 {
        let from = AttributedBridge.schemaLocation(
          utf16Index: range.location,
          affinity: "before",
          attributed: textView.attributedText,
          linear: linear,
          revision: revision
        )
        let plan = LinearCommands.deleteBlock(at: from, linear: linear, storedMarks: storedMarks)
        if !plan.operations.isEmpty {
          do {
            try commit(
              operations: plan.operations,
              transactionId: JotIds.create(),
              journalFirst: true,
              selectionAfter: plan.selectionAfter
            )
          } catch {
            emitError(code: "journal_append_failed", context: "commit")
          }
        }
      }
      return false
    }
    let from = AttributedBridge.schemaLocation(
      utf16Index: range.location,
      affinity: "before",
      attributed: textView.attributedText,
      linear: linear,
      revision: revision
    )
    let to = AttributedBridge.schemaLocation(
      utf16Index: range.location + range.length,
      affinity: "after",
      attributed: textView.attributedText,
      linear: linear,
      revision: revision
    )
    var plan: EditPlan?
    if replacement == "\n" || replacement == " " {
      plan = LinearCommands.inputRule(
        terminator: replacement,
        linear: linear,
        selection: from,
        storedMarks: storedMarks
      )
    }
    if plan == nil && replacement == "\n" {
      plan = LinearCommands.split(at: from, linear: linear, storedMarks: storedMarks)
    }
    if plan == nil && replacement.isEmpty {
      let atBlockStart = from.offsetUtf16 == 0
      let crossesBlocks = from.nodeId != to.nodeId
      if atBlockStart || crossesBlocks {
        if let blockId = inputRuleBlockId,
           let current = LinearModel.block(nodeId: from.nodeId, in: linear),
           (current.id == blockId || current.paragraphId == blockId),
           atBlockStart {
          do {
            try undo()
          } catch {
            emitError(code: "journal_append_failed", context: "input_rule_undo")
          }
          return false
        }
        plan = LinearCommands.join(at: from, linear: linear, storedMarks: storedMarks)
        if plan?.operations.isEmpty == true {
          plan = nil
        }
      }
    }
    if plan == nil {
      if range.length == 0 && replacement.isEmpty {
        return false
      }
      var operations: [SchemaOperation] = []
      if range.length == 0 {
        operations = [
          .insertText(position: from, text: replacement, storedMarks: storedMarks.map { $0.toSchema() })
        ]
      } else {
        let deleted = deletedSlice(from: from, to: to)
        if replacement.isEmpty {
          operations = [.deleteRange(from: from, to: to, deletedSlice: deleted)]
        } else {
          operations = [
            .replaceRange(
              from: from,
              to: to,
              slice: textSlice(replacement, marks: storedMarks),
              deletedSlice: deleted
            )
          ]
        }
      }
      plan = EditPlan(
        operations: operations,
        storedMarks: storedMarks,
        collapsedOnly: false,
        selectionAfter: SchemaSelection(
          nodeId: from.nodeId,
          offsetUtf16: from.offsetUtf16 + Utf16.count(replacement),
          affinity: "after",
          revision: revision
        ),
        isInputRule: false
      )
    }
    guard let plan, !plan.operations.isEmpty else {
      return false
    }
    do {
      try commit(
        operations: plan.operations,
        transactionId: JotIds.create(),
        journalFirst: true,
        selectionAfter: plan.selectionAfter,
        isInputRule: plan.isInputRule
      )
    } catch {
      emitError(code: "journal_append_failed", context: "commit")
    }
    return false
  }

  func textViewDidBeginComposition(_ textView: JotTextView, range: NSRange, text: String) {
    let from = AttributedBridge.schemaLocation(
      utf16Index: range.location,
      affinity: "before",
      attributed: textView.attributedText,
      linear: linear,
      revision: revision
    )
    textView.composition.begin(
      range: range,
      text: text,
      nodeId: from.nodeId,
      offsetUtf16: from.offsetUtf16,
      affinity: from.affinity
    )
    onCompositionChanged(["active": true])
  }

  func textViewDidFinishComposition(_ textView: JotTextView, committed: String?, cancelled: Bool) {
    let session = textView.composition
    guard session.active else { return }
    textView.composition.end()
    onCompositionChanged(["active": false])
    if cancelled {
      return
    }
    let committedText = committed ?? ""
    if committedText == session.originText {
      return
    }
    let from = session.originSelection(revision: revision)
    let to = SchemaSelection(
      nodeId: from.nodeId,
      offsetUtf16: from.offsetUtf16 + Utf16.count(session.originText),
      affinity: "after",
      revision: revision
    )
    let operations: [SchemaOperation] = [
      .replaceRange(
        from: from,
        to: to,
        slice: textSlice(committedText, marks: storedMarks),
        deletedSlice: textSlice(session.originText, marks: [])
      )
    ]
    do {
      try commit(
        operations: operations,
        transactionId: JotIds.create(),
        journalFirst: true,
        rebuild: false
      )
    } catch {
      applyingInternally = true
      textView.replaceInternally(with: attributedContent())
      applyingInternally = false
      emitError(code: "journal_append_failed", context: "ime_commit")
    }
  }

  func textViewDidChangeSelection(_ textView: JotTextView) {
    if applyingInternally {
      return
    }
    let range = textView.selectedRange
    let affinity = range.length == 0 ? "after" : "before"
    selection = AttributedBridge.schemaLocation(
      utf16Index: range.location,
      affinity: affinity,
      attributed: textView.attributedText,
      linear: linear,
      revision: revision
    )
    if range.length > 0 {
      anchor = AttributedBridge.schemaLocation(
        utf16Index: range.location + range.length,
        affinity: "after",
        attributed: textView.attributedText,
        linear: linear,
        revision: revision
      )
    } else {
      anchor = nil
    }
    if let block = LinearModel.block(nodeId: selection.nodeId, in: linear) {
      storedMarks = block.markTypes(at: selection.offsetUtf16)
    }
    emitSelection()
  }

  func textViewDidTapTask(_ textView: JotTextView, nodeId: String) {
    guard let block = LinearModel.block(nodeId: nodeId, in: linear), block.kind == .taskItem else { return }
    let next = (block.checked ?? 0) == 0 ? 1 : 0
    let op = SchemaOperation.setNodeAttributes(
      nodeId: block.id,
      patch: ["checked": .int(next)],
      priorValues: ["checked": .int(block.checked ?? 0)]
    )
    try? commit(operations: [op], transactionId: JotIds.create(), journalFirst: true)
  }

  func textViewDidPasteImageFile(_ textView: JotTextView, fileURL: URL) {
    let attachmentId = JotIds.create()
    imagePaths[attachmentId] = fileURL.path
    try? dispatchCommand([
      "name": "insertImage",
      "attachmentId": attachmentId,
      "alt": "",
      "path": fileURL.path,
      "widthBasisPoints": 10000
    ])
  }

  func textViewDidChangeContentSize(_ textView: JotTextView) {
    reportHeight()
  }

  private func replayUnapplied() {
    let rows: [(transactionId: String, payload: String)]
    do {
      rows = try journal?.listUnapplied() ?? []
    } catch {
      emitError(code: "journal_read_failed", context: "listUnapplied")
      return
    }
    for row in rows {
      guard let parsed = JournalPayload.parse(row.payload) else {
        emitError(code: "unapplied_payload_parse_failed", context: row.transactionId)
        continue
      }
      do {
        try commit(
          operations: parsed.operations,
          transactionId: parsed.transactionId,
          journalFirst: false,
          recordUndo: false,
          rebuild: false,
          emitCommitted: false
        )
      } catch {
        emitError(code: "unapplied_payload_apply_failed", context: row.transactionId)
      }
    }
  }

  private func commit(
    operations: [SchemaOperation],
    transactionId: String,
    journalFirst: Bool,
    recordUndo: Bool = true,
    rebuild: Bool = true,
    emitCommitted: Bool = true,
    selectionAfter: SchemaSelection? = nil,
    isInputRule: Bool = false
  ) throws {
    if operations.isEmpty {
      return
    }
    let base = revision
    let selectionBefore = selection
    let payload = CanonicalJSON.stringify(
      .object([
        "transactionId": .string(transactionId),
        "baseRevision": .int(base),
        "operations": .array(operations.map { $0.toJSON() }),
        "selection": selection.toJSON()
      ])
    )
    if journalFirst {
      do {
        if journal == nil {
          journal = try DurableJournal(fileURL: journalURL(documentId: documentId.isEmpty ? "unbound" : documentId))
        }
        try journal?.append(transactionId: transactionId, payload: payload)
      } catch {
        emitError(code: "journal_append_failed", context: "sqlite")
        throw JotEditorError.journalAppendFailed
      }
    }
    let snapshot = linear
    do {
      try LinearModel.apply(operations, to: &linear)
    } catch {
      linear = snapshot
      throw error
    }
    revision += 1
    if let selectionAfter {
      selection = selectionAfter
      selection.revision = revision
    } else if let last = linear.blocks.last {
      selection = SchemaSelection(
        nodeId: last.paragraphId ?? last.id,
        offsetUtf16: min(selection.offsetUtf16, last.utf16Length),
        affinity: "after",
        revision: revision
      )
    }
    if isInputRule {
      inputRuleBlockId = selection.nodeId
    } else if emitCommitted {
      inputRuleBlockId = nil
    }
    if rebuild {
      rebuildText(preserveSelection: true)
    }
    if recordUndo {
      undoStack.push(
        UndoEntry(
          transactionId: transactionId,
          forward: operations,
          inverse: operations.reversed().map { $0.inverted() },
          selectionBefore: selectionBefore,
          selectionAfter: selection
        )
      )
      textView.undoManager?.registerUndo(withTarget: self) { view in
        try? view.undo()
      }
    }
    if emitCommitted {
      onCommittedTransaction([
        "transactionId": transactionId,
        "baseRevision": base,
        "operations": operations.map { $0.toAny() },
        "selection": selection.toAny()
      ])
    }
  }

  private func rebuildText(preserveSelection: Bool) {
    applyingInternally = true
    let caret = selection
    textView.replaceInternally(with: attributedContent())
    if preserveSelection {
      selection = caret
      selection.revision = revision
      restoreCaret()
    }
    applyingInternally = false
    reportHeight()
  }

  private func restoreCaret() {
    let index = AttributedBridge.utf16Index(selection: selection, linear: linear)
    textView.selectedRange = NSRange(location: min(index, textView.journaledStorage.length), length: 0)
  }

  private func textSlice(_ text: String, marks: [LinearMark]) -> [SchemaNode] {
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

  private func deletedSlice(from: SchemaSelection, to: SchemaSelection) -> [SchemaNode] {
    guard let block = LinearModel.block(nodeId: from.nodeId, in: linear) else { return [] }
    let length = max(0, to.offsetUtf16 - from.offsetUtf16)
    let text = Utf16.slice(block.plainText, offset: from.offsetUtf16, length: length)
    return textSlice(text, marks: [])
  }

  private func attributedContent() -> NSAttributedString {
    AttributedBridge.attributedString(
      from: linear,
      imagePaths: imagePaths,
      containerWidth: editorContentWidth()
    )
  }

  private func editorContentWidth() -> CGFloat {
    max(textView.bounds.width - textView.textContainerInset.left - textView.textContainerInset.right, 0)
  }

  private func isAtomicRange(_ range: NSRange) -> Bool {
    guard textView.journaledStorage.length > 0 else { return false }
    let index = min(range.location, textView.journaledStorage.length - 1)
    let attrs = textView.journaledStorage.attributes(at: index, effectiveRange: nil)
    if let kind = attrs[.jotKind] as? String {
      let parsed = LinearBlockKind(rawValue: kind)
      if let parsed, LinearModel.isAtomicKind(parsed) {
        return true
      }
    }
    if attrs[.attachment] is PlaceholderAttachment { return true }
    if attrs[.attachment] is HorizontalRuleAttachment { return true }
    if attrs[.attachment] is ImageBlockAttachment { return true }
    return false
  }

  private func emitSelection() {
    onSelectionChanged([
      "selection": selection.toAny(),
      "activeMarks": storedMarks.map { $0.toSchema().toAny() }
    ])
  }

  private func emitError(code: String, context: String) {
    onRecoverableError([
      "code": code,
      "context": context
    ])
  }

  private func reportHeight() {
    let height = AttributedBridge.usedHeight(of: textView)
    if abs(height - lastHeight) < 0.5 {
      return
    }
    lastHeight = height
    onContentSizeChanged(["height": height])
  }

  private func journalURL(documentId: String) -> URL {
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    let safe = documentId.replacingOccurrences(of: "/", with: "_")
    return root.appendingPathComponent("jot-editor-intake", isDirectory: true)
      .appendingPathComponent("\(safe).sqlite")
  }

  @objc private func keyboardWillChange(_ notification: Notification) {
    guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
      return
    }
    guard let window else {
      return
    }
    let keyboardInWindow = window.convert(frame, from: nil)
    let keyboardInView = convert(keyboardInWindow, from: window)
    let overlap = max(0, bounds.maxY - keyboardInView.minY)
    textView.contentInset.bottom = overlap
    textView.verticalScrollIndicatorInsets.bottom = overlap
    textView.scrollRangeToVisible(textView.selectedRange)
  }

  @objc private func keyboardWillHide(_ notification: Notification) {
    textView.contentInset.bottom = safeAreaInsets.bottom
    textView.verticalScrollIndicatorInsets.bottom = safeAreaInsets.bottom
  }
}
