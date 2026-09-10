import Foundation

enum LinearModelTests {
  static func runAll() throws {
    try roundTripParagraphBold()
    try roundTripHeadings()
    try roundTripListsAndTasks()
    try roundTripCodeBlock()
    try placeholderKeepsText()
    try utf16EmojiOffset()
    try insertTextApplies()
    try unappliedPayloadApply()
    try listSplitJoin()
    try inputRuleHeading1()
    try inputRuleBullet()
    try inputRuleQuote()
    try roundTripUnderlineMark()
    try roundTripBlockquote()
    try roundTripHorizontalRule()
    try toggleUnderlineAddsMark()
    try insertHorizontalRuleCommand()
    try toggleBlockquoteCommand()
    try compositionSessionNoOps()
  }

  static func roundTripParagraphBold() throws {
    let json = """
    {"content":[{"content":[{"id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","marks":[{"type":"bold"}],"text":"Hello","type":"text"}],"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}
    """
    try assertCanonicalRoundTrip(json)
  }

  static func roundTripHeadings() throws {
    let json = """
    {"content":[{"attrs":{"level":1},"content":[{"id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"one","type":"text"}],"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"heading"},{"attrs":{"level":6},"content":[{"id":"bqaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"six","type":"text"}],"id":"bmaaaaaaaaaaaaaaaaaaaaaaaa","type":"heading"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}
    """
    try assertCanonicalRoundTrip(json)
  }

  static func roundTripListsAndTasks() throws {
    let json = """
    {"content":[{"content":[{"content":[{"content":[{"id":"aqaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"one","type":"text"}],"id":"amaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","type":"listItem"},{"content":[{"content":[{"id":"a4aaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"two","type":"text"}],"id":"ayaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"},{"content":[{"content":[{"content":[{"id":"bmaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"nested","type":"text"}],"id":"biaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"beaaaaaaaaaaaaaaaaaaaaaaaa","type":"listItem"}],"id":"baaaaaaaaaaaaaaaaaaaaaaaaa","type":"bulletList"}],"id":"auaaaaaaaaaaaaaaaaaaaaaaaa","type":"listItem"}],"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"bulletList"},{"attrs":{"start":2},"content":[{"content":[{"content":[{"id":"b4aaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"second","type":"text"}],"id":"byaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"buaaaaaaaaaaaaaaaaaaaaaaaa","type":"listItem"}],"id":"bqaaaaaaaaaaaaaaaaaaaaaaaa","type":"orderedList"},{"content":[{"attrs":{"checked":0},"content":[{"content":[{"id":"cmaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"todo","type":"text"}],"id":"ciaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"ceaaaaaaaaaaaaaaaaaaaaaaaa","type":"taskItem"},{"attrs":{"checked":1},"content":[{"content":[{"id":"cyaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"done","type":"text"}],"id":"cuaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"cqaaaaaaaaaaaaaaaaaaaaaaaa","type":"taskItem"}],"id":"caaaaaaaaaaaaaaaaaaaaaaaaa","type":"taskList"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}
    """
    try assertCanonicalRoundTrip(json)
  }

  static func roundTripCodeBlock() throws {
    let raw: [String: Any] = [
      "type": "doc",
      "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content": [
        [
          "type": "codeBlock",
          "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "attrs": ["languageId": "swift"],
          "content": [
            [
              "type": "text",
              "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa",
              "text": "let x = 1",
              "marks": []
            ]
          ]
        ]
      ]
    ]
    let node = SchemaNode.parseDictionary(raw)
    let linear = LinearModel.documentToLinear(node)
    guard linear.blocks.count == 1, linear.blocks[0].kind == .codeBlock else {
      throw TestError.failed("codeBlock kind")
    }
    if linear.blocks[0].languageId != "swift" {
      throw TestError.failed("languageId stored")
    }
    let back = LinearModel.linearToDocument(linear)
    let expected = CanonicalJSON.stringify(node.toJSON())
    let actual = CanonicalJSON.stringify(back.toJSON())
    if expected != actual {
      throw TestError.failed("codeBlock canonical mismatch")
    }
  }

  static func placeholderKeepsText() throws {
    let raw: [String: Any] = [
      "type": "doc",
      "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content": [
        [
          "type": "mathBlock",
          "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "attrs": ["latex": "x^2", "alt": "x squared"]
        ],
        [
          "type": "paragraph",
          "id": "amaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            ["type": "text", "id": "aqaaaaaaaaaaaaaaaaaaaaaaaa", "text": "after", "marks": []]
          ]
        ]
      ]
    ]
    let node = SchemaNode.parseDictionary(raw)
    let linear = LinearModel.documentToLinear(node)
    guard linear.blocks.first?.kind == .placeholder else {
      throw TestError.failed("placeholder kind")
    }
    let fallback = linear.blocks[0].plainText
    if !fallback.contains("x") {
      throw TestError.failed("placeholder dropped text")
    }
    let back = LinearModel.linearToDocument(linear)
    if back.content.first?.type != "mathBlock" {
      throw TestError.failed("placeholder not restored")
    }
    if back.content[1].plainText() != "after" {
      throw TestError.failed("following paragraph dropped")
    }
  }

  static func utf16EmojiOffset() throws {
    let text = "😀!"
    if Utf16.count(text) != 3 {
      throw TestError.failed("emoji utf16")
    }
    if Utf16.slice(text, offset: 2, length: 1) != "!" {
      throw TestError.failed("emoji slice")
    }
    if Utf16.hasUnpairedSurrogates(text) {
      throw TestError.failed("paired emoji treated as unpaired")
    }
  }

  static func insertTextApplies() throws {
    let raw: [String: Any] = [
      "type": "doc",
      "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content": [
        [
          "type": "paragraph",
          "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            ["type": "text", "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa", "text": "Hi", "marks": []]
          ]
        ]
      ]
    ]
    var linear = LinearModel.documentToLinear(SchemaNode.parseDictionary(raw))
    try LinearModel.apply(
      [
        .insertText(
          position: SchemaSelection(
            nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
            offsetUtf16: 2,
            affinity: "after",
            revision: 0
          ),
          text: "!",
          storedMarks: []
        )
      ],
      to: &linear
    )
    if linear.blocks[0].plainText != "Hi!" {
      throw TestError.failed("insertText")
    }
  }

  static func unappliedPayloadApply() throws {
    var linear = LinearModel.documentToLinear(
      SchemaNode.parseDictionary(
        [
          "type": "doc",
          "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            [
              "type": "paragraph",
              "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
              "content": [
                ["type": "text", "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa", "text": "Hi", "marks": []]
              ]
            ]
          ]
        ]
      )
    )
    let operation = SchemaOperation.insertText(
      position: SchemaSelection(
        nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 2,
        affinity: "after",
        revision: 0
      ),
      text: "!",
      storedMarks: []
    )
    let payload = CanonicalJSON.stringify(
      .object([
        "transactionId": .string("t1"),
        "baseRevision": .int(0),
        "operations": .array([operation.toJSON()]),
        "selection": SchemaSelection(
          nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          offsetUtf16: 2,
          affinity: "after",
          revision: 0
        ).toJSON()
      ])
    )
    guard let parsed = JournalPayload.parse(payload) else {
      throw TestError.failed("payload parse")
    }
    if parsed.transactionId != "t1" {
      throw TestError.failed("payload id")
    }
    try LinearModel.apply(parsed.operations, to: &linear)
    if linear.blocks[0].plainText != "Hi!" {
      throw TestError.failed("unapplied replay")
    }
  }

  static func listSplitJoin() throws {
    var linear = LinearModel.documentToLinear(
      SchemaNode.parseDictionary(
        [
          "type": "doc",
          "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            [
              "type": "bulletList",
              "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
              "content": [
                [
                  "type": "listItem",
                  "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa",
                  "content": [
                    [
                      "type": "paragraph",
                      "id": "amaaaaaaaaaaaaaaaaaaaaaaaa",
                      "content": [
                        [
                          "type": "text",
                          "id": "aqaaaaaaaaaaaaaaaaaaaaaaaa",
                          "text": "hello world",
                          "marks": []
                        ]
                      ]
                    ]
                  ]
                ]
              ]
            ]
          ]
        ]
      )
    )
    let split = LinearCommands.split(
      at: SchemaSelection(
        nodeId: "amaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 6,
        affinity: "before",
        revision: 0
      ),
      linear: linear,
      storedMarks: []
    )
    if split.operations.isEmpty {
      throw TestError.failed("list split produced no ops")
    }
    try LinearModel.apply(split.operations, to: &linear)
    if linear.blocks.count != 2 {
      throw TestError.failed("list split count")
    }
    if linear.blocks[0].plainText != "hello " {
      throw TestError.failed("list split head")
    }
    if linear.blocks[1].plainText != "world" {
      throw TestError.failed("list split tail")
    }
    let join = LinearCommands.join(
      at: SchemaSelection(
        nodeId: linear.blocks[1].paragraphId ?? linear.blocks[1].id,
        offsetUtf16: 0,
        affinity: "before",
        revision: 0
      ),
      linear: linear,
      storedMarks: []
    )
    try LinearModel.apply(join.operations, to: &linear)
    if linear.blocks.count != 1 {
      throw TestError.failed("list join count")
    }
    if linear.blocks[0].plainText != "hello world" {
      throw TestError.failed("list join text")
    }
  }

  static func inputRuleHeading1() throws {
    var linear = LinearModel.documentToLinear(
      SchemaNode.parseDictionary(
        [
          "type": "doc",
          "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            [
              "type": "paragraph",
              "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
              "content": [
                ["type": "text", "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa", "text": "#", "marks": []]
              ]
            ]
          ]
        ]
      )
    )
    guard let plan = LinearCommands.inputRule(
      terminator: " ",
      linear: linear,
      selection: SchemaSelection(
        nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 1,
        affinity: "after",
        revision: 0
      ),
      storedMarks: []
    ) else {
      throw TestError.failed("heading-1 rule miss")
    }
    if !plan.isInputRule {
      throw TestError.failed("heading-1 not marked as input rule")
    }
    try LinearModel.apply(plan.operations, to: &linear)
    guard linear.blocks.count == 1, linear.blocks[0].kind == .heading, linear.blocks[0].headingLevel == 1 else {
      throw TestError.failed("heading-1 kind")
    }
    if !linear.blocks[0].plainText.isEmpty {
      throw TestError.failed("heading-1 trigger not consumed")
    }
  }

  static func inputRuleBullet() throws {
    var linear = LinearModel.documentToLinear(
      SchemaNode.parseDictionary(
        [
          "type": "doc",
          "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            [
              "type": "paragraph",
              "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
              "content": [
                ["type": "text", "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa", "text": "-", "marks": []]
              ]
            ]
          ]
        ]
      )
    )
    guard let plan = LinearCommands.inputRule(
      terminator: " ",
      linear: linear,
      selection: SchemaSelection(
        nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 1,
        affinity: "after",
        revision: 0
      ),
      storedMarks: []
    ) else {
      throw TestError.failed("bullet rule miss")
    }
    try LinearModel.apply(plan.operations, to: &linear)
    guard linear.blocks.count == 1, linear.blocks[0].kind == .bulletItem else {
      throw TestError.failed("bullet kind")
    }
    if !linear.blocks[0].plainText.isEmpty {
      throw TestError.failed("bullet trigger not consumed")
    }
  }

  static func inputRuleQuote() throws {
    var linear = LinearModel.documentToLinear(
      SchemaNode.parseDictionary(
        [
          "type": "doc",
          "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            [
              "type": "paragraph",
              "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
              "content": [
                ["type": "text", "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa", "text": ">", "marks": []]
              ]
            ]
          ]
        ]
      )
    )
    guard let plan = LinearCommands.inputRule(
      terminator: " ",
      linear: linear,
      selection: SchemaSelection(
        nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 1,
        affinity: "after",
        revision: 0
      ),
      storedMarks: []
    ) else {
      throw TestError.failed("quote rule miss")
    }
    try LinearModel.apply(plan.operations, to: &linear)
    let tree = LinearModel.linearToDocument(linear)
    guard tree.content.count == 1, tree.content[0].type == "blockquote" else {
      throw TestError.failed("quote wrap")
    }
    guard linear.blocks.count == 1, linear.blocks[0].kind == .paragraph else {
      throw TestError.failed("quote inner paragraph")
    }
    if linear.blocks[0].quoteChain.isEmpty {
      throw TestError.failed("quote chain")
    }
    if !linear.blocks[0].plainText.isEmpty {
      throw TestError.failed("quote trigger not consumed")
    }
  }

  static func roundTripUnderlineMark() throws {
    let json = """
    {"content":[{"content":[{"id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","marks":[{"type":"underline"}],"text":"Hi","type":"text"}],"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}
    """
    try assertCanonicalRoundTrip(json)
  }

  static func roundTripBlockquote() throws {
    let json = """
    {"content":[{"content":[{"content":[{"id":"aqaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"quoted","type":"text"}],"id":"amaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"blockquote"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}
    """
    try assertCanonicalRoundTrip(json)
    let node = SchemaNode.parseDictionary(
      [
        "type": "doc",
        "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        "content": [
          [
            "type": "blockquote",
            "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
            "content": [
              [
                "type": "paragraph",
                "id": "amaaaaaaaaaaaaaaaaaaaaaaaa",
                "content": [
                  [
                    "type": "text",
                    "id": "aqaaaaaaaaaaaaaaaaaaaaaaaa",
                    "text": "quoted",
                    "marks": []
                  ]
                ]
              ]
            ]
          ]
        ]
      ]
    )
    let linear = LinearModel.documentToLinear(node)
    guard linear.blocks.count == 1, linear.blocks[0].kind == .paragraph else {
      throw TestError.failed("blockquote linear kind")
    }
    if linear.blocks[0].quoteChain != ["aeaaaaaaaaaaaaaaaaaaaaaaaa"] {
      throw TestError.failed("blockquote quote id")
    }
  }

  static func roundTripHorizontalRule() throws {
    let json = """
    {"content":[{"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"horizontalRule"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}
    """
    try assertCanonicalRoundTrip(json)
    let node = SchemaNode.parseDictionary(
      [
        "type": "doc",
        "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        "content": [
          ["type": "horizontalRule", "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa"]
        ]
      ]
    )
    let linear = LinearModel.documentToLinear(node)
    guard linear.blocks.count == 1, linear.blocks[0].kind == .horizontalRule else {
      throw TestError.failed("hr kind")
    }
  }

  static func toggleUnderlineAddsMark() throws {
    var linear = LinearModel.documentToLinear(
      SchemaNode.parseDictionary(
        [
          "type": "doc",
          "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            [
              "type": "paragraph",
              "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
              "content": [
                ["type": "text", "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa", "text": "Hi", "marks": []]
              ]
            ]
          ]
        ]
      )
    )
    let plan = LinearCommands.commandPlan(
      name: "toggleUnderline",
      value: nil,
      linear: linear,
      selection: SchemaSelection(
        nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 0,
        affinity: "before",
        revision: 0
      ),
      selectionEnd: SchemaSelection(
        nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 2,
        affinity: "after",
        revision: 0
      ),
      storedMarks: []
    )
    if plan.operations.isEmpty {
      throw TestError.failed("underline ops")
    }
    try LinearModel.apply(plan.operations, to: &linear)
    let marks = linear.blocks[0].runs.flatMap(\.marks)
    guard marks.contains(where: { $0.type == "underline" }) else {
      throw TestError.failed("underline mark missing")
    }
  }

  static func insertHorizontalRuleCommand() throws {
    var linear = LinearModel.documentToLinear(
      SchemaNode.parseDictionary(
        [
          "type": "doc",
          "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            [
              "type": "paragraph",
              "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
              "content": [
                ["type": "text", "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa", "text": "Hi", "marks": []]
              ]
            ]
          ]
        ]
      )
    )
    let plan = LinearCommands.commandPlan(
      name: "insertHorizontalRule",
      value: nil,
      linear: linear,
      selection: SchemaSelection(
        nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 2,
        affinity: "after",
        revision: 0
      ),
      selectionEnd: nil,
      storedMarks: []
    )
    if plan.operations.isEmpty {
      throw TestError.failed("hr insert ops")
    }
    try LinearModel.apply(plan.operations, to: &linear)
    guard linear.blocks.count == 2, linear.blocks[1].kind == .horizontalRule else {
      throw TestError.failed("hr insert kind")
    }
    let tree = LinearModel.linearToDocument(linear)
    guard tree.content.count == 2, tree.content[1].type == "horizontalRule" else {
      throw TestError.failed("hr insert schema")
    }
  }

  static func toggleBlockquoteCommand() throws {
    var linear = LinearModel.documentToLinear(
      SchemaNode.parseDictionary(
        [
          "type": "doc",
          "id": "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          "content": [
            [
              "type": "paragraph",
              "id": "aeaaaaaaaaaaaaaaaaaaaaaaaa",
              "content": [
                ["type": "text", "id": "aiaaaaaaaaaaaaaaaaaaaaaaaa", "text": "Hi", "marks": []]
              ]
            ]
          ]
        ]
      )
    )
    let plan = LinearCommands.commandPlan(
      name: "toggleBlockquote",
      value: nil,
      linear: linear,
      selection: SchemaSelection(
        nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 0,
        affinity: "before",
        revision: 0
      ),
      selectionEnd: nil,
      storedMarks: []
    )
    try LinearModel.apply(plan.operations, to: &linear)
    let tree = LinearModel.linearToDocument(linear)
    guard tree.content.count == 1, tree.content[0].type == "blockquote" else {
      throw TestError.failed("toggle quote wrap")
    }
    let unwrap = LinearCommands.commandPlan(
      name: "toggleBlockquote",
      value: nil,
      linear: linear,
      selection: SchemaSelection(
        nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        offsetUtf16: 0,
        affinity: "before",
        revision: 0
      ),
      selectionEnd: nil,
      storedMarks: []
    )
    try LinearModel.apply(unwrap.operations, to: &linear)
    let unwrapped = LinearModel.linearToDocument(linear)
    guard unwrapped.content.count == 1, unwrapped.content[0].type == "paragraph" else {
      throw TestError.failed("toggle quote unwrap")
    }
  }

  static func compositionSessionNoOps() throws {
    var session = CompositionSession()
    session.begin(
      range: NSRange(location: 0, length: 0),
      text: "",
      nodeId: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
      offsetUtf16: 0,
      affinity: "before"
    )
    if !session.active {
      throw TestError.failed("composition begin")
    }
    session.end()
    if session.active {
      throw TestError.failed("composition end")
    }
    if !session.originText.isEmpty || session.originOffsetUtf16 != 0 {
      throw TestError.failed("composition end leaked state")
    }
  }

  private static func assertCanonicalRoundTrip(_ json: String) throws {
    guard let data = json.data(using: .utf8),
          let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw TestError.failed("parse fixture")
    }
    let node = SchemaNode.parseDictionary(raw)
    let linear = LinearModel.documentToLinear(node)
    let back = LinearModel.linearToDocument(linear)
    let expected = CanonicalJSON.stringify(node.toJSON())
    let actual = CanonicalJSON.stringify(back.toJSON())
    if expected != actual {
      throw TestError.failed("canonical mismatch")
    }
  }

  enum TestError: Error {
    case failed(String)
  }
}

#if canImport(XCTest)
import XCTest

final class LinearModelXCTest: XCTestCase {
  func testAll() throws {
    try LinearModelTests.runAll()
  }
}
#endif
