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
  let onFocusChanged = EventDispatcher()
  let onImagePressed = EventDispatcher()
  let onPasteRequested = EventDispatcher()
  let onRecoverableError = EventDispatcher()

  /// Lines wider than this get hard to read on iPad, so the margins grow instead.
  private static let readableWidth: CGFloat = 680
  private static let horizontalMargin: CGFloat = 20
  private static let pinchStep = 100
  private static let markTypes = ["bold", "italic", "underline", "strikethrough", "inlineCode", "link"]

  private let textView = JotTextView()
  private let undoStack = UndoStack()
  private var journal: DurableJournal?
  private var linear = LinearDocument(id: JotIds.create(), blocks: [])
  private var documentId = ""
  private var schemaVersion = 1
  private var revision = 0
  /// Start of the selection. `anchor` is its end when a range is selected.
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
  private var lastRenderWidth: CGFloat = 0
  private var imagePaths: [String: String] = [:]
  private var attachmentsDirectory: URL?
  private var imageWidthOverrides: [String: Int] = [:]
  private var pinch: (nodeId: String, startWidth: Int, currentWidth: Int)?
  private var keyboardFrame: CGRect?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .clear
    textView.host = self
    addSubview(textView)
    journal = try? DurableJournal(fileURL: journalURL(documentId: "unbound"))
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    center.addObserver(self, selector: #selector(contentSizeCategoryChanged), name: UIContentSizeCategory.didChangeNotification, object: nil)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  public override func layoutSubviews() {
    let rotated = lastBoundsSize != .zero && lastBoundsSize.width != bounds.width
    let savedSelection = selection
    let savedOffset = textView.contentOffset
    super.layoutSubviews()
    textView.frame = bounds
    applyMargins()
    let width = editorContentWidth()
    if abs(width - lastRenderWidth) > 1 {
      lastRenderWidth = width
      if hasCompletedLoad && linear.blocks.contains(where: { $0.kind == .image || $0.kind == .horizontalRule }) {
        rebuildText(preserveSelection: true)
      }
    }
    if rotated {
      selection = savedSelection
      applyingInternally = true
      restoreCaret()
      applyingInternally = false
      var offset = savedOffset
      let maxOffset = max(0, textView.contentSize.height - textView.bounds.height + textView.contentInset.bottom)
      offset.y = min(max(0, offset.y), maxOffset)
      textView.setContentOffset(offset, animated: false)
    }
    lastBoundsSize = bounds.size
    updateKeyboardInset()
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

  // MARK: Props

  func setDocumentId(_ value: String) {
    documentId = value
  }

  func setSchemaVersion(_ value: Int) {
    schemaVersion = value
  }

  func setRevision(_ value: Int) {
    revision = value
  }

  func setAttachmentsDirectory(_ value: String?) {
    let next: URL? = value.flatMap { raw in
      raw.hasPrefix("file://") ? URL(string: raw) : URL(fileURLWithPath: raw)
    }
    guard next != attachmentsDirectory else { return }
    attachmentsDirectory = next
    if hasCompletedLoad {
      rebuildText(preserveSelection: true)
    }
  }

  func setPlaceholder(_ value: String?) {
    textView.placeholder = value ?? ""
    updatePlaceholder()
  }

  func setAccentColor(_ value: String?) {
    guard let color = UIColor(jotHex: value) else { return }
    textView.tintColor = color
    EditorTheme.accent = color
    if hasCompletedLoad {
      rebuildText(preserveSelection: true)
    }
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
      try loadDocument(documentId: id, canonicalDocument: value, schemaVersion: schemaVersion, revision: revision)
    } catch {
      emitError(code: "invalid_document", context: "canonicalDocument")
    }
  }

  // MARK: Commands from JavaScript

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
    linear = LinearModel.withEditableBody(LinearModel.documentToLinear(node))
    undoStack.clear()
    storedMarks = []
    anchor = nil
    imagePaths = [:]
    imageWidthOverrides = [:]
    inputRuleBlockId = nil
    journal = try DurableJournal(fileURL: journalURL(documentId: documentId))
    replayUnapplied()
    applyingInternally = true
    textView.replaceInternally(with: attributedContent())
    if let first = linear.blocks.first {
      selection = SchemaSelection(nodeId: first.paragraphId ?? first.id, offsetUtf16: 0, affinity: "before", revision: self.revision)
    } else {
      selection = SchemaSelection(nodeId: linear.id, offsetUtf16: 0, affinity: "before", revision: self.revision)
    }
    restoreCaret()
    applyingInternally = false
    textView.setContentOffset(.zero, animated: false)
    boundDocumentId = documentId
    lastLoadedCanonical = CanonicalJSON.stringify(node.toJSON())
    hasCompletedLoad = true
    updateTypingAttributes()
    updatePlaceholder()
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
    let name = command["name"] as? String ?? command["command"] as? String ?? ""
    if name == "insertImage",
       let path = command["path"] as? String,
       let id = command["attachmentId"] as? String, !id.isEmpty {
      imagePaths[id] = path.hasPrefix("file://") ? (URL(string: path)?.path ?? path) : path
    }
    let value: JSONValue?
    if command["level"] != nil {
      value = JSONValue.from(command["level"] as Any)
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
      isInputRule: result.isInputRule,
      keepRange: result.selectionAfter == nil && anchor != nil
    )
  }

  func setSelection(_ raw: [String: Any]) {
    selection = SchemaSelection.parse(raw)
    anchor = nil
    applyingInternally = true
    restoreCaret()
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
    guard let entry = undoStack.popUndo() else {
      emitSelection()
      return
    }
    let operations: [SchemaOperation]
    if let before = entry.beforeSnapshot {
      operations = LinearCommands.contentDiffOps(from: LinearModel.linearToDocument(linear), to: LinearModel.linearToDocument(before))
    } else {
      operations = entry.inverse
    }
    try replayHistory(entry: entry, operations: operations, origin: "undo", caret: entry.selectionBefore)
  }

  func redo() throws {
    guard let entry = undoStack.popRedo() else {
      emitSelection()
      return
    }
    let operations: [SchemaOperation]
    if let after = entry.afterSnapshot {
      operations = LinearCommands.contentDiffOps(from: LinearModel.linearToDocument(linear), to: LinearModel.linearToDocument(after))
    } else {
      operations = entry.forward
    }
    try replayHistory(entry: entry, operations: operations, origin: "redo", caret: entry.selectionAfter)
  }

  /// Persisted history from the local store, oldest first, so undo survives relaunch.
  func seedHistory(undo: [[String: Any]], redo: [[String: Any]]) {
    // A late seed must never discard edits made in this session.
    guard !undoStack.canUndo && !undoStack.canRedo else { return }
    func entry(_ raw: [String: Any]) -> UndoEntry? {
      guard let id = raw["transactionId"] as? String else { return nil }
      let forward = SchemaOperation.parseList(raw["forward"] as? [Any] ?? [])
      let inverse = SchemaOperation.parseList(raw["inverse"] as? [Any] ?? [])
      guard !forward.isEmpty, !inverse.isEmpty else { return nil }
      return UndoEntry(
        transactionId: id,
        forward: forward,
        inverse: inverse,
        selectionBefore: caret(for: inverse) ?? selection,
        selectionAfter: caret(for: forward) ?? selection
      )
    }
    undoStack.seed(undo: undo.compactMap(entry), redo: redo.compactMap(entry))
    emitSelection()
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

  // MARK: Text view callbacks

  func textViewShouldCommit(_ textView: JotTextView, range: NSRange, replacement: String) -> Bool {
    if applyingInternally {
      return true
    }
    if textView.composition.active || textView.markedTextRange != nil {
      return false
    }
    if range.length > 0, !replacement.isEmpty,
       range.location + range.length <= textView.journaledStorage.length,
       (textView.journaledStorage.string as NSString).substring(with: range) == replacement {
      // Dismissing an autocorrect suggestion replaces a word with itself. Recording that adds
      // an undo step that changes nothing.
      return false
    }
    let from = location(range.location, affinity: "before")
    let to = location(range.location + range.length, affinity: "after")
    let fromBlock = LinearModel.block(nodeId: from.nodeId, in: linear)

    // Several lines at once, from dictation or a keyboard paste, go through Markdown parsing so
    // each line becomes a block. Newlines inside a paragraph would desynchronize the model.
    if Utf16.count(replacement) > 1, replacement.contains(where: \.isNewline), fromBlock?.kind != .codeBlock {
      deleteSelection(range: range, from: from, to: to)
      onPasteRequested(["text": replacement])
      return false
    }

    let change = EditPlanner.Change(
      from: from,
      to: to,
      replacement: replacement,
      rangeLength: range.length,
      deletesAtomic: range.length == 1 && isAtomicCharacter(range.location)
    )
    let plan: EditPlan
    switch EditPlanner.plan(change, linear: linear, storedMarks: storedMarks, inputRuleBlockId: inputRuleBlockId) {
    case .undoInputRule:
      // Backspace right after a Markdown shortcut restores the characters that triggered it.
      try? undo()
      return false
    case .ignore:
      return false
    case let .plan(planned):
      plan = planned
    }
    do {
      try commit(
        operations: plan.operations,
        transactionId: JotIds.create(),
        journalFirst: true,
        selectionAfter: plan.selectionAfter,
        isInputRule: plan.isInputRule
      )
      if plan.storedMarks != storedMarks && (replacement == "*" || replacement == "_" || replacement == "~" || replacement == "`" || replacement == ")") {
        storedMarks = plan.storedMarks
      }
      scrollCaretIntoView()
    } catch {
      emitError(code: "journal_append_failed", context: "commit")
    }
    return false
  }

  func textViewDidBeginComposition(_ textView: JotTextView, range: NSRange, text: String) {
    let from = location(range.location, affinity: "before")
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
      updatePlaceholder()
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
        slice: [LinearModel.textNode(committedText, marks: storedMarks)],
        deletedSlice: [LinearModel.textNode(session.originText, marks: [])]
      )
    ]
    do {
      try commit(operations: operations, transactionId: JotIds.create(), journalFirst: true, rebuild: false)
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
    selection = location(range.location, affinity: range.length == 0 ? "after" : "before")
    anchor = range.length > 0 ? location(range.location + range.length, affinity: "after") : nil
    if range.length == 0 {
      // A caret before a bullet, number, or checkbox belongs after it.
      let expected = AttributedBridge.utf16Index(selection: selection, linear: linear)
      if expected != range.location, expected <= textView.journaledStorage.length {
        applyingInternally = true
        textView.selectedRange = NSRange(location: expected, length: 0)
        applyingInternally = false
      }
    }
    if let block = LinearModel.block(nodeId: selection.nodeId, in: linear) {
      storedMarks = block.markTypes(at: selection.offsetUtf16)
    }
    updateTypingAttributes()
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
    UISelectionFeedbackGenerator().selectionChanged()
    try? commit(operations: [op], transactionId: JotIds.create(), journalFirst: true)
  }

  func textViewDidTapImage(_ textView: JotTextView, attachment: ImageBlockAttachment) {
    if textView.isFirstResponder, let index = LinearModel.indexOfBlock(nodeId: attachment.nodeId, in: linear) {
      // Keep typing out of the image: park the caret where the next block starts.
      let target: SchemaSelection
      if index + 1 < linear.blocks.count {
        let next = linear.blocks[index + 1]
        target = SchemaSelection(nodeId: next.paragraphId ?? next.id, offsetUtf16: 0, affinity: "after", revision: revision)
      } else {
        target = SchemaSelection(nodeId: attachment.nodeId, offsetUtf16: 1, affinity: "after", revision: revision)
      }
      let utf16 = AttributedBridge.utf16Index(selection: target, linear: linear)
      if utf16 <= textView.journaledStorage.length {
        textView.selectedRange = NSRange(location: utf16, length: 0)
      }
    }
    onImagePressed([
      "nodeId": attachment.nodeId,
      "attachmentId": attachment.attachmentId,
      "widthBasisPoints": attachment.widthBasisPoints
    ])
  }

  func textViewDidChangeContentSize(_ textView: JotTextView) {
    reportHeight()
  }

  func textViewDidChangeFocus(_ textView: JotTextView, focused: Bool) {
    onFocusChanged(["focused": focused])
    if focused {
      DispatchQueue.main.async { [weak self] in
        self?.scrollCaretIntoView()
      }
    }
  }

  func textViewHandlePaste(_ textView: JotTextView) -> Bool {
    let pasteboard = UIPasteboard.general
    let range = textView.selectedRange
    let from = location(range.location, affinity: "before")
    let to = location(range.location + range.length, affinity: "after")
    if let url = JotTextView.pasteboardImageFileURL() {
      deleteSelection(range: range, from: from, to: to)
      onPasteRequested(["imagePath": url.path])
      return true
    }
    if !pasteboard.hasStrings, pasteboard.hasImages, let image = pasteboard.image, let data = image.jpegData(compressionQuality: 0.9) {
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("jot-paste-\(JotIds.create()).jpg")
      do {
        try data.write(to: url, options: .atomic)
      } catch {
        emitError(code: "paste_image_failed", context: "write")
        return true
      }
      deleteSelection(range: range, from: from, to: to)
      onPasteRequested(["imagePath": url.path])
      return true
    }
    guard let text = pasteboard.string, !text.isEmpty else {
      return true
    }
    if LinearModel.block(nodeId: from.nodeId, in: linear)?.kind == .codeBlock {
      return false
    }
    if !text.contains(where: \.isNewline) && !Self.looksLikeMarkdown(text) {
      return false
    }
    deleteSelection(range: range, from: from, to: to)
    onPasteRequested(["text": text])
    return true
  }

  func textViewDidPinchImage(_ textView: JotTextView, gesture: UIPinchGestureRecognizer) {
    switch gesture.state {
    case .began:
      guard let attachment = textView.imageAttachment(at: gesture.location(in: textView)) else { return }
      pinch = (attachment.nodeId, attachment.widthBasisPoints, attachment.widthBasisPoints)
    case .changed:
      guard var active = pinch else { return }
      let scaled = Int((CGFloat(active.startWidth) * gesture.scale).rounded())
      let next = min(10000, max(LinearCommands.minimumImageWidthBasisPoints, scaled))
      guard abs(next - active.currentWidth) >= Self.pinchStep else { return }
      if next == 10000 && active.currentWidth != 10000 {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
      }
      active.currentWidth = next
      pinch = active
      imageWidthOverrides[active.nodeId] = next
      rebuildText(preserveSelection: true)
    case .ended:
      guard let active = pinch else { return }
      pinch = nil
      imageWidthOverrides.removeValue(forKey: active.nodeId)
      let final = active.currentWidth >= 9600 ? 10000 : active.currentWidth
      if final == active.startWidth {
        rebuildText(preserveSelection: true)
        return
      }
      do {
        try dispatchCommand(["name": "setImageWidth", "nodeId": active.nodeId, "widthBasisPoints": final])
      } catch {
        rebuildText(preserveSelection: true)
        emitError(code: "journal_append_failed", context: "image_width")
      }
    case .cancelled, .failed:
      guard let active = pinch else { return }
      pinch = nil
      imageWidthOverrides.removeValue(forKey: active.nodeId)
      rebuildText(preserveSelection: true)
    default:
      break
    }
  }

  func textViewPerformCommand(_ textView: JotTextView, name: String) {
    do {
      switch name {
      case "undo":
        try undo()
      case "redo":
        try redo()
      default:
        try dispatchCommand(["name": name])
      }
    } catch {
      emitError(code: "journal_append_failed", context: name)
    }
  }

  // MARK: Edit planning

  private func location(_ index: Int, affinity: String) -> SchemaSelection {
    AttributedBridge.schemaLocation(
      utf16Index: index,
      affinity: affinity,
      attributed: textView.attributedText,
      linear: linear,
      revision: revision
    )
  }

  private func deleteSelection(range: NSRange, from: SchemaSelection, to: SchemaSelection) {
    guard range.length > 0 else { return }
    let plan = from.nodeId == to.nodeId
      ? EditPlanner.textReplacement(from: from, to: to, rangeLength: range.length, replacement: "", linear: linear, storedMarks: storedMarks)
      : EditPlanner.crossBlockReplacement(from: from, to: to, replacement: "", linear: linear, storedMarks: storedMarks)
    guard let plan, !plan.operations.isEmpty else { return }
    do {
      try commit(operations: plan.operations, transactionId: JotIds.create(), journalFirst: true, selectionAfter: plan.selectionAfter)
    } catch {
      emitError(code: "journal_append_failed", context: "paste_replace")
    }
  }

  private func replayHistory(entry: UndoEntry, operations: [SchemaOperation], origin: String, caret: SchemaSelection) throws {
    guard !operations.isEmpty else {
      emitSelection()
      return
    }
    let target = LinearModel.block(nodeId: caret.nodeId, in: linear) != nil ? caret : nil
    do {
      try commit(
        operations: operations,
        transactionId: JotIds.create(),
        journalFirst: true,
        recordUndo: false,
        selectionAfter: target,
        origin: origin,
        historyOf: entry.transactionId
      )
    } catch {
      undoStack.clear()
      emitError(code: "\(origin)_failed", context: entry.transactionId)
      throw error
    }
    if target == nil {
      // The caret's block did not exist until this step ran.
      if let restored = LinearModel.block(nodeId: caret.nodeId, in: linear) {
        selection = SchemaSelection(nodeId: caret.nodeId, offsetUtf16: min(caret.offsetUtf16, restored.utf16Length), affinity: caret.affinity, revision: revision)
        applyingInternally = true
        restoreCaret()
        applyingInternally = false
        emitSelection()
      }
    }
    scrollCaretIntoView()
  }

  private func caret(for operations: [SchemaOperation]) -> SchemaSelection? {
    for operation in operations {
      switch operation {
      case let .insertText(position, _, _):
        return position
      case let .deleteRange(from, _, _), let .replaceRange(from, _, _, _), let .addMark(from, _, _), let .removeMark(from, _, _):
        return from
      case let .setNodeAttributes(nodeId, _, _):
        return SchemaSelection(nodeId: nodeId, offsetUtf16: 0, affinity: "before", revision: revision)
      case .insertNode, .deleteNode:
        continue
      }
    }
    return nil
  }

  /// Set before `loadDocument`. The store can commit an edit and the process can die before
  /// the journal row is marked applied; replaying that row would apply the edit twice.
  private var committedElsewhere = Set<String>()

  func setAppliedTransactionIds(_ ids: [String]) {
    committedElsewhere = Set(ids)
  }

  private func replayUnapplied() {
    let rows: [(transactionId: String, payload: String)]
    do {
      rows = try journal?.listUnapplied() ?? []
    } catch {
      emitError(code: "journal_read_failed", context: "listUnapplied")
      return
    }
    let alreadyCommitted = committedElsewhere
    committedElsewhere = []
    for row in rows {
      if alreadyCommitted.contains(row.transactionId) {
        try? journal?.markApplied(transactionId: row.transactionId)
        continue
      }
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
    isInputRule: Bool = false,
    origin: String = "local",
    historyOf: String? = nil,
    keepRange: Bool = false
  ) throws {
    if operations.isEmpty {
      return
    }
    let base = revision
    let selectionBefore = selection
    let previousRange = textView.selectedRange
    let payload = CanonicalJSON.stringify(
      .object([
        "transactionId": .string(transactionId),
        "baseRevision": .int(base),
        "operations": .array(operations.map { $0.toJSON() }),
        "selection": selection.toJSON()
      ])
    )
    let journalStarted = EditorPerformanceLog.now()
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
    let applyStarted = EditorPerformanceLog.now()
    let snapshot = linear
    do {
      try LinearModel.apply(operations, to: &linear)
    } catch {
      linear = snapshot
      throw error
    }
    let applyFinished = EditorPerformanceLog.now()
    revision += 1
    if let selectionAfter {
      selection = selectionAfter
      selection.revision = revision
      anchor = nil
    } else if let block = LinearModel.block(nodeId: selection.nodeId, in: linear) {
      selection.offsetUtf16 = min(selection.offsetUtf16, block.utf16Length)
      selection.revision = revision
      if !keepRange {
        anchor = nil
      }
    } else if let last = linear.blocks.last {
      selection = SchemaSelection(nodeId: last.paragraphId ?? last.id, offsetUtf16: last.utf16Length, affinity: "after", revision: revision)
      anchor = nil
    }
    if isInputRule {
      inputRuleBlockId = selection.nodeId
    } else if emitCommitted {
      inputRuleBlockId = nil
    }
    let renderStarted = EditorPerformanceLog.now()
    if rebuild {
      rebuildText(preserveSelection: true, keepRange: keepRange ? previousRange : nil, previous: snapshot)
    }
    let historyStarted = EditorPerformanceLog.now()
    if recordUndo {
      let inverse = LinearModel.invert(operations, before: snapshot)
      undoStack.push(
        UndoEntry(
          transactionId: transactionId,
          forward: operations,
          inverse: inverse ?? [],
          selectionBefore: selectionBefore,
          selectionAfter: selection,
          beforeSnapshot: inverse == nil ? snapshot : nil,
          afterSnapshot: inverse == nil ? linear : nil
        )
      )
    }
    let historyFinished = EditorPerformanceLog.now()
    EditorPerformanceLog.commit(
      blocks: linear.blocks.count,
      journal: applyStarted - journalStarted,
      apply: applyFinished - applyStarted,
      render: historyStarted - renderStarted,
      history: historyFinished - historyStarted
    )
    if emitCommitted {
      var event: [String: Any] = [
        "transactionId": transactionId,
        "baseRevision": base,
        "operations": operations.map { $0.toAny() },
        "selection": selection.toAny(),
        "origin": origin
      ]
      if let historyOf {
        event["historyOf"] = historyOf
      }
      onCommittedTransaction(event)
    }
    updatePlaceholder()
    emitSelection()
  }

  // MARK: Rendering

  /// Replaces only the blocks that differ from `old`. A keystroke in a 5,000-word note then
  /// rebuilds one paragraph instead of every paragraph. Returns false when a full render is needed.
  private func renderChanges(from old: LinearDocument) -> Bool {
    let oldBlocks = old.blocks
    let newBlocks = linear.blocks
    guard old.id == linear.id, !oldBlocks.isEmpty, !newBlocks.isEmpty else { return false }
    var prefix = 0
    while prefix < oldBlocks.count, prefix < newBlocks.count, oldBlocks[prefix] == newBlocks[prefix] {
      prefix += 1
    }
    var oldEnd = oldBlocks.count
    var newEnd = newBlocks.count
    while oldEnd > prefix, newEnd > prefix, oldBlocks[oldEnd - 1] == newBlocks[newEnd - 1] {
      oldEnd -= 1
      newEnd -= 1
    }
    if prefix == oldBlocks.count && prefix == newBlocks.count {
      return true
    }
    // List numbers and "item n of m" labels depend on neighbouring items, so a change that
    // touches a list redraws the whole run of list blocks around it.
    let touchesList = oldBlocks[prefix..<oldEnd].contains { LinearModel.isListKind($0.kind) }
      || newBlocks[prefix..<newEnd].contains { LinearModel.isListKind($0.kind) }
    if touchesList {
      while prefix > 0, LinearModel.isListKind(newBlocks[prefix - 1].kind) {
        prefix -= 1
      }
      while oldEnd < oldBlocks.count, newEnd < newBlocks.count, LinearModel.isListKind(newBlocks[newEnd].kind) {
        oldEnd += 1
        newEnd += 1
      }
    }
    var ends: [Int] = []
    ends.reserveCapacity(oldBlocks.count)
    var cursor = 0
    for (index, block) in oldBlocks.enumerated() {
      cursor += LinearModel.leadingCount(block) + block.utf16Length
      ends.append(cursor)
      if index + 1 < oldBlocks.count {
        cursor += 1
      }
    }
    guard cursor == textView.journaledStorage.length else { return false }
    // Each block owns the newline after it. The range starts at the newline owned by the block
    // before the change, because that newline disappears or reappears with the blocks after it.
    let start = prefix > 0 ? ends[prefix - 1] : 0
    let end: Int
    if oldEnd > prefix {
      end = ends[oldEnd - 1] + (oldEnd < oldBlocks.count ? 1 : 0)
    } else {
      end = start + (prefix > 0 && prefix < oldBlocks.count ? 1 : 0)
    }
    guard start <= end, end <= textView.journaledStorage.length else { return false }
    let segmentStarted = EditorPerformanceLog.now()
    let segment = AttributedBridge.attributedBlocks(
      linear,
      range: prefix..<newEnd,
      leadingSeparator: prefix > 0 && newBlocks.count > prefix,
      context: renderContext()
    )
    let segmentBuilt = EditorPerformanceLog.now()
    textView.replaceInternally(range: NSRange(location: start, length: end - start), with: segment)
    EditorPerformanceLog.segment(blocks: newEnd - prefix, build: segmentBuilt - segmentStarted, replace: EditorPerformanceLog.now() - segmentBuilt)
    return textView.journaledStorage.length == AttributedBridge.utf16Index(
      selection: SchemaSelection(nodeId: newBlocks[newBlocks.count - 1].paragraphId ?? newBlocks[newBlocks.count - 1].id, offsetUtf16: Int.max, affinity: "after", revision: 0),
      linear: linear
    )
  }

  private func rebuildText(preserveSelection: Bool, keepRange: NSRange? = nil, previous: LinearDocument? = nil) {
    let wasApplying = applyingInternally
    applyingInternally = true
    let caret = selection
    let offset = textView.contentOffset
    let started = EditorPerformanceLog.now()
    if let previous, renderChanges(from: previous) {
      // Only the changed blocks were replaced.
    } else {
      textView.replaceInternally(with: attributedContent())
    }
    let replaced = EditorPerformanceLog.now()
    if preserveSelection {
      selection = caret
      selection.revision = revision
      if let keepRange, keepRange.location + keepRange.length <= textView.journaledStorage.length {
        textView.selectedRange = keepRange
      } else {
        restoreCaret()
      }
    }
    let caretRestored = EditorPerformanceLog.now()
    if textView.contentOffset != offset {
      let maxOffset = max(0, textView.contentSize.height - textView.bounds.height + textView.contentInset.bottom)
      textView.setContentOffset(CGPoint(x: offset.x, y: min(max(0, offset.y), maxOffset)), animated: false)
    }
    let scrolled = EditorPerformanceLog.now()
    applyingInternally = wasApplying
    updateTypingAttributes()
    reportHeight()
    EditorPerformanceLog.rebuild(
      replace: replaced - started,
      caret: caretRestored - replaced,
      scroll: scrolled - caretRestored,
      typing: EditorPerformanceLog.now() - scrolled
    )
  }

  private func restoreCaret() {
    let index = AttributedBridge.utf16Index(selection: selection, linear: linear)
    let target = NSRange(location: min(index, textView.journaledStorage.length), length: 0)
    // Setting a selection makes TextKit lay out text up to the caret, which dominates a keystroke
    // in a long note. Skip it when the edit already left the caret in place.
    if textView.selectedRange != target {
      textView.selectedRange = target
    }
  }

  /// Typing attributes by block style. Building fonts and paragraph styles on every keystroke adds
  /// up; the cache is cleared when the text size setting changes.
  private var typingAttributesCache: [String: [NSAttributedString.Key: Any]] = [:]

  private func updateTypingAttributes() {
    guard let block = LinearModel.block(nodeId: selection.nodeId, in: linear) else { return }
    let key = "\(block.kind.rawValue)|\(block.headingLevel ?? 0)|\(block.checked ?? -1)|\(block.quoteDepth)|\(block.indent)"
    if let cached = typingAttributesCache[key] {
      textView.typingAttributes = cached
      return
    }
    let attributes = AttributedBridge.typingAttributes(for: block)
    typingAttributesCache[key] = attributes
    textView.typingAttributes = attributes
  }

  private func updatePlaceholder() {
    let empty = linear.blocks.count == 1
      && linear.blocks[0].kind == .paragraph
      && linear.blocks[0].quoteChain.isEmpty
      && linear.blocks[0].utf16Length == 0
    textView.setPlaceholderVisible(empty && textView.markedTextRange == nil, font: AttributedBridge.bodyFont())
  }

  private func scrollCaretIntoView() {
    guard textView.isFirstResponder, let range = textView.selectedTextRange else { return }
    let caret = textView.caretRect(for: range.end)
    guard !caret.isNull, !caret.isInfinite else { return }
    let visibleHeight = textView.bounds.height - textView.contentInset.bottom
    let top = textView.contentOffset.y
    let bottom = top + visibleHeight
    let margin: CGFloat = 24
    if caret.maxY + margin > bottom {
      textView.setContentOffset(CGPoint(x: 0, y: caret.maxY + margin - visibleHeight), animated: false)
    } else if caret.minY - margin < top {
      textView.setContentOffset(CGPoint(x: 0, y: max(0, caret.minY - margin)), animated: false)
    }
  }

  private func renderContext() -> EditorRenderContext {
    EditorRenderContext(
      imagePaths: imagePaths,
      attachmentsDirectory: attachmentsDirectory,
      containerWidth: editorContentWidth(),
      imageWidthOverrides: imageWidthOverrides
    )
  }

  private func attributedContent() -> NSAttributedString {
    AttributedBridge.attributedString(from: linear, context: renderContext())
  }

  private func applyMargins() {
    let horizontal = max(Self.horizontalMargin, floor((bounds.width - Self.readableWidth) / 2))
    let insets = UIEdgeInsets(top: 12, left: horizontal, bottom: 40, right: horizontal)
    if textView.textContainerInset != insets {
      textView.textContainerInset = insets
    }
  }

  private func editorContentWidth() -> CGFloat {
    max(textView.bounds.width - textView.textContainerInset.left - textView.textContainerInset.right, 0)
  }

  private func isAtomicCharacter(_ index: Int) -> Bool {
    guard index >= 0, index < textView.journaledStorage.length else { return false }
    let attachment = textView.journaledStorage.attribute(.attachment, at: index, effectiveRange: nil)
    return attachment is PlaceholderAttachment || attachment is HorizontalRuleAttachment || attachment is ImageBlockAttachment
  }

  private static let markdownLine = try? NSRegularExpression(pattern: "^\\s*(#{1,6}\\s|[-*+]\\s|\\d+[.)]\\s|>\\s?)")
  private static let markdownInline = try? NSRegularExpression(pattern: "(\\*\\*|__|~~|`|\\[[^\\]]+\\]\\([^)]+\\))")

  private static func looksLikeMarkdown(_ text: String) -> Bool {
    let range = NSRange(location: 0, length: (text as NSString).length)
    return markdownLine?.firstMatch(in: text, range: range) != nil
      || markdownInline?.firstMatch(in: text, range: range) != nil
  }

  private func emitSelection() {
    let block = LinearModel.block(nodeId: selection.nodeId, in: linear)
    var blockInfo: [String: Any] = [:]
    if let block {
      blockInfo["kind"] = block.kind.rawValue
      blockInfo["inQuote"] = !block.quoteChain.isEmpty
      if let level = block.headingLevel {
        blockInfo["headingLevel"] = level
      }
    }
    let active: [LinearMark]
    if let anchor {
      active = Self.markTypes.compactMap { type in
        LinearModel.rangeHasMark(type, from: selection, to: anchor, in: linear) ? LinearMark(type: type) : nil
      }
    } else {
      active = storedMarks
    }
    onSelectionChanged([
      "selection": selection.toAny(),
      "activeMarks": active.map { $0.toSchema().toAny() },
      "block": blockInfo,
      "collapsed": anchor == nil,
      "canUndo": undoStack.canUndo,
      "canRedo": undoStack.canRedo
    ])
  }

  private func emitError(code: String, context: String) {
    onRecoverableError([
      "code": code,
      "context": context
    ])
  }

  private var heightReportPending = false

  /// One report per run loop, from TextKit's content size. Laying out every line of a long note to
  /// measure it cost tens of milliseconds on each keystroke.
  private func reportHeight() {
    guard !heightReportPending else { return }
    heightReportPending = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.heightReportPending = false
      let height = max(ceil(self.textView.contentSize.height), AttributedBridge.bodyFont().lineHeight)
      if abs(height - self.lastHeight) < 0.5 {
        return
      }
      self.lastHeight = height
      self.onContentSizeChanged(["height": height])
    }
  }

  private func journalURL(documentId: String) -> URL {
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    let safe = documentId.replacingOccurrences(of: "/", with: "_")
    return root.appendingPathComponent("jot-editor-intake", isDirectory: true)
      .appendingPathComponent("\(safe).sqlite")
  }

  // MARK: Keyboard

  @objc private func keyboardWillChange(_ notification: Notification) {
    guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
      return
    }
    keyboardFrame = frame
    updateKeyboardInset()
    DispatchQueue.main.async { [weak self] in
      self?.scrollCaretIntoView()
    }
  }

  @objc private func keyboardWillHide(_ notification: Notification) {
    keyboardFrame = nil
    updateKeyboardInset()
  }

  @objc private func contentSizeCategoryChanged() {
    typingAttributesCache = [:]
    if hasCompletedLoad {
      rebuildText(preserveSelection: true)
    }
  }

  /// React Native may already have shrunk this view for the keyboard, so the inset is only the overlap that remains.
  private func updateKeyboardInset() {
    var overlap: CGFloat = 0
    if let frame = keyboardFrame, let window {
      let inWindow = window.convert(frame, from: nil)
      let inView = convert(inWindow, from: window)
      overlap = max(0, bounds.maxY - inView.minY)
    }
    if textView.contentInset.bottom != overlap {
      textView.contentInset.bottom = overlap
      textView.verticalScrollIndicatorInsets.bottom = overlap
    }
  }
}
