import UIKit

extension NSAttributedString.Key {
  static let jotNodeId = NSAttributedString.Key("jot.nodeId")
  static let jotKind = NSAttributedString.Key("jot.kind")
  static let jotIndent = NSAttributedString.Key("jot.indent")
  static let jotHeadingLevel = NSAttributedString.Key("jot.headingLevel")
  static let jotChecked = NSAttributedString.Key("jot.checked")
  static let jotListStart = NSAttributedString.Key("jot.listStart")
  static let jotLanguageId = NSAttributedString.Key("jot.languageId")
  static let jotParagraphId = NSAttributedString.Key("jot.paragraphId")
  static let jotListId = NSAttributedString.Key("jot.listId")
  static let jotTextId = NSAttributedString.Key("jot.textId")
  static let jotBold = NSAttributedString.Key("jot.bold")
  static let jotItalic = NSAttributedString.Key("jot.italic")
  static let jotPlaceholder = NSAttributedString.Key("jot.placeholder")
  static let jotLeadingAttach = NSAttributedString.Key("jot.leadingAttach")
  static let jotUnderline = NSAttributedString.Key("jot.underline")
  static let jotStrikethrough = NSAttributedString.Key("jot.strikethrough")
  static let jotInlineCode = NSAttributedString.Key("jot.inlineCode")
  static let jotHref = NSAttributedString.Key("jot.href")
  static let jotLinkTitle = NSAttributedString.Key("jot.linkTitle")
  static let jotQuoteDepth = NSAttributedString.Key("jot.quoteDepth")
}

/// Everything besides the document that decides how it is drawn.
struct EditorRenderContext {
  var imagePaths: [String: String] = [:]
  var attachmentsDirectory: URL?
  var containerWidth: CGFloat = 0
  /// Widths shown while a pinch is still in progress, keyed by image node id.
  var imageWidthOverrides: [String: Int] = [:]

  func imageURL(attachmentId: String) -> URL? {
    if let path = imagePaths[attachmentId] {
      return URL(fileURLWithPath: path)
    }
    guard !attachmentId.isEmpty, let directory = attachmentsDirectory else {
      return nil
    }
    let url = directory.appendingPathComponent(attachmentId)
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
  }
}

enum AttributedBridge {
  static let indentStep: CGFloat = 24

  /// Storage layout: every block is followed by a newline unless it is the last block, and
  /// that newline carries the attributes of the block before it. A paragraph's style comes
  /// from the characters it owns, so empty blocks stay styled as themselves.
  static func attributedString(from linear: LinearDocument, context: EditorRenderContext) -> NSAttributedString {
    attributedBlocks(linear, range: 0..<linear.blocks.count, leadingSeparator: false, context: context)
  }

  /// Blocks `range` of `linear`, each followed by its newline when another block comes after
  /// it. `leadingSeparator` adds the newline that belongs to the block before `range`.
  static func attributedBlocks(
    _ linear: LinearDocument,
    range: Range<Int>,
    leadingSeparator: Bool,
    context: EditorRenderContext
  ) -> NSAttributedString {
    var context = context
    if context.containerWidth <= 1 {
      context.containerWidth = max(UIScreen.main.bounds.width - 40, 280)
    }
    let numbers = listMarkers(linear.blocks)
    let labels = listAccessibilityLabels(linear.blocks)
    let result = NSMutableAttributedString()
    let count = linear.blocks.count
    if leadingSeparator, range.lowerBound > 0 {
      let previous = range.lowerBound - 1
      result.append(
        NSAttributedString(
          string: "\n",
          attributes: paragraphAttributes(linear.blocks[previous], marker: numbers[previous], listLabel: labels[previous])
        )
      )
    }
    for index in range {
      let block = linear.blocks[index]
      let base = paragraphAttributes(block, marker: numbers[index], listLabel: labels[index])
      result.append(blockString(block, base: base, marker: numbers[index], context: context))
      if index + 1 < count {
        result.append(NSAttributedString(string: "\n", attributes: base))
      }
    }
    return result
  }

  /// Font, color, and paragraph style for an empty block, so the caret has the right height.
  static func typingAttributes(for block: LinearBlock) -> [NSAttributedString.Key: Any] {
    let attrs = paragraphAttributes(block, marker: nil, listLabel: nil)
    var typing: [NSAttributedString.Key: Any] = [:]
    for key in [NSAttributedString.Key.font, .foregroundColor, .paragraphStyle] {
      typing[key] = attrs[key]
    }
    return typing
  }

  static func bodyFont() -> UIFont {
    font(block: LinearBlock(id: "", kind: .paragraph, indent: 0, runs: []), bold: false, italic: false, inlineCode: false)
  }

  static func schemaLocation(
    utf16Index: Int,
    affinity: String,
    attributed: NSAttributedString,
    linear: LinearDocument,
    revision: Int
  ) -> SchemaSelection {
    EditPlanner.location(displayIndex: utf16Index, affinity: affinity, linear: linear, revision: revision)
  }

  static func utf16Index(selection: SchemaSelection, linear: LinearDocument) -> Int {
    EditPlanner.displayIndex(selection: selection, linear: linear)
  }

  /// The marker text for every bullet and numbered item, keyed by block index. Numbers count
  /// the items of one list at one depth, starting from the list's start attribute.
  static func listMarkers(_ blocks: [LinearBlock]) -> [Int: String] {
    var counters: [String: Int] = [:]
    var markers: [Int: String] = [:]
    let bullets = ["•", "◦", "▪"]
    for (index, block) in blocks.enumerated() {
      switch block.kind {
      case .bulletItem:
        markers[index] = bullets[block.indent % bullets.count]
      case .orderedItem:
        let key = "\(block.listId ?? "")|\(block.indent)"
        let next = (counters[key] ?? (max(1, block.listStart ?? 1) - 1)) + 1
        counters[key] = next
        markers[index] = "\(next)."
      default:
        break
      }
    }
    return markers
  }

  private static func listAccessibilityLabels(_ blocks: [LinearBlock]) -> [Int: String] {
    var groups: [String: [Int]] = [:]
    for (index, block) in blocks.enumerated() where LinearModel.isListKind(block.kind) {
      groups["\(block.kind.rawValue)|\(block.listId ?? "")|\(block.indent)", default: []].append(index)
    }
    var labels: [Int: String] = [:]
    for members in groups.values {
      for (position, index) in members.enumerated() {
        labels[index] = "list, \(position + 1) of \(members.count)"
      }
    }
    return labels
  }

  private static func attachmentString(_ attachment: NSTextAttachment, attributes: [NSAttributedString.Key: Any]) -> NSAttributedString {
    let string = NSMutableAttributedString(attachment: attachment)
    string.addAttributes(attributes, range: NSRange(location: 0, length: string.length))
    return string
  }

  private static func blockString(
    _ block: LinearBlock,
    base: [NSAttributedString.Key: Any],
    marker: String?,
    context: EditorRenderContext
  ) -> NSAttributedString {
    let result = NSMutableAttributedString()
    if !block.quoteChain.isEmpty {
      var attrs = base
      attrs[.kern] = 10
      result.append(attachmentString(QuoteHairlineAttachment(depth: block.quoteDepth), attributes: attrs))
    }
    if block.kind == .taskItem {
      var attrs = base
      attrs[.kern] = 8
      result.append(attachmentString(TaskCheckboxAttachment(nodeId: block.id, checked: block.checked ?? 0), attributes: attrs))
    } else if block.kind == .bulletItem || block.kind == .orderedItem {
      var attrs = base
      attrs[.kern] = ListMarkerAttachment.gap
      result.append(attachmentString(ListMarkerAttachment(label: marker ?? "•", font: bodyFont()), attributes: attrs))
    }
    switch block.kind {
    case .horizontalRule:
      result.append(attachmentString(HorizontalRuleAttachment(width: context.containerWidth), attributes: base))
      return result
    case .image:
      let node = block.placeholderJSON.map { SchemaNode.parse($0) }
      let attachmentId = node?.attrs["attachmentId"]?.stringValue() ?? ""
      let stored = node?.attrs["widthBasisPoints"]?.intValue() ?? 10000
      let attachment = ImageBlockAttachment(
        nodeId: block.id,
        attachmentId: attachmentId,
        alt: node?.attrs["alt"]?.stringValue() ?? block.plainText,
        fileURL: context.imageURL(attachmentId: attachmentId),
        widthBasisPoints: context.imageWidthOverrides[block.id] ?? stored,
        containerWidth: context.containerWidth
      )
      result.append(attachmentString(attachment, attributes: base))
      return result
    case .placeholder:
      if let json = block.placeholderJSON {
        result.append(attachmentString(PlaceholderAttachment(json: json, fallback: block.plainText), attributes: base))
        return result
      }
    default:
      break
    }
    let checked = block.kind == .taskItem && block.checked == 1
    for run in block.runs {
      if let json = run.placeholderJSON {
        result.append(attachmentString(PlaceholderAttachment(json: json, fallback: run.fallbackText), attributes: base))
        continue
      }
      var attrs = base
      attrs[.jotTextId] = run.id ?? ""
      let bold = run.marks.contains(where: \.isBold)
      let italic = run.marks.contains(where: \.isItalic)
      let underline = run.marks.contains(where: \.isUnderline)
      let strike = run.marks.contains(where: \.isStrikethrough)
      let inlineCode = run.marks.contains(where: \.isInlineCode)
      attrs[.jotBold] = bold ? 1 : 0
      attrs[.jotItalic] = italic ? 1 : 0
      attrs[.jotUnderline] = underline ? 1 : 0
      attrs[.jotStrikethrough] = strike ? 1 : 0
      attrs[.jotInlineCode] = inlineCode ? 1 : 0
      attrs[.font] = font(block: block, bold: bold, italic: italic, inlineCode: inlineCode)
      if underline {
        attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
      }
      if strike || checked {
        attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
      }
      if inlineCode && block.kind != .codeBlock {
        attrs[.backgroundColor] = UIColor.tertiarySystemFill
      }
      if let link = run.marks.first(where: \.isLink), let href = link.href, !href.isEmpty {
        attrs[.jotHref] = href
        attrs[.jotLinkTitle] = link.title
        attrs[.foregroundColor] = EditorTheme.accent
        attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
        if let url = URL(string: href) {
          attrs[.link] = url
        }
      }
      result.append(NSAttributedString(string: run.text, attributes: attrs))
    }
    return result
  }

  private static func textColor(for block: LinearBlock) -> UIColor {
    if block.kind == .taskItem && block.checked == 1 {
      return .secondaryLabel
    }
    if !block.quoteChain.isEmpty {
      return .secondaryLabel
    }
    return .label
  }

  private static func paragraphStyle(_ block: LinearBlock, marker: String?) -> NSParagraphStyle {
    let style = NSMutableParagraphStyle()
    let indent = CGFloat(block.indent) * indentStep
    style.lineSpacing = 3
    style.paragraphSpacing = 10
    style.headIndent = indent
    style.firstLineHeadIndent = indent
    switch block.kind {
    case .bulletItem, .orderedItem:
      // Wrapped lines line up with the text after the marker.
      let markerWidth = ListMarkerAttachment.width(label: marker ?? "•", font: bodyFont())
      style.headIndent = indent + markerWidth + ListMarkerAttachment.gap
      style.paragraphSpacing = 4
    case .taskItem:
      style.headIndent = indent + 30
      style.paragraphSpacing = 6
    case .codeBlock:
      style.lineSpacing = 2
      style.paragraphSpacing = 0
      style.headIndent = indent + 8
      style.firstLineHeadIndent = indent + 8
    case .heading:
      style.paragraphSpacingBefore = (block.headingLevel ?? 1) <= 2 ? 12 : 8
      style.paragraphSpacing = 6
    case .image:
      style.alignment = .center
      style.paragraphSpacingBefore = 6
      style.paragraphSpacing = 14
    case .horizontalRule:
      style.paragraphSpacingBefore = 4
      style.paragraphSpacing = 12
    case .paragraph, .placeholder:
      break
    }
    if !block.quoteChain.isEmpty {
      // The hairline attachment sits in the first line; wrapped lines align with the quoted text.
      style.headIndent += 13
    }
    return style
  }

  private static func paragraphAttributes(
    _ block: LinearBlock,
    marker: String?,
    listLabel: String?
  ) -> [NSAttributedString.Key: Any] {
    var attrs: [NSAttributedString.Key: Any] = [
      .paragraphStyle: paragraphStyle(block, marker: marker),
      .jotNodeId: block.id,
      .jotKind: block.kind.rawValue,
      .jotIndent: block.indent,
      .foregroundColor: textColor(for: block),
      .font: font(block: block, bold: false, italic: false, inlineCode: false)
    ]
    var spoken: [String] = []
    if let level = block.headingLevel {
      attrs[.jotHeadingLevel] = level
      attrs[.accessibilityTextHeadingLevel] = level
      spoken.append("Heading level \(level)")
    }
    if let listLabel {
      spoken.append(listLabel)
    }
    if !block.quoteChain.isEmpty {
      attrs[.jotQuoteDepth] = block.quoteDepth
    }
    if !spoken.isEmpty {
      attrs[.accessibilityTextCustom] = spoken
    }
    if let checked = block.checked {
      attrs[.jotChecked] = checked
    }
    if let start = block.listStart {
      attrs[.jotListStart] = start
    }
    if let languageId = block.languageId {
      attrs[.jotLanguageId] = languageId
    }
    if let paragraphId = block.paragraphId {
      attrs[.jotParagraphId] = paragraphId
    }
    if let listId = block.listId {
      attrs[.jotListId] = listId
    }
    let leading = LinearModel.leadingCount(block)
    if leading > 0 {
      attrs[.jotLeadingAttach] = leading
    }
    if block.kind == .codeBlock {
      attrs[.backgroundColor] = UIColor.tertiarySystemFill
    }
    if let json = block.placeholderJSON {
      attrs[.jotPlaceholder] = CanonicalJSON.stringify(json)
    }
    return attrs
  }

  private static func font(block: LinearBlock, bold: Bool, italic: Bool, inlineCode: Bool) -> UIFont {
    if block.kind == .codeBlock || inlineCode {
      let size: CGFloat = block.kind == .codeBlock ? 15 : 15.5
      var font = UIFont.monospacedSystemFont(ofSize: size, weight: bold ? .semibold : .regular)
      if italic, let descriptor = font.fontDescriptor.withSymbolicTraits(.traitItalic) {
        font = UIFont(descriptor: descriptor, size: size)
      }
      return UIFontMetrics(forTextStyle: .body).scaledFont(for: font)
    }
    var size: CGFloat = 17
    var weight: UIFont.Weight = .regular
    var textStyle: UIFont.TextStyle = .body
    if block.kind == .heading {
      switch block.headingLevel ?? 1 {
      case 1:
        size = 28
        weight = .bold
        textStyle = .title1
      case 2:
        size = 22
        weight = .bold
        textStyle = .title2
      case 3:
        size = 20
        weight = .semibold
        textStyle = .title3
      case 4, 5:
        size = 17
        weight = .semibold
        textStyle = .headline
      default:
        size = 15
        weight = .semibold
        textStyle = .subheadline
      }
    }
    var font = UIFont.systemFont(ofSize: size, weight: weight)
    if let serif = font.fontDescriptor.withDesign(.serif) {
      font = UIFont(descriptor: serif, size: size)
    }
    var traits = font.fontDescriptor.symbolicTraits
    var changed = false
    if bold && block.kind != .heading {
      traits.insert(.traitBold)
      changed = true
    }
    if italic {
      traits.insert(.traitItalic)
      changed = true
    }
    if changed, let descriptor = font.fontDescriptor.withSymbolicTraits(traits) {
      font = UIFont(descriptor: descriptor, size: size)
    }
    return UIFontMetrics(forTextStyle: textStyle).scaledFont(for: font)
  }
}
