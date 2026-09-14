import UIKit

enum StorageAdmission {
  case closed
  case composing
  case allowed
  case `internal`
}

final class JournaledTextStorage: NSTextStorage {
  private let backing = NSMutableAttributedString()
  /// TextKit reads `string` many times per edit, and bridging the mutable backing string to Swift
  /// copies it each time. One copy per edit keeps long notes fast.
  private var cachedString: String?
  var admission: StorageAdmission = .closed

  override var string: String {
    if let cachedString {
      return cachedString
    }
    let value = backing.string
    cachedString = value
    return value
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
    cachedString = nil
    backing.replaceCharacters(in: range, with: str)
    edited(.editedCharacters, range: range, changeInLength: (str as NSString).length - range.length)
  }

  override func replaceCharacters(in range: NSRange, with attrString: NSAttributedString) {
    guard admitsMutation else { return }
    cachedString = nil
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
  func textViewDidTapImage(_ textView: JotTextView, attachment: ImageBlockAttachment)
  func textViewDidChangeContentSize(_ textView: JotTextView)
  func textViewDidChangeFocus(_ textView: JotTextView, focused: Bool)
  /// Returns true when the host consumed the paste.
  func textViewHandlePaste(_ textView: JotTextView) -> Bool
  func textViewDidPinchImage(_ textView: JotTextView, gesture: UIPinchGestureRecognizer)
  func textViewPerformCommand(_ textView: JotTextView, name: String)
}

final class JotTextView: UITextView, UITextViewDelegate, UIGestureRecognizerDelegate {
  let journaledStorage: JournaledTextStorage
  weak var host: JotTextViewHost?
  var composition = CompositionSession()
  private let placeholderLabel = UILabel()
  private var pinchRecognizer: UIPinchGestureRecognizer?

  var placeholder: String = "" {
    didSet {
      placeholderLabel.text = placeholder
    }
  }

  init() {
    // `init(usingTextLayoutManager:)` is a convenience initializer, so a subclass has to build the
    // TextKit 2 stack itself and hand the container to `init(frame:textContainer:)`.
    let storage = JournaledTextStorage()
    let contentStorage = NSTextContentStorage()
    let layoutManager = NSTextLayoutManager()
    let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
    container.widthTracksTextView = true
    container.lineFragmentPadding = 0
    layoutManager.textContainer = container
    contentStorage.addTextLayoutManager(layoutManager)
    contentStorage.textStorage = storage
    journaledStorage = storage
    super.init(frame: .zero, textContainer: container)
    delegate = self
    backgroundColor = .clear
    textColor = .label
    adjustsFontForContentSizeCategory = true
    // The React Native layout already keeps the editor clear of bars; the keyboard inset is set by the host.
    contentInsetAdjustmentBehavior = .never
    keyboardDismissMode = .interactive
    smartInsertDeleteType = .yes
    smartDashesType = .no
    smartQuotesType = .no
    allowsEditingTextAttributes = false
    isScrollEnabled = true
    alwaysBounceVertical = true
    textContainerInset = UIEdgeInsets(top: 12, left: 20, bottom: 40, right: 20)
    isAccessibilityElement = true
    accessibilityTraits.insert(.allowsDirectInteraction)
    accessibilityIdentifier = "jot.editor.surface"

    placeholderLabel.textColor = .placeholderText
    placeholderLabel.isUserInteractionEnabled = false
    placeholderLabel.isAccessibilityElement = false
    placeholderLabel.isHidden = true
    addSubview(placeholderLabel)

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    tap.delegate = self
    addGestureRecognizer(tap)
    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
    pinch.delegate = self
    addGestureRecognizer(pinch)
    pinchRecognizer = pinch
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let font = placeholderLabel.font ?? UIFont.preferredFont(forTextStyle: .body)
    placeholderLabel.frame = CGRect(
      x: textContainerInset.left,
      y: textContainerInset.top,
      width: max(0, bounds.width - textContainerInset.left - textContainerInset.right),
      height: ceil(font.lineHeight)
    )
  }

  func setPlaceholderVisible(_ visible: Bool, font: UIFont) {
    placeholderLabel.font = font
    placeholderLabel.isHidden = !visible || placeholder.isEmpty
    setNeedsLayout()
  }

  func replaceInternally(with attributed: NSAttributedString) {
    replaceInternally(range: NSRange(location: 0, length: journaledStorage.length), with: attributed)
  }

  func replaceInternally(range: NSRange, with attributed: NSAttributedString) {
    journaledStorage.admission = .internal
    journaledStorage.beginEditing()
    journaledStorage.replaceCharacters(in: range, with: attributed)
    journaledStorage.endEditing()
    journaledStorage.admission = .closed
  }

  /// A touch that starts on an image opens its size options, not the keyboard.
  private var touchBeganOnImage = false

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    if let point = touches.first?.location(in: self) {
      touchBeganOnImage = imageAttachment(at: point) != nil
    }
    super.touchesBegan(touches, with: event)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    touchBeganOnImage = false
    super.touchesCancelled(touches, with: event)
  }

  func textViewShouldBeginEditing(_ textView: UITextView) -> Bool {
    let allowed = !touchBeganOnImage
    touchBeganOnImage = false
    return allowed
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
      let range = markedRange() ?? selectedRange
      let existing = nsString.substring(with: NSIntersectionRange(range, NSRange(location: 0, length: nsString.length)))
      host?.textViewDidBeginComposition(self, range: range, text: existing)
    }
    placeholderLabel.isHidden = true
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
    if host?.textViewHandlePaste(self) == true {
      return
    }
    let text = UIPasteboard.general.string ?? ""
    _ = host?.textViewShouldCommit(self, range: selectedRange, replacement: text)
  }

  override func paste(itemProviders: [NSItemProvider]) {
    paste(nil)
  }

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(paste(_:)) {
      let pasteboard = UIPasteboard.general
      return pasteboard.hasStrings || pasteboard.hasImages || Self.pasteboardImageFileURL() != nil
    }
    if action == #selector(toggleBoldface(_:)) || action == #selector(toggleItalics(_:)) || action == #selector(toggleUnderline(_:)) {
      return isEditable
    }
    return super.canPerformAction(action, withSender: sender)
  }

  override func toggleBoldface(_ sender: Any?) {
    host?.textViewPerformCommand(self, name: "toggleBold")
  }

  override func toggleItalics(_ sender: Any?) {
    host?.textViewPerformCommand(self, name: "toggleItalic")
  }

  override func toggleUnderline(_ sender: Any?) {
    host?.textViewPerformCommand(self, name: "toggleUnderline")
  }

  override var keyCommands: [UIKeyCommand]? {
    let bindings: [(input: String, flags: UIKeyModifierFlags, name: String, title: String)] = [
      ("z", .command, "undo", "Undo"),
      ("z", [.command, .shift], "redo", "Redo"),
      ("b", .command, "toggleBold", "Bold"),
      ("i", .command, "toggleItalic", "Italic"),
      ("u", .command, "toggleUnderline", "Underline")
    ]
    return bindings.map { binding in
      let command = UIKeyCommand(
        title: binding.title,
        action: #selector(handleKeyCommand(_:)),
        input: binding.input,
        modifierFlags: binding.flags,
        propertyList: binding.name
      )
      command.wantsPriorityOverSystemBehavior = true
      return command
    }
  }

  @objc private func handleKeyCommand(_ command: UIKeyCommand) {
    guard let name = command.propertyList as? String else { return }
    host?.textViewPerformCommand(self, name: name)
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
    _ = host?.textViewShouldCommit(self, range: range, replacement: text)
    return false
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    host?.textViewDidChangeSelection(self)
  }

  func textViewDidChange(_ textView: UITextView) {
    host?.textViewDidChangeContentSize(self)
  }

  func textViewDidBeginEditing(_ textView: UITextView) {
    host?.textViewDidChangeFocus(self, focused: true)
  }

  func textViewDidEndEditing(_ textView: UITextView) {
    host?.textViewDidChangeFocus(self, focused: false)
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

  /// The image block under `point`, using the drawn rect rather than the nearest caret position.
  func imageAttachment(at point: CGPoint) -> ImageBlockAttachment? {
    guard let position = closestPosition(to: point) else { return nil }
    let index = offset(from: beginningOfDocument, to: position)
    for candidate in [index, index - 1] where candidate >= 0 && candidate < journaledStorage.length {
      guard let attachment = journaledStorage.attribute(.attachment, at: candidate, effectiveRange: nil) as? ImageBlockAttachment,
            let start = self.position(from: beginningOfDocument, offset: candidate),
            let end = self.position(from: start, offset: 1),
            let range = textRange(from: start, to: end) else {
        continue
      }
      let rect = firstRect(for: range)
      if !rect.isNull && rect.insetBy(dx: -6, dy: -6).contains(point) {
        return attachment
      }
    }
    return nil
  }

  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    let point = gesture.location(in: self)
    if let image = imageAttachment(at: point) {
      host?.textViewDidTapImage(self, attachment: image)
      return
    }
    guard let position = closestPosition(to: point), journaledStorage.length > 0 else { return }
    let index = offset(from: beginningOfDocument, to: position)
    let clamped = min(max(0, index), journaledStorage.length - 1)
    if let attachment = journaledStorage.attribute(.attachment, at: clamped, effectiveRange: nil) as? TaskCheckboxAttachment {
      host?.textViewDidTapTask(self, nodeId: attachment.nodeId)
    }
  }

  @objc private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
    host?.textViewDidPinchImage(self, gesture: gesture)
  }

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    if gestureRecognizer === pinchRecognizer {
      return gestureRecognizer.numberOfTouches >= 2 && imageAttachment(at: gestureRecognizer.location(in: self)) != nil
    }
    return super.gestureRecognizerShouldBegin(gestureRecognizer)
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    gestureRecognizer !== pinchRecognizer
  }
}
