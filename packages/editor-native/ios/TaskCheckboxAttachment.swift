import UIKit

final class TaskCheckboxAttachment: NSTextAttachment {
  var nodeId: String
  var checked: Int

  init(nodeId: String, checked: Int) {
    self.nodeId = nodeId
    self.checked = checked
    super.init(data: nil, ofType: "public.jot-task-checkbox")
    bounds = CGRect(x: 0, y: -4, width: 22, height: 22)
    image = Self.symbol(checked: checked)
  }

  required init?(coder: NSCoder) {
    nodeId = ""
    checked = 0
    super.init(coder: coder)
  }

  override func viewProvider(
    for parentView: UIView?,
    location: any NSTextLocation,
    textContainer: NSTextContainer?
  ) -> NSTextAttachmentViewProvider? {
    let provider = TaskCheckboxViewProvider(
      textAttachment: self,
      parentView: parentView,
      textLayoutManager: textContainer?.textLayoutManager,
      location: location
    )
    provider.tracksTextAttachmentViewBounds = true
    return provider
  }

  static func symbol(checked: Int) -> UIImage? {
    let name = checked == 1 ? "checkmark.square.fill" : "square"
    let config = UIImage.SymbolConfiguration(pointSize: 16, weight: .regular)
    return UIImage(systemName: name, withConfiguration: config)?.withTintColor(.label, renderingMode: .alwaysOriginal)
  }
}

final class TaskCheckboxViewProvider: NSTextAttachmentViewProvider {
  override func loadView() {
    let button = UIButton(type: .system)
    button.frame = CGRect(x: 0, y: 0, width: 28, height: 28)
    if let attachment = textAttachment as? TaskCheckboxAttachment {
      button.setImage(TaskCheckboxAttachment.symbol(checked: attachment.checked), for: .normal)
      button.accessibilityLabel = "Task"
      button.accessibilityValue = attachment.checked == 1 ? "checked" : "unchecked"
      var traits: UIAccessibilityTraits = [.button]
      if attachment.checked == 1 {
        traits.insert(.selected)
      }
      button.accessibilityTraits = traits
      button.accessibilityHint = "Toggle checklist item"
      button.tag = 0
    }
    view = button
  }
}

final class PlaceholderAttachment: NSTextAttachment {
  let fallback: String

  init(json: JSONValue, fallback: String) {
    self.fallback = fallback
    super.init(data: CanonicalJSON.stringify(json).data(using: .utf8), ofType: "public.jot-placeholder")
    bounds = CGRect(x: 0, y: -3, width: 12, height: 16)
    image = Self.image()
  }

  required init?(coder: NSCoder) {
    fallback = ""
    super.init(coder: coder)
  }

  override var accessibilityLabel: String? {
    get { fallback.isEmpty ? "Unsupported block" : fallback }
    set {}
  }

  override var accessibilityTraits: UIAccessibilityTraits {
    get { .staticText }
    set {}
  }

  private static func image() -> UIImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 12, height: 16))
    return renderer.image { context in
      UIColor.secondaryLabel.setFill()
      context.fill(CGRect(x: 2, y: 2, width: 8, height: 12))
    }
  }
}

final class QuoteHairlineAttachment: NSTextAttachment {
  let depth: Int

  init(depth: Int) {
    self.depth = depth
    super.init(data: nil, ofType: "public.jot-quote-hairline")
    bounds = CGRect(x: 0, y: -6, width: 8, height: 22)
    image = Self.image()
  }

  required init?(coder: NSCoder) {
    depth = 1
    super.init(coder: coder)
  }

  override var accessibilityLabel: String? {
    get { nil }
    set {}
  }

  private static func image() -> UIImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 22))
    return renderer.image { context in
      UIColor.separator.setFill()
      context.fill(CGRect(x: 1, y: 0, width: 2, height: 22))
    }
  }
}

final class HorizontalRuleAttachment: NSTextAttachment {
  init(width: CGFloat) {
    super.init(data: nil, ofType: "public.jot-horizontal-rule")
    let w = max(width, 40)
    bounds = CGRect(x: 0, y: -2, width: w, height: 12)
    image = Self.image(width: w)
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
  }

  override var accessibilityLabel: String? {
    get { "divider" }
    set {}
  }

  override var accessibilityTraits: UIAccessibilityTraits {
    get { .staticText }
    set {}
  }

  private static func image(width: CGFloat) -> UIImage {
    let size = CGSize(width: width, height: 12)
    let renderer = UIGraphicsImageRenderer(size: size)
    return renderer.image { context in
      UIColor.separator.setFill()
      context.fill(CGRect(x: 0, y: 5, width: width, height: 1))
    }
  }
}

final class ImageBlockAttachment: NSTextAttachment {
  let alt: String
  let path: String?

  init(alt: String, path: String?, widthBasisPoints: Int, containerWidth: CGFloat) {
    self.alt = alt
    self.path = path
    super.init(data: nil, ofType: "public.jot-image")
    let width = max(containerWidth, 40) * CGFloat(min(max(widthBasisPoints, 1), 10000)) / 10000
    if let path, let loaded = UIImage(contentsOfFile: path) {
      image = loaded
      let height = loaded.size.width > 0 ? loaded.size.height / loaded.size.width * width : 80
      bounds = CGRect(x: 0, y: 0, width: width, height: height)
    } else {
      image = Self.placeholder(width: width)
      bounds = CGRect(x: 0, y: 0, width: width, height: max(80, width * 0.4))
    }
  }

  required init?(coder: NSCoder) {
    alt = ""
    path = nil
    super.init(coder: coder)
  }

  override var accessibilityLabel: String? {
    get { alt.isEmpty ? "image" : alt }
    set {}
  }

  override var accessibilityTraits: UIAccessibilityTraits {
    get { .image }
    set {}
  }

  private static func placeholder(width: CGFloat) -> UIImage {
    let height = max(80, width * 0.4)
    let size = CGSize(width: width, height: height)
    let renderer = UIGraphicsImageRenderer(size: size)
    return renderer.image { context in
      UIColor.secondarySystemFill.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      let symbol = UIImage(systemName: "photo")?.withTintColor(.secondaryLabel, renderingMode: .alwaysOriginal)
      let symbolSize = CGSize(width: 28, height: 24)
      let origin = CGPoint(x: (width - symbolSize.width) / 2, y: (height - symbolSize.height) / 2)
      symbol?.draw(in: CGRect(origin: origin, size: symbolSize))
    }
  }
}
