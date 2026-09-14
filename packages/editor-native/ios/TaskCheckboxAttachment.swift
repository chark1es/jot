import ImageIO
import UIKit

enum EditorTheme {
  static var accent: UIColor = .systemBlue
}

extension UIColor {
  /// `#rrggbb` from React Native props. Anything else is nil.
  convenience init?(jotHex value: String?) {
    guard let value else { return nil }
    let hex = value.hasPrefix("#") ? String(value.dropFirst()) : value
    guard hex.count == 6, let number = UInt32(hex, radix: 16) else { return nil }
    self.init(
      red: CGFloat((number >> 16) & 0xff) / 255,
      green: CGFloat((number >> 8) & 0xff) / 255,
      blue: CGFloat(number & 0xff) / 255,
      alpha: 1
    )
  }
}

final class TaskCheckboxAttachment: NSTextAttachment {
  var nodeId: String
  var checked: Int

  init(nodeId: String, checked: Int) {
    self.nodeId = nodeId
    self.checked = checked
    super.init(data: nil, ofType: "public.jot-task-checkbox")
    bounds = CGRect(x: 0, y: -5, width: 22, height: 22)
    image = Self.symbol(checked: checked)
  }

  required init?(coder: NSCoder) {
    nodeId = ""
    checked = 0
    super.init(coder: coder)
  }

  override var accessibilityLabel: String? {
    get { checked == 1 ? "Completed task" : "Task" }
    set {}
  }

  static func symbol(checked: Int) -> UIImage? {
    let config = UIImage.SymbolConfiguration(pointSize: 19, weight: .regular)
    if checked == 1 {
      return UIImage(systemName: "checkmark.circle.fill", withConfiguration: config)?
        .withTintColor(EditorTheme.accent, renderingMode: .alwaysOriginal)
    }
    return UIImage(systemName: "circle", withConfiguration: config)?
      .withTintColor(.tertiaryLabel, renderingMode: .alwaysOriginal)
  }
}

/// A bullet or number drawn as the first character of a list item. TextKit draws
/// `NSTextList` markers only for paragraphs that contain text, so an empty item had none.
final class ListMarkerAttachment: NSTextAttachment {
  static let minimumWidth: CGFloat = 22
  static let gap: CGFloat = 6

  private static let cache: NSCache<NSString, UIImage> = {
    let cache = NSCache<NSString, UIImage>()
    cache.countLimit = 128
    return cache
  }()

  let label: String

  init(label: String, font: UIFont) {
    self.label = label
    super.init(data: nil, ofType: "public.jot-list-marker")
    let rendered = Self.image(label: label, font: font)
    image = rendered
    bounds = CGRect(x: 0, y: font.descender, width: rendered.size.width, height: rendered.size.height)
  }

  required init?(coder: NSCoder) {
    label = ""
    super.init(coder: coder)
  }

  override var accessibilityLabel: String? {
    get { nil }
    set {}
  }

  static func width(label: String, font: UIFont) -> CGFloat {
    let measured = ceil((label as NSString).size(withAttributes: [.font: font]).width)
    return max(minimumWidth, measured)
  }

  private static func image(label: String, font: UIFont) -> UIImage {
    let traits = UITraitCollection.current
    let key = "\(label)|\(font.fontName)|\(font.pointSize)|\(traits.userInterfaceStyle.rawValue)" as NSString
    if let hit = cache.object(forKey: key) {
      return hit
    }
    let size = CGSize(width: width(label: label, font: font), height: ceil(font.lineHeight))
    let rendered = UIGraphicsImageRenderer(size: size).image { _ in
      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .right
      (label as NSString).draw(
        in: CGRect(origin: .zero, size: size),
        withAttributes: [.font: font, .foregroundColor: UIColor.label, .paragraphStyle: paragraph]
      )
    }
    cache.setObject(rendered, forKey: key)
    return rendered
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
    bounds = CGRect(x: 0, y: -5, width: 3, height: 22)
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
    let size = CGSize(width: 3, height: 22)
    return UIGraphicsImageRenderer(size: size).image { _ in
      UIColor.tertiaryLabel.setFill()
      UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 1.5).fill()
    }
  }
}

final class HorizontalRuleAttachment: NSTextAttachment {
  init(width: CGFloat) {
    super.init(data: nil, ofType: "public.jot-horizontal-rule")
    let w = max(width, 40)
    bounds = CGRect(x: 0, y: -2, width: w, height: 14)
    image = Self.image(width: w)
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
  }

  override var accessibilityLabel: String? {
    get { "Divider" }
    set {}
  }

  override var accessibilityTraits: UIAccessibilityTraits {
    get { .staticText }
    set {}
  }

  private static func image(width: CGFloat) -> UIImage {
    let size = CGSize(width: width, height: 14)
    return UIGraphicsImageRenderer(size: size).image { context in
      UIColor.separator.setFill()
      context.fill(CGRect(x: 0, y: 7, width: width, height: 1 / max(UITraitCollection.current.displayScale, 1)))
    }
  }
}

final class ImageBlockAttachment: NSTextAttachment {
  static let cornerRadius: CGFloat = 10

  let nodeId: String
  let attachmentId: String
  let alt: String
  let widthBasisPoints: Int

  init(
    nodeId: String,
    attachmentId: String,
    alt: String,
    fileURL: URL?,
    widthBasisPoints: Int,
    containerWidth: CGFloat
  ) {
    self.nodeId = nodeId
    self.attachmentId = attachmentId
    self.alt = alt
    self.widthBasisPoints = min(max(widthBasisPoints, 1), 10000)
    super.init(data: nil, ofType: "public.jot-image")
    let width = floor(max(containerWidth, 40) * CGFloat(self.widthBasisPoints) / 10000)
    if let fileURL, let rendered = ImageRenderCache.image(fileURL: fileURL, width: width) {
      image = rendered
      bounds = CGRect(origin: .zero, size: rendered.size)
    } else {
      let size = CGSize(width: width, height: max(80, floor(width * 0.56)))
      image = Self.placeholder(size: size)
      bounds = CGRect(origin: .zero, size: size)
    }
  }

  required init?(coder: NSCoder) {
    nodeId = ""
    attachmentId = ""
    alt = ""
    widthBasisPoints = 10000
    super.init(coder: coder)
  }

  override var accessibilityLabel: String? {
    get { alt.isEmpty ? "Image" : alt }
    set {}
  }

  override var accessibilityTraits: UIAccessibilityTraits {
    get { .image }
    set {}
  }

  private static func placeholder(size: CGSize) -> UIImage {
    UIGraphicsImageRenderer(size: size).image { _ in
      UIColor.secondarySystemFill.setFill()
      UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: cornerRadius).fill()
      let config = UIImage.SymbolConfiguration(pointSize: 24, weight: .regular)
      if let symbol = UIImage(systemName: "photo", withConfiguration: config)?
        .withTintColor(.tertiaryLabel, renderingMode: .alwaysOriginal) {
        let origin = CGPoint(x: (size.width - symbol.size.width) / 2, y: (size.height - symbol.size.height) / 2)
        symbol.draw(at: origin)
      }
    }
  }
}

/// Decodes attachments at display size. A 12 MP photo decoded at full size costs about 48 MB,
/// so the editor never asks ImageIO for more pixels than the screen shows.
enum ImageRenderCache {
  private static let cache: NSCache<NSString, UIImage> = {
    let cache = NSCache<NSString, UIImage>()
    cache.countLimit = 64
    return cache
  }()

  static func image(fileURL: URL, width: CGFloat) -> UIImage? {
    guard width > 1 else { return nil }
    let key = "\(fileURL.path)|\(Int(width))" as NSString
    if let hit = cache.object(forKey: key) {
      return hit
    }
    guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let pixelWidth = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
          let pixelHeight = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue,
          pixelWidth > 0, pixelHeight > 0 else {
      return nil
    }
    let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
    // EXIF orientations 5 through 8 swap width and height.
    let aspect = orientation >= 5 ? pixelWidth / pixelHeight : pixelHeight / pixelWidth
    let size = CGSize(width: width, height: floor(width * CGFloat(aspect)))
    let scale = max(UITraitCollection.current.displayScale, 1)
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: max(size.width, size.height) * scale
    ]
    guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      return nil
    }
    let decoded = UIImage(cgImage: thumbnail)
    let format = UIGraphicsImageRendererFormat.preferred()
    format.scale = scale
    let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: ImageBlockAttachment.cornerRadius).addClip()
      decoded.draw(in: CGRect(origin: .zero, size: size))
    }
    cache.setObject(rendered, forKey: key)
    return rendered
  }
}
