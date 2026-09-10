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

enum AttributedBridge {
  static let indentStep: CGFloat = 24

  static func attributedString(
    from linear: LinearDocument,
    imagePaths: [String: String] = [:],
    containerWidth: CGFloat = 0
  ) -> NSAttributedString {
    let width = containerWidth > 1 ? containerWidth : max(UIScreen.main.bounds.width - 32, 280)
    let result = NSMutableAttributedString()
    for (index, block) in linear.blocks.enumerated() {
      let listLabel = listAccessibilityLabel(at: index, in: linear.blocks)
      if index > 0 {
        result.append(NSAttributedString(string: "\n", attributes: paragraphAttributes(block, listLabel: listLabel)))
      }
      result.append(
        blockString(block, listLabel: listLabel, imagePaths: imagePaths, containerWidth: width)
      )
    }
    return result
  }

  static func linearDocument(from attributed: NSAttributedString, documentId: String) -> LinearDocument {
    if attributed.length == 0 {
      return LinearDocument(id: documentId, blocks: [])
    }
    let string = attributed.string as NSString
    var blocks: [LinearBlock] = []
    string.enumerateSubstrings(in: NSRange(location: 0, length: string.length), options: .byParagraphs) { _, range, _, _ in
      let attrs = range.length > 0
        ? attributed.attributes(at: range.location, effectiveRange: nil)
        : [:]
      var block = blockMetadata(attrs)
      if block.id.isEmpty {
        block.id = JotIds.create()
      }
      var runs: [LinearRun] = []
      var cursor = range.location
      let end = range.location + range.length
      let leading = attrs[.jotLeadingAttach] as? Int ?? 0
      if leading > 0, cursor < end {
        cursor += min(leading, end - cursor)
      }
      while cursor < end {
        var effective = NSRange()
        let runAttrs = attributed.attributes(at: cursor, effectiveRange: &effective)
        let clip = NSIntersectionRange(effective, NSRange(location: cursor, length: end - cursor))
        if clip.length == 0 {
          break
        }
        if let placeholder = runAttrs[.jotPlaceholder] as? String,
           let data = placeholder.data(using: .utf8),
           let raw = try? JSONSerialization.jsonObject(with: data),
           let object = raw as? [String: Any] {
          let node = SchemaNode.parseDictionary(object)
          runs.append(
            LinearRun(
              text: LinearModel.objectReplacement,
              id: node.id,
              placeholderJSON: node.toJSON(),
              fallbackText: node.plainText()
            )
          )
        } else if let attachment = runAttrs[.attachment] as? TaskCheckboxAttachment {
          block.checked = attachment.checked
          block.id = attachment.nodeId
        } else if let _ = runAttrs[.attachment] as? HorizontalRuleAttachment {
          runs.append(LinearRun(text: LinearModel.objectReplacement, fallbackText: "divider"))
        } else if let image = runAttrs[.attachment] as? ImageBlockAttachment {
          runs.append(LinearRun(text: LinearModel.objectReplacement, fallbackText: image.alt))
        } else if runAttrs[.attachment] != nil {
          cursor = clip.location + clip.length
          continue
        } else {
          let text = string.substring(with: clip)
          var marks: [LinearMark] = []
          if runAttrs[.jotBold] as? Int == 1 {
            marks.append(LinearMark(type: "bold"))
          }
          if runAttrs[.jotItalic] as? Int == 1 {
            marks.append(LinearMark(type: "italic"))
          }
          if runAttrs[.jotUnderline] as? Int == 1 {
            marks.append(LinearMark(type: "underline"))
          }
          if runAttrs[.jotStrikethrough] as? Int == 1 {
            marks.append(LinearMark(type: "strikethrough"))
          }
          if runAttrs[.jotInlineCode] as? Int == 1 {
            marks.append(LinearMark(type: "inlineCode"))
          }
          if let href = runAttrs[.jotHref] as? String, !href.isEmpty {
            let title = runAttrs[.jotLinkTitle] as? String ?? ""
            marks.append(
              LinearMark(type: "link", attrs: ["href": .string(href), "title": .string(title)])
            )
          } else if let url = runAttrs[.link] as? URL {
            marks.append(
              LinearMark(type: "link", attrs: ["href": .string(url.absoluteString), "title": .string("")])
            )
          }
          runs.append(
            LinearRun(
              text: text,
              marks: marks,
              id: runAttrs[.jotTextId] as? String
            )
          )
        }
        cursor = clip.location + clip.length
      }
      if block.kind == .codeBlock, let last = blocks.last, last.id == block.id, last.kind == .codeBlock {
        var merged = last
        merged.runs.append(LinearRun(text: "\n"))
        merged.runs.append(contentsOf: runs)
        blocks[blocks.count - 1] = merged
      } else {
        block.runs = runs
        blocks.append(block)
      }
    }
    return LinearDocument(id: documentId, blocks: blocks)
  }

  static func schemaLocation(
    utf16Index: Int,
    affinity: String,
    attributed: NSAttributedString,
    linear: LinearDocument,
    revision: Int
  ) -> SchemaSelection {
    if linear.blocks.isEmpty {
      return SchemaSelection(nodeId: linear.id, offsetUtf16: 0, affinity: affinity, revision: revision)
    }
    var cursor = 0
    for (index, block) in linear.blocks.enumerated() {
      let leading = LinearModel.leadingCount(block)
      let contentStart = cursor + leading
      let contentEnd = contentStart + block.utf16Length
      let separator = index < linear.blocks.count - 1 ? 1 : 0
      if utf16Index < contentStart {
        return SchemaSelection(nodeId: block.id, offsetUtf16: 0, affinity: affinity, revision: revision)
      }
      if utf16Index <= contentEnd {
        return SchemaSelection(
          nodeId: block.id,
          offsetUtf16: utf16Index - contentStart,
          affinity: affinity,
          revision: revision
        )
      }
      if utf16Index == contentEnd + separator && separator == 1 {
        if affinity == "before" {
          return SchemaSelection(nodeId: block.id, offsetUtf16: block.utf16Length, affinity: "before", revision: revision)
        }
      }
      cursor = contentEnd + separator
      _ = attributed
    }
    if let last = linear.blocks.last {
      return SchemaSelection(nodeId: last.id, offsetUtf16: last.utf16Length, affinity: affinity, revision: revision)
    }
    return SchemaSelection(nodeId: linear.id, offsetUtf16: 0, affinity: affinity, revision: revision)
  }

  static func utf16Index(selection: SchemaSelection, linear: LinearDocument) -> Int {
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

  static func usedHeight(of textView: UITextView) -> CGFloat {
    let width = max(textView.bounds.width - textView.textContainerInset.left - textView.textContainerInset.right, 1)
    if let layoutManager = textView.textLayoutManager {
      var maxY: CGFloat = 0
      layoutManager.enumerateTextLayoutFragments(
        from: layoutManager.documentRange.location,
        options: [.ensuresLayout]
      ) { fragment in
        maxY = max(maxY, fragment.layoutFragmentFrame.maxY)
        return true
      }
      let insets = textView.textContainerInset.top + textView.textContainerInset.bottom
      return max(ceil(maxY + insets), textView.font?.lineHeight ?? 22)
    }
    let size = textView.sizeThatFits(CGSize(width: width, height: CGFloat.greatestFiniteMagnitude))
    return max(size.height, textView.font?.lineHeight ?? 22)
  }

  private static func listAccessibilityLabel(at index: Int, in blocks: [LinearBlock]) -> String? {
    let block = blocks[index]
    guard LinearModel.isListKind(block.kind) else { return nil }
    var positions: [Int] = []
    for (i, candidate) in blocks.enumerated() {
      if candidate.kind == block.kind && candidate.listId == block.listId && candidate.indent == block.indent {
        positions.append(i)
      }
    }
    guard let item = positions.firstIndex(of: index) else {
      return "list"
    }
    return "list, \(item + 1) of \(positions.count)"
  }

  private static func blockString(
    _ block: LinearBlock,
    listLabel: String?,
    imagePaths: [String: String],
    containerWidth: CGFloat
  ) -> NSAttributedString {
    let result = NSMutableAttributedString()
    let base = paragraphAttributes(block, listLabel: listLabel)
    if !block.quoteChain.isEmpty {
      result.append(NSAttributedString(attachment: QuoteHairlineAttachment(depth: block.quoteDepth)))
    }
    if block.kind == .taskItem {
      let attachment = TaskCheckboxAttachment(nodeId: block.id, checked: block.checked ?? 0)
      result.append(NSAttributedString(attachment: attachment))
    }
    if block.kind == .horizontalRule {
      result.append(
        NSAttributedString(attachment: HorizontalRuleAttachment(width: containerWidth))
      )
      return result
    }
    if block.kind == .image {
      let node = block.placeholderJSON.map { SchemaNode.parse($0) }
      let attachmentId = node?.attrs["attachmentId"]?.stringValue() ?? ""
      let alt = node?.attrs["alt"]?.stringValue() ?? block.plainText
      let bps = node?.attrs["widthBasisPoints"]?.intValue() ?? 10000
      result.append(
        NSAttributedString(
          attachment: ImageBlockAttachment(
            alt: alt,
            path: imagePaths[attachmentId],
            widthBasisPoints: bps,
            containerWidth: containerWidth
          )
        )
      )
      return result
    }
    if block.kind == .placeholder, let json = block.placeholderJSON {
      let attachment = PlaceholderAttachment(json: json, fallback: block.plainText)
      result.append(NSAttributedString(attachment: attachment))
      return result
    }
    for run in block.runs {
      if let json = run.placeholderJSON {
        let attachment = PlaceholderAttachment(json: json, fallback: run.fallbackText)
        result.append(NSAttributedString(attachment: attachment))
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
      if strike {
        attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
      }
      if let link = run.marks.first(where: \.isLink), let href = link.href, !href.isEmpty {
        attrs[.jotHref] = href
        attrs[.jotLinkTitle] = link.title
        attrs[.foregroundColor] = UIColor.link
        attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
        if let url = URL(string: href) {
          attrs[.link] = url
        }
      }
      result.append(NSAttributedString(string: run.text, attributes: attrs))
    }
    if result.length == 0 {
      result.append(NSAttributedString(string: "", attributes: base))
    }
    return result
  }

  private static func paragraphAttributes(_ block: LinearBlock, listLabel: String? = nil) -> [NSAttributedString.Key: Any] {
    let style = NSMutableParagraphStyle()
    let indent = CGFloat(block.indent) * indentStep + CGFloat(block.quoteDepth) * indentStep
    switch block.kind {
    case .bulletItem, .orderedItem:
      style.headIndent = indent + indentStep
      style.firstLineHeadIndent = indent + indentStep
      let marker: NSTextList.MarkerFormat = block.kind == .orderedItem ? .decimal : .disc
      style.textLists = [NSTextList(markerFormat: marker, options: 0)]
    case .taskItem:
      style.headIndent = indent + indentStep + 8
      style.firstLineHeadIndent = indent
    case .codeBlock:
      style.headIndent = indent
      style.firstLineHeadIndent = indent
    case .heading:
      style.paragraphSpacingBefore = 16
      style.paragraphSpacing = 8
    default:
      style.paragraphSpacing = 8
      style.headIndent = indent
      style.firstLineHeadIndent = indent
    }
    var attrs: [NSAttributedString.Key: Any] = [
      .paragraphStyle: style,
      .jotNodeId: block.id,
      .jotKind: block.kind.rawValue,
      .jotIndent: block.indent,
      .foregroundColor: UIColor.label,
      .font: font(block: block, bold: block.kind == .heading, italic: false, inlineCode: false)
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
    if block.kind == .taskItem {
      attrs[.jotLeadingAttach] = LinearModel.leadingCount(block)
    } else if !block.quoteChain.isEmpty {
      attrs[.jotLeadingAttach] = LinearModel.leadingCount(block)
    }
    if let json = block.placeholderJSON, let encoded = CanonicalJSON.stringify(json).data(using: .utf8) {
      attrs[.jotPlaceholder] = String(data: encoded, encoding: .utf8) ?? ""
    }
    return attrs
  }

  private static func blockMetadata(_ attrs: [NSAttributedString.Key: Any]) -> LinearBlock {
    let kind = LinearBlockKind(rawValue: attrs[.jotKind] as? String ?? "paragraph") ?? .paragraph
    return LinearBlock(
      id: attrs[.jotNodeId] as? String ?? "",
      kind: kind,
      headingLevel: attrs[.jotHeadingLevel] as? Int,
      listStart: attrs[.jotListStart] as? Int,
      checked: attrs[.jotChecked] as? Int,
      indent: attrs[.jotIndent] as? Int ?? 0,
      runs: [],
      languageId: attrs[.jotLanguageId] as? String,
      paragraphId: attrs[.jotParagraphId] as? String,
      listId: attrs[.jotListId] as? String
    )
  }

  private static func font(block: LinearBlock, bold: Bool, italic: Bool, inlineCode: Bool) -> UIFont {
    if block.kind == .codeBlock || inlineCode {
      let size: CGFloat
      if block.kind == .heading {
        switch block.headingLevel ?? 1 {
        case 1: size = 34
        case 2: size = 28
        case 3: size = 22
        case 4: size = 20
        case 5: size = 18
        default: size = 16
        }
      } else {
        size = block.kind == .codeBlock ? 15 : 17
      }
      let weight: UIFont.Weight = bold ? .semibold : .regular
      var font = UIFont.monospacedSystemFont(ofSize: size, weight: weight)
      if italic, let descriptor = font.fontDescriptor.withSymbolicTraits(.traitItalic) {
        font = UIFont(descriptor: descriptor, size: size)
      }
      return font
    }
    let size: CGFloat
    var weight: UIFont.Weight = bold ? .semibold : .regular
    var textStyle: UIFont.TextStyle = .body
    if block.kind == .heading {
      switch block.headingLevel ?? 1 {
      case 1:
        size = 34
        textStyle = .title1
        weight = .bold
      case 2:
        size = 28
        textStyle = .title2
        weight = .bold
      case 3:
        size = 22
        textStyle = .title3
        weight = .semibold
      case 4:
        size = 20
        textStyle = .headline
        weight = .semibold
      case 5:
        size = 18
        textStyle = .headline
        weight = .semibold
      default:
        size = 16
        textStyle = .subheadline
        weight = .semibold
      }
    } else {
      size = 17
    }
    var descriptor = UIFontDescriptor.preferredFontDescriptor(withTextStyle: textStyle)
    if block.kind != .codeBlock, let serif = descriptor.withDesign(.serif) {
      descriptor = serif
    }
    var traits = descriptor.symbolicTraits
    if bold || block.kind == .heading {
      traits.insert(.traitBold)
    }
    if italic {
      traits.insert(.traitItalic)
    }
    if let withTraits = descriptor.withSymbolicTraits(traits) {
      descriptor = withTraits
    }
    _ = weight
    return UIFont(descriptor: descriptor, size: size)
  }
}
