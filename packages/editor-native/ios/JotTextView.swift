import UIKit

enum StorageAdmission {
  case closed
  case composing
  case allowed
  case `internal`
}

final class JournaledTextStorage: NSTextStorage {
  private let backing = NSMutableAttributedString()
  var admission: StorageAdmission = .closed

  override var string: String {
    backing.string
  }

  override func attributes(at location: Int, effectiveRange range: NSRangePointer?) -> [NSAttributedString.Key: Any] {
    guard backing.length > 0 else {
      range?.pointee = NSRange(location: 0, length: 0)
      return [:]
    }
    let index = min(max(0, location), max(0, backing.length - 1))
    return backing.attributes(at: index, effectiveRange: range)
  }

  override func replaceCharacters(in range: NSRange, with str: String) {
    guard admitsMutation else { return }
    backing.replaceCharacters(in: range, with: str)
    edited(.editedCharacters, range: range, changeInLength: (str as NSString).length - range.length)
  }

  override func replaceCharacters(in range: NSRange, with attrString: NSAttributedString) {
    guard admitsMutation else { return }
    backing.replaceCharacters(in: range, with: attrString)
    edited([.editedCharacters, .editedAttributes], range: range, changeInLength: attrString.length - range.length)
  }

  override func setAttributes(_ attrs: [NSAttributedString.Key: Any]?, range: NSRange) {
    backing.setAttributes(attrs, range: range)
    edited(.editedAttributes, range: range, changeInLength: 0)
  }

  private var admitsMutation: Bool {
    admission == .composing || admission == .allowed || admission == .internal
  }
}

protocol JotTextViewHost: AnyObject {
  func textViewShouldCommit(_ textView: JotTextView, range: NSRange, replacement: String) -> Bool
  func textViewDidBeginComposition(_ textView: JotTextView, range: NSRange, text: String)
  func textViewDidFinishComposition(_ textView: JotTextView, committed: String?, cancelled: Bool)
  func textViewDidChangeSelection(_ textView: JotTextView)
  func textViewDidTapTask(_ textView: JotTextView, nodeId: String)
  func textViewDidChangeContentSize(_ textView: JotTextView)
  func textViewDidPasteImageFile(_ textView: JotTextView, fileURL: URL)
}

final class JotTextView: UITextView, UITextViewDelegate, UIGestureRecognizerDelegate {
  let journaledStorage: JournaledTextStorage
  weak var host: JotTextViewHost?
  var composition = CompositionSession()

  init() {
    // `init(usingTextLayoutManager:)` is a convenience initializer, so a subclass has to build the
    // TextKit 2 stack itself and hand the container to `init(frame:textContainer:)`.
    let storage = JournaledTextStorage()
    let contentStorage = NSTextContentStorage()
    let layoutManager = NSTextLayoutManager()
    let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
    container.widthTracksTextView = true
    layoutManager.textContainer = container
    contentStorage.addTextLayoutManager(layoutManager)
    contentStorage.textStorage = storage
    journaledStorage = storage
    super.init(frame: .zero, textContainer: container)
    delegate = self
    backgroundColor = .systemBackground
    textColor = .label
    adjustsFontForContentSizeCategory = true
    contentInsetAdjustmentBehavior = .always
    keyboardDismissMode = .interactive
    smartInsertDeleteType = .yes
    smartDashesType = .no
    smartQuotesType = .no
    allowsEditingTextAttributes = true
    isScrollEnabled = true
    alwaysBounceVertical = true
    textContainerInset = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
    isAccessibilityElement = true
    accessibilityTraits.insert(.allowsDirectInteraction)
    accessibilityIdentifier = "jot.editor.surface"
    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    tap.delegate = self
    addGestureRecognizer(tap)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func replaceInternally(with attributed: NSAttributedString) {
    journaledStorage.admission = .internal
    let full = NSRange(location: 0, length: journaledStorage.length)
    journaledStorage.beginEditing()
    journaledStorage.replaceCharacters(in: full, with: attributed)
    journaledStorage.endEditing()
    journaledStorage.admission = .closed
  }

  func replaceCharactersInternally(in range: NSRange, with attributed: NSAttributedString) {
    journaledStorage.admission = .internal
    journaledStorage.beginEditing()
    journaledStorage.replaceCharacters(in: range, with: attributed)
    journaledStorage.endEditing()
    journaledStorage.admission = .closed
    selectedRange = NSRange(location: range.location + attributed.length, length: 0)
  }

  override func setMarkedText(_ markedText: String?, selectedRange: NSRange) {
    if markedText == nil && composition.active {
      journaledStorage.admission = .composing
      super.setMarkedText(markedText, selectedRange: selectedRange)
      journaledStorage.admission = .closed
      host?.textViewDidFinishComposition(self, committed: nil, cancelled: true)
      return
    }
    if !composition.active {
      let range = markedRange() ?? selectedRangeInStorage()
      let existing = nsString.substring(with: NSIntersectionRange(range, NSRange(location: 0, length: nsString.length)))
      host?.textViewDidBeginComposition(self, range: range, text: existing)
    }
    journaledStorage.admission = .composing
    super.setMarkedText(markedText, selectedRange: selectedRange)
  }

  override func unmarkText() {
    var committed: String?
    if let marked = markedTextRange {
      committed = text(in: marked)
    }
    journaledStorage.admission = .composing
    super.unmarkText()
    journaledStorage.admission = .closed
    host?.textViewDidFinishComposition(self, committed: committed, cancelled: false)
  }

  override func paste(_ sender: Any?) {
    if let url = Self.pasteboardImageFileURL() {
      host?.textViewDidPasteImageFile(self, fileURL: url)
      return
    }
    let text = UIPasteboard.general.string ?? ""
    _ = host?.textViewShouldCommit(self, range: selectedRange, replacement: text)
  }

  override func paste(itemProviders: [NSItemProvider]) {
    if let url = Self.pasteboardImageFileURL() {
      host?.textViewDidPasteImageFile(self, fileURL: url)
      return
    }
    let text = UIPasteboard.general.string ?? ""
    _ = host?.textViewShouldCommit(self, range: selectedRange, replacement: text)
  }

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(paste(_:)) {
      return UIPasteboard.general.hasStrings || Self.pasteboardImageFileURL() != nil
    }
    return super.canPerformAction(action, withSender: sender)
  }

  static func pasteboardImageFileURL() -> URL? {
    let candidates: [URL] = (UIPasteboard.general.urls ?? []) + [UIPasteboard.general.url].compactMap { $0 }
    for url in candidates where url.isFileURL && isImageFileURL(url) {
      return url
    }
    return nil
  }

  private static func isImageFileURL(_ url: URL) -> Bool {
    let ext = url.pathExtension.lowercased()
    return ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp"].contains(ext)
  }

  func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
    if journaledStorage.admission == .internal {
      return true
    }
    if markedTextRange != nil {
      journaledStorage.admission = .composing
      return true
    }
    if composition.active {
      return false
    }
    journaledStorage.admission = .closed
    host?.textViewShouldCommit(self, range: range, replacement: text)
    return false
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    host?.textViewDidChangeSelection(self)
  }

  func textViewDidChange(_ textView: UITextView) {
    host?.textViewDidChangeContentSize(self)
  }

  func selectedRangeInStorage() -> NSRange {
    selectedRange
  }

  func markedRange() -> NSRange? {
    guard let marked = markedTextRange else { return nil }
    let location = offset(from: beginningOfDocument, to: marked.start)
    let length = offset(from: marked.start, to: marked.end)
    return NSRange(location: location, length: length)
  }

  var nsString: NSString {
    (text as NSString?) ?? ""
  }

  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    let point = gesture.location(in: self)
    guard let position = closestPosition(to: point) else { return }
    let index = offset(from: beginningOfDocument, to: position)
    guard journaledStorage.length > 0 else { return }
    let clamped = min(max(0, index), journaledStorage.length - 1)
    let attrs = journaledStorage.attributes(at: clamped, effectiveRange: nil)
    if let attachment = attrs[.attachment] as? TaskCheckboxAttachment {
      host?.textViewDidTapTask(self, nodeId: attachment.nodeId)
    }
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    true
  }
}
