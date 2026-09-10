import Foundation

enum JSONValue: Equatable {
  case null
  case bool(Bool)
  case int(Int)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  static func from(_ raw: Any) -> JSONValue {
    if raw is NSNull {
      return .null
    }
    if let number = raw as? NSNumber {
      if CFGetTypeID(number) == CFBooleanGetTypeID() {
        return .bool(number.boolValue)
      }
      return .int(number.intValue)
    }
    if let flag = raw as? Bool {
      return .bool(flag)
    }
    if let int = raw as? Int {
      return .int(int)
    }
    if let string = raw as? String {
      return .string(string)
    }
    if let items = raw as? [Any] {
      return .array(items.map { from($0) })
    }
    if let object = raw as? [String: Any] {
      var mapped: [String: JSONValue] = [:]
      for (key, value) in object {
        mapped[key] = from(value)
      }
      return .object(mapped)
    }
    return .null
  }

  func toAny() -> Any {
    switch self {
    case .null:
      return NSNull()
    case .bool(let flag):
      return flag
    case .int(let number):
      return number
    case .string(let text):
      return text
    case .array(let items):
      return items.map { $0.toAny() }
    case .object(let object):
      var mapped: [String: Any] = [:]
      for (key, value) in object {
        mapped[key] = value.toAny()
      }
      return mapped
    }
  }

  func objectValue() -> [String: JSONValue] {
    if case .object(let object) = self {
      return object
    }
    return [:]
  }

  func arrayValue() -> [JSONValue] {
    if case .array(let items) = self {
      return items
    }
    return []
  }

  func stringValue() -> String? {
    if case .string(let text) = self {
      return text
    }
    return nil
  }

  func intValue() -> Int? {
    if case .int(let number) = self {
      return number
    }
    return nil
  }
}

struct SchemaMark: Equatable {
  var type: String
  var attrs: [String: JSONValue]

  init(type: String, attrs: [String: JSONValue] = [:]) {
    self.type = type
    self.attrs = attrs
  }

  static func parse(_ value: JSONValue) -> SchemaMark {
    let object = value.objectValue()
    var attrs: [String: JSONValue] = [:]
    if let raw = object["attrs"] {
      attrs = raw.objectValue()
    }
    return SchemaMark(type: object["type"]?.stringValue() ?? "", attrs: attrs)
  }

  func toJSON() -> JSONValue {
    var object: [String: JSONValue] = ["type": .string(type)]
    if !attrs.isEmpty {
      object["attrs"] = .object(attrs)
    }
    return .object(object)
  }

  func toAny() -> [String: Any] {
    toJSON().toAny() as? [String: Any] ?? ["type": type]
  }
}

struct SchemaNode: Equatable {
  var type: String
  var id: String
  var attrs: [String: JSONValue]
  var content: [SchemaNode]
  var text: String?
  var marks: [SchemaMark]

  static let contentNone: Set<String> = [
    "horizontalRule", "fileAttachment", "mathBlock", "text", "hardBreak", "mathInline"
  ]

  static func parse(_ value: JSONValue) -> SchemaNode {
    let object = value.objectValue()
    let type = object["type"]?.stringValue() ?? "paragraph"
    let id = object["id"]?.stringValue() ?? JotIds.create()
    let attrs = object["attrs"]?.objectValue() ?? [:]
    let content = object["content"]?.arrayValue().map { SchemaNode.parse($0) } ?? []
    let text = object["text"]?.stringValue()
    let marks = object["marks"]?.arrayValue().map { SchemaMark.parse($0) } ?? []
    return SchemaNode(type: type, id: id, attrs: attrs, content: content, text: text, marks: marks)
  }

  static func parseDictionary(_ raw: [String: Any]) -> SchemaNode {
    parse(JSONValue.from(raw))
  }

  func toJSON() -> JSONValue {
    var object: [String: JSONValue] = [
      "id": .string(id),
      "type": .string(type)
    ]
    if !attrs.isEmpty || Self.hasAttrs(type) {
      object["attrs"] = .object(attrs)
    }
    if !Self.contentNone.contains(type) {
      object["content"] = .array(content.map { $0.toJSON() })
    }
    if type == "text" {
      object["text"] = .string(text ?? "")
      object["marks"] = .array(marks.map { $0.toJSON() })
    }
    return .object(object)
  }

  func toAny() -> [String: Any] {
    toJSON().toAny() as? [String: Any] ?? ["id": id, "type": type]
  }

  func plainText() -> String {
    if type == "text" {
      return text ?? ""
    }
    if type == "hardBreak" {
      return "\n"
    }
    if type == "mathInline" || type == "mathBlock" {
      if let latex = attrs["latex"]?.stringValue(), !latex.isEmpty {
        return latex
      }
      return attrs["alt"]?.stringValue() ?? ""
    }
    if type == "image" {
      let alt = attrs["alt"]?.stringValue() ?? ""
      let caption = content.map { $0.plainText() }.joined()
      return caption.isEmpty ? alt : caption
    }
    return content.map { $0.plainText() }.joined()
  }

  private static func hasAttrs(_ type: String) -> Bool {
    switch type {
    case "heading", "codeBlock", "orderedList", "taskItem", "tableCell",
         "image", "fileAttachment", "mathBlock", "mathInline":
      return true
    default:
      return false
    }
  }
}

struct SchemaSelection: Equatable {
  var nodeId: String
  var offsetUtf16: Int
  var affinity: String
  var revision: Int

  static func parse(_ raw: [String: Any]) -> SchemaSelection {
    SchemaSelection(
      nodeId: raw["nodeId"] as? String ?? "",
      offsetUtf16: intValue(raw["offsetUtf16"]),
      affinity: raw["affinity"] as? String ?? "before",
      revision: intValue(raw["revision"])
    )
  }

  static func parse(_ value: JSONValue) -> SchemaSelection {
    let object = value.objectValue()
    return SchemaSelection(
      nodeId: object["nodeId"]?.stringValue() ?? "",
      offsetUtf16: object["offsetUtf16"]?.intValue() ?? 0,
      affinity: object["affinity"]?.stringValue() ?? "before",
      revision: object["revision"]?.intValue() ?? 0
    )
  }

  func toAny() -> [String: Any] {
    [
      "nodeId": nodeId,
      "offsetUtf16": offsetUtf16,
      "affinity": affinity,
      "revision": revision
    ]
  }

  func toJSON() -> JSONValue {
    .object([
      "nodeId": .string(nodeId),
      "offsetUtf16": .int(offsetUtf16),
      "affinity": .string(affinity),
      "revision": .int(revision)
    ])
  }
}

enum SchemaOperation: Equatable {
  case insertText(position: SchemaSelection, text: String, storedMarks: [SchemaMark])
  case deleteRange(from: SchemaSelection, to: SchemaSelection, deletedSlice: [SchemaNode])
  case replaceRange(from: SchemaSelection, to: SchemaSelection, slice: [SchemaNode], deletedSlice: [SchemaNode])
  case addMark(from: SchemaSelection, to: SchemaSelection, mark: SchemaMark)
  case removeMark(from: SchemaSelection, to: SchemaSelection, markType: String)
  case setNodeAttributes(nodeId: String, patch: [String: JSONValue], priorValues: [String: JSONValue])
  case insertNode(parentId: String, index: Int, node: SchemaNode)
  case deleteNode(nodeId: String, deletedNode: SchemaNode)

  static func parseList(_ raw: [Any]) -> [SchemaOperation] {
    raw.compactMap { item in
      guard let object = item as? [String: Any] else { return nil }
      return parse(object)
    }
  }

  static func parse(_ raw: [String: Any]) -> SchemaOperation? {
    parse(JSONValue.from(raw))
  }

  static func parse(_ value: JSONValue) -> SchemaOperation? {
    let object = value.objectValue()
    let type = object["type"]?.stringValue() ?? ""
    switch type {
    case "insertText":
      return .insertText(
        position: SchemaSelection.parse(object["position"] ?? .null),
        text: object["text"]?.stringValue() ?? "",
        storedMarks: object["storedMarks"]?.arrayValue().map { SchemaMark.parse($0) } ?? []
      )
    case "deleteRange":
      return .deleteRange(
        from: SchemaSelection.parse(object["from"] ?? .null),
        to: SchemaSelection.parse(object["to"] ?? .null),
        deletedSlice: sliceNodes(object["deletedSlice"])
      )
    case "replaceRange":
      return .replaceRange(
        from: SchemaSelection.parse(object["from"] ?? .null),
        to: SchemaSelection.parse(object["to"] ?? .null),
        slice: sliceNodes(object["slice"]),
        deletedSlice: sliceNodes(object["deletedSlice"])
      )
    case "addMark":
      let range = object["range"]?.objectValue() ?? [:]
      return .addMark(
        from: SchemaSelection.parse(range["from"] ?? .null),
        to: SchemaSelection.parse(range["to"] ?? .null),
        mark: SchemaMark.parse(object["mark"] ?? .null)
      )
    case "removeMark":
      let range = object["range"]?.objectValue() ?? [:]
      return .removeMark(
        from: SchemaSelection.parse(range["from"] ?? .null),
        to: SchemaSelection.parse(range["to"] ?? .null),
        markType: object["markType"]?.stringValue() ?? ""
      )
    case "setNodeAttributes":
      return .setNodeAttributes(
        nodeId: object["nodeId"]?.stringValue() ?? "",
        patch: object["patch"]?.objectValue() ?? [:],
        priorValues: object["priorValues"]?.objectValue() ?? [:]
      )
    case "insertNode":
      return .insertNode(
        parentId: object["parentId"]?.stringValue() ?? "",
        index: object["index"]?.intValue() ?? 0,
        node: SchemaNode.parse(object["node"] ?? .null)
      )
    case "deleteNode":
      return .deleteNode(
        nodeId: object["nodeId"]?.stringValue() ?? "",
        deletedNode: SchemaNode.parse(object["deletedNode"] ?? .null)
      )
    default:
      return nil
    }
  }

  func toAny() -> [String: Any] {
    toJSON().toAny() as? [String: Any] ?? ["type": "insertText"]
  }

  func toJSON() -> JSONValue {
    switch self {
    case let .insertText(position, text, storedMarks):
      return .object([
        "type": .string("insertText"),
        "position": position.toJSON(),
        "text": .string(text),
        "storedMarks": .array(storedMarks.map { $0.toJSON() })
      ])
    case let .deleteRange(from, to, deletedSlice):
      return .object([
        "type": .string("deleteRange"),
        "from": from.toJSON(),
        "to": to.toJSON(),
        "deletedSlice": .object(["nodes": .array(deletedSlice.map { $0.toJSON() })])
      ])
    case let .replaceRange(from, to, slice, deletedSlice):
      return .object([
        "type": .string("replaceRange"),
        "from": from.toJSON(),
        "to": to.toJSON(),
        "slice": .object(["nodes": .array(slice.map { $0.toJSON() })]),
        "deletedSlice": .object(["nodes": .array(deletedSlice.map { $0.toJSON() })])
      ])
    case let .addMark(from, to, mark):
      return .object([
        "type": .string("addMark"),
        "range": .object(["from": from.toJSON(), "to": to.toJSON()]),
        "mark": mark.toJSON()
      ])
    case let .removeMark(from, to, markType):
      return .object([
        "type": .string("removeMark"),
        "range": .object(["from": from.toJSON(), "to": to.toJSON()]),
        "markType": .string(markType)
      ])
    case let .setNodeAttributes(nodeId, patch, priorValues):
      return .object([
        "type": .string("setNodeAttributes"),
        "nodeId": .string(nodeId),
        "patch": .object(patch),
        "priorValues": .object(priorValues)
      ])
    case let .insertNode(parentId, index, node):
      return .object([
        "type": .string("insertNode"),
        "parentId": .string(parentId),
        "index": .int(index),
        "node": node.toJSON()
      ])
    case let .deleteNode(nodeId, deletedNode):
      return .object([
        "type": .string("deleteNode"),
        "nodeId": .string(nodeId),
        "deletedNode": deletedNode.toJSON()
      ])
    }
  }

  func inverted() -> SchemaOperation {
    switch self {
    case let .insertText(position, text, _):
      let end = SchemaSelection(
        nodeId: position.nodeId,
        offsetUtf16: position.offsetUtf16 + Utf16.count(text),
        affinity: "after",
        revision: position.revision
      )
      return .deleteRange(from: position, to: end, deletedSlice: [])
    case let .deleteRange(from, _, deletedSlice):
      return .replaceRange(from: from, to: from, slice: deletedSlice, deletedSlice: [])
    case let .replaceRange(from, to, slice, deletedSlice):
      return .replaceRange(from: from, to: to, slice: deletedSlice, deletedSlice: slice)
    case let .addMark(from, to, mark):
      return .removeMark(from: from, to: to, markType: mark.type)
    case let .removeMark(from, to, markType):
      return .addMark(from: from, to: to, mark: SchemaMark(type: markType))
    case let .setNodeAttributes(nodeId, patch, priorValues):
      return .setNodeAttributes(nodeId: nodeId, patch: priorValues, priorValues: patch)
    case let .insertNode(_, _, node):
      return .deleteNode(nodeId: node.id, deletedNode: node)
    case let .deleteNode(_, deletedNode):
      return .insertNode(parentId: "", index: 0, node: deletedNode)
    }
  }

  private static func sliceNodes(_ value: JSONValue?) -> [SchemaNode] {
    guard let value else { return [] }
    let object = value.objectValue()
    if !object.isEmpty {
      return object["nodes"]?.arrayValue().map { SchemaNode.parse($0) } ?? []
    }
    return value.arrayValue().map { SchemaNode.parse($0) }
  }
}

enum CanonicalJSON {
  static func stringify(_ value: JSONValue) -> String {
    var bytes: [UInt8] = []
    emit(value, into: &bytes)
    return String(bytes: bytes, encoding: .utf8) ?? ""
  }

  private static func emit(_ value: JSONValue, into bytes: inout [UInt8]) {
    switch value {
    case .null:
      bytes.append(contentsOf: Array("null".utf8))
    case .bool(let flag):
      bytes.append(contentsOf: Array((flag ? "true" : "false").utf8))
    case .int(let number):
      bytes.append(contentsOf: Array(String(number).utf8))
    case .string(let text):
      emitString(text, into: &bytes)
    case .array(let items):
      bytes.append(0x5B)
      for (index, item) in items.enumerated() {
        if index > 0 {
          bytes.append(0x2C)
        }
        emit(item, into: &bytes)
      }
      bytes.append(0x5D)
    case .object(let object):
      bytes.append(0x7B)
      let keys = object.keys.sorted(by: utf8LessThan)
      for (index, key) in keys.enumerated() {
        if index > 0 {
          bytes.append(0x2C)
        }
        emitString(key, into: &bytes)
        bytes.append(0x3A)
        if let field = object[key] {
          emit(field, into: &bytes)
        } else {
          bytes.append(contentsOf: Array("null".utf8))
        }
      }
      bytes.append(0x7D)
    }
  }

  private static func emitString(_ text: String, into bytes: inout [UInt8]) {
    bytes.append(0x22)
    for scalar in text.unicodeScalars {
      switch scalar.value {
      case 0x22:
        bytes.append(contentsOf: Array("\\\"".utf8))
      case 0x5C:
        bytes.append(contentsOf: Array("\\\\".utf8))
      case 0x0A:
        bytes.append(contentsOf: Array("\\n".utf8))
      case 0x0D:
        bytes.append(contentsOf: Array("\\r".utf8))
      case 0x09:
        bytes.append(contentsOf: Array("\\t".utf8))
      case 0x08:
        bytes.append(contentsOf: Array("\\b".utf8))
      case 0x0C:
        bytes.append(contentsOf: Array("\\f".utf8))
      case 0..<0x20:
        let hex = String(format: "\\u%04x", scalar.value)
        bytes.append(contentsOf: Array(hex.utf8))
      default:
        bytes.append(contentsOf: Array(String(scalar).utf8))
      }
    }
    bytes.append(0x22)
  }

  private static func utf8LessThan(_ left: String, _ right: String) -> Bool {
    let a = Array(left.utf8)
    let b = Array(right.utf8)
    let count = min(a.count, b.count)
    for i in 0..<count {
      if a[i] != b[i] {
        return a[i] < b[i]
      }
    }
    return a.count < b.count
  }
}

func intValue(_ raw: Any?) -> Int {
  if let number = raw as? Int {
    return number
  }
  if let number = raw as? NSNumber {
    return number.intValue
  }
  if let string = raw as? String, let number = Int(string) {
    return number
  }
  return 0
}

enum JournalPayload {
  static func parse(_ json: String) -> (transactionId: String, operations: [SchemaOperation], baseRevision: Int)? {
    guard let data = json.data(using: .utf8),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return nil
    }
    let transactionId = raw["transactionId"] as? String ?? ""
    if transactionId.isEmpty {
      return nil
    }
    let rawOps = raw["operations"] as? [Any] ?? []
    let operations = SchemaOperation.parseList(rawOps)
    if !rawOps.isEmpty && operations.count != rawOps.count {
      return nil
    }
    return (transactionId, operations, intValue(raw["baseRevision"]))
  }
}
