package app.jot.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM port of `ios/Tests/LinearModelTests.swift`. The shared editor corpus covers keystroke-level behavior. */
class LinearModelTest {
  private val docId = "aaaaaaaaaaaaaaaaaaaaaaaaaa"
  private val paragraphId = "aeaaaaaaaaaaaaaaaaaaaaaaaa"

  @Test
  fun paragraphBoldRoundTrip() {
    assertCanonicalRoundTrip(
      """{"content":[{"content":[{"id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","marks":[{"type":"bold"}],"text":"Hello","type":"text"}],"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}""",
    )
  }

  @Test
  fun headingsRoundTrip() {
    assertCanonicalRoundTrip(
      """{"content":[{"attrs":{"level":1},"content":[{"id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"one","type":"text"}],"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"heading"},{"attrs":{"level":6},"content":[{"id":"bqaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"six","type":"text"}],"id":"bmaaaaaaaaaaaaaaaaaaaaaaaa","type":"heading"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}""",
    )
  }

  @Test
  fun listsAndTasksRoundTrip() {
    assertCanonicalRoundTrip(
      """{"content":[{"content":[{"content":[{"content":[{"id":"aqaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"one","type":"text"}],"id":"amaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","type":"listItem"},{"content":[{"content":[{"id":"a4aaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"two","type":"text"}],"id":"ayaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"},{"content":[{"content":[{"content":[{"id":"bmaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"nested","type":"text"}],"id":"biaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"beaaaaaaaaaaaaaaaaaaaaaaaa","type":"listItem"}],"id":"baaaaaaaaaaaaaaaaaaaaaaaaa","type":"bulletList"}],"id":"auaaaaaaaaaaaaaaaaaaaaaaaa","type":"listItem"}],"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"bulletList"},{"attrs":{"start":2},"content":[{"content":[{"content":[{"id":"b4aaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"second","type":"text"}],"id":"byaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"buaaaaaaaaaaaaaaaaaaaaaaaa","type":"listItem"}],"id":"bqaaaaaaaaaaaaaaaaaaaaaaaa","type":"orderedList"},{"content":[{"attrs":{"checked":0},"content":[{"content":[{"id":"cmaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"todo","type":"text"}],"id":"ciaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"ceaaaaaaaaaaaaaaaaaaaaaaaa","type":"taskItem"},{"attrs":{"checked":1},"content":[{"content":[{"id":"cyaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"done","type":"text"}],"id":"cuaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"cqaaaaaaaaaaaaaaaaaaaaaaaa","type":"taskItem"}],"id":"caaaaaaaaaaaaaaaaaaaaaaaaa","type":"taskList"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}""",
    )
  }

  @Test
  fun blockquoteAndDividerRoundTrip() {
    assertCanonicalRoundTrip(
      """{"content":[{"content":[{"content":[{"id":"aqaaaaaaaaaaaaaaaaaaaaaaaa","marks":[],"text":"quoted","type":"text"}],"id":"amaaaaaaaaaaaaaaaaaaaaaaaa","type":"paragraph"}],"id":"aeaaaaaaaaaaaaaaaaaaaaaaaa","type":"blockquote"},{"id":"auaaaaaaaaaaaaaaaaaaaaaaaa","type":"horizontalRule"}],"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","type":"doc"}""",
    )
    val linear = linearFrom(
      """{"type":"doc","id":"$docId","content":[{"type":"blockquote","id":"$paragraphId","content":[{"type":"paragraph","id":"amaaaaaaaaaaaaaaaaaaaaaaaa","content":[]}]}]}""",
    )
    assertEquals(listOf(paragraphId), linear.blocks.single().quoteChain)
    assertEquals(LinearBlockKind.PARAGRAPH, linear.blocks.single().kind)
  }

  @Test
  fun codeBlockKeepsLanguage() {
    val linear = linearFrom(
      """{"type":"doc","id":"$docId","content":[{"type":"codeBlock","id":"$paragraphId","attrs":{"languageId":"swift"},"content":[{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"let x = 1","marks":[]}]}]}""",
    )
    assertEquals(LinearBlockKind.CODE_BLOCK, linear.blocks.single().kind)
    assertEquals("swift", linear.blocks.single().languageId)
  }

  @Test
  fun placeholderKeepsUnsupportedNode() {
    val linear = linearFrom(
      """{"type":"doc","id":"$docId","content":[{"type":"mathBlock","id":"$paragraphId","attrs":{"latex":"x^2","alt":"x squared"}},{"type":"paragraph","id":"amaaaaaaaaaaaaaaaaaaaaaaaa","content":[{"type":"text","id":"aqaaaaaaaaaaaaaaaaaaaaaaaa","text":"after","marks":[]}]}]}""",
    )
    assertEquals(LinearBlockKind.PLACEHOLDER, linear.blocks.first().kind)
    assertTrue(linear.blocks.first().plainText.contains("x"))
    val back = LinearModel.linearToDocument(linear)
    assertEquals("mathBlock", back.content[0].type)
    assertEquals("after", back.content[1].plainText())
  }

  @Test
  fun utf16EmojiOffsets() {
    val text = "😀!"
    assertEquals(3, text.length)
    assertEquals("!", Utf16.slice(text, 2, 1))
    assertFalse(Utf16.hasUnpairedSurrogates(text))
    assertTrue(Utf16.hasUnpairedSurrogates("\uD83D"))
  }

  @Test
  fun journalPayloadReplays() {
    var linear = paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"Hi","marks":[]}""")
    val operation = SchemaOperation.InsertText(caretAt(2), "!", emptyList())
    val payload = CanonicalJson.stringify(
      mapOf(
        "transactionId" to "t1",
        "baseRevision" to 0,
        "operations" to listOf(operation.toJson()),
        "selection" to caretAt(2).toJson(),
      ),
    )
    val parsed = JournalPayload.parse(payload)
    assertNotNull(parsed)
    assertEquals("t1", parsed!!.transactionId)
    linear = LinearModel.apply(parsed.operations, linear)
    assertEquals("Hi!", linear.blocks[0].plainText)
    assertNull(JournalPayload.parse("""{"transactionId":"t2","operations":[{"type":"bogus"}]}"""))
  }

  @Test
  fun listSplitAndJoin() {
    var linear = linearFrom(
      """{"type":"doc","id":"$docId","content":[{"type":"bulletList","id":"$paragraphId","content":[{"type":"listItem","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","content":[{"type":"paragraph","id":"amaaaaaaaaaaaaaaaaaaaaaaaa","content":[{"type":"text","id":"aqaaaaaaaaaaaaaaaaaaaaaaaa","text":"hello world","marks":[]}]}]}]}]}""",
    )
    val split = LinearCommands.split(SchemaSelection("amaaaaaaaaaaaaaaaaaaaaaaaa", 6, "before", 0), linear, emptyList())
    linear = LinearModel.apply(split.operations, linear)
    assertEquals(listOf("hello ", "world"), linear.blocks.map { it.plainText })
    val join = LinearCommands.join(SchemaSelection(linear.blocks[1].textNodeId, 0, "before", 0), linear, emptyList())
    linear = LinearModel.apply(join.operations, linear)
    assertEquals(listOf("hello world"), linear.blocks.map { it.plainText })
  }

  @Test
  fun inputRulesConvertBlocks() {
    for ((marker, kind) in listOf("#" to LinearBlockKind.HEADING, "-" to LinearBlockKind.BULLET_ITEM, "[ ]" to LinearBlockKind.TASK_ITEM)) {
      var linear = paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"$marker","marks":[]}""")
      val plan = LinearCommands.inputRule(" ", linear, caretAt(marker.length), emptyList())
      assertNotNull("rule for $marker", plan)
      assertTrue(plan!!.isInputRule)
      linear = LinearModel.apply(plan.operations, linear)
      assertEquals(kind, linear.blocks.single().kind)
      assertEquals("", linear.blocks.single().plainText)
    }
    var quoted = paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":">","marks":[]}""")
    quoted = LinearModel.apply(LinearCommands.inputRule(" ", quoted, caretAt(1), emptyList())!!.operations, quoted)
    assertEquals("blockquote", LinearModel.linearToDocument(quoted).content.single().type)
  }

  @Test
  fun firstKeystrokeInEmptyNoteUsesDerivedParagraph() {
    val empty = SchemaNode.parse(mapOf("type" to "doc", "id" to docId, "content" to emptyList<Any>()))
    val linear = LinearModel.apply(
      listOf(SchemaOperation.InsertText(SchemaSelection(docId, 0, "after", 0), "Hi", emptyList())),
      LinearModel.documentToLinear(empty),
    )
    assertEquals(LinearModel.bodyParagraphId(docId), linear.blocks.single().id)
    assertEquals("Hi", linear.blocks.single().plainText)
    assertEquals(LinearModel.bodyParagraphId(docId), LinearModel.withEditableBody(LinearModel.documentToLinear(empty)).blocks.single().id)
  }

  @Test
  fun toggleBoldRemovesWhenWholeRangeIsBold() {
    var linear = paragraphDoc(
      """{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"ab","marks":[]},{"type":"text","id":"amaaaaaaaaaaaaaaaaaaaaaaaa","text":"cd","marks":[{"type":"bold"}]}""",
    )
    val plan = LinearCommands.commandPlan("toggleBold", null, linear, caretAt(2), caretAt(4), emptyList())
    assertTrue(plan.operations.first() is SchemaOperation.RemoveMark)
    linear = LinearModel.apply(plan.operations, linear)
    assertTrue(linear.blocks[0].runs.all { it.marks.isEmpty() })
  }

  @Test
  fun inlineMarkdownRules() {
    var bold = paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"say **bold*","marks":[]}""")
    val boldPlan = LinearCommands.inlineMarkdownRule("*", bold, caretAt(11), emptyList())!!
    bold = LinearModel.apply(boldPlan.operations, bold)
    assertEquals("say bold", bold.blocks[0].plainText)
    assertTrue(LinearModel.rangeHasMark("bold", caretAt(4), caretAt(8), bold))
    assertEquals(8, boldPlan.selectionAfter?.offsetUtf16)
    assertNull(LinearCommands.inlineMarkdownRule("*", paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"**bold","marks":[]}"""), caretAt(6), emptyList()))
    assertNull(LinearCommands.inlineMarkdownRule("_", paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"my snake_case","marks":[]}"""), caretAt(13), emptyList()))
    var link = paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"see [site](https://a.b","marks":[]}""")
    link = LinearModel.apply(LinearCommands.inlineMarkdownRule(")", link, caretAt(22), emptyList())!!.operations, link)
    val linked = link.blocks[0].runs.first { run -> run.marks.any { it.type == "link" } }
    assertEquals("see site", link.blocks[0].plainText)
    assertEquals("site", linked.text)
    assertEquals("https://a.b", linked.marks.first { it.type == "link" }.attrs["href"])
    assertNull(LinearCommands.inlineMarkdownRule(")", paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"[x](javascript:alert","marks":[]}"""), caretAt(20), emptyList()))
  }

  @Test
  fun dividerInputRule() {
    var linear = paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"---","marks":[]}""")
    val plan = LinearCommands.inputRule("\n", linear, caretAt(3), emptyList())!!
    linear = LinearModel.apply(plan.operations, linear)
    assertEquals(listOf("horizontalRule", "paragraph"), LinearModel.linearToDocument(linear).content.map { it.type })
    assertEquals(linear.blocks[1].id, plan.selectionAfter?.nodeId)
  }

  @Test
  fun imageWidthCommandClamps() {
    var linear = linearFrom(
      """{"type":"doc","id":"$docId","content":[{"type":"image","id":"$paragraphId","attrs":{"attachmentId":"aiaaaaaaaaaaaaaaaaaaaaaaaa","widthBasisPoints":10000,"alt":""},"content":[]},{"type":"paragraph","id":"amaaaaaaaaaaaaaaaaaaaaaaaa","content":[]}]}""",
    )
    for ((requested, expected) in listOf(5000 to 5000, 10 to LinearCommands.MINIMUM_IMAGE_WIDTH_BASIS_POINTS)) {
      val plan = LinearCommands.commandPlan(
        "setImageWidth",
        mapOf("nodeId" to paragraphId, "widthBasisPoints" to requested),
        linear,
        SchemaSelection("amaaaaaaaaaaaaaaaaaaaaaaaa", 0, "after", 0),
        null,
        emptyList(),
      )
      linear = LinearModel.apply(plan.operations, linear)
      assertEquals(expected, LinearModel.linearToDocument(linear).content[0].attrs["widthBasisPoints"])
    }
  }

  @Test
  fun insertBlocksSplitsParagraph() {
    var linear = paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"hello world","marks":[]}""")
    val nodes = listOf(
      SchemaNode(type = "heading", id = "baaaaaaaaaaaaaaaaaaaaaaaaa", attrs = mapOf("level" to 2), content = listOf(LinearModel.textNode("Title", emptyList()))),
      SchemaNode(type = "paragraph", id = "beaaaaaaaaaaaaaaaaaaaaaaaa", content = listOf(LinearModel.textNode("body", listOf(LinearMark("bold"))))),
    )
    val plan = LinearCommands.insertBlocks(nodes, linear, caretAt(6), null, emptyList())
    linear = LinearModel.apply(plan.operations, linear)
    assertEquals(listOf("hello ", "Title", "body", "world"), linear.blocks.map { it.plainText })
    assertEquals(LinearBlockKind.HEADING, linear.blocks[1].kind)
    assertEquals("beaaaaaaaaaaaaaaaaaaaaaaaa", plan.selectionAfter?.nodeId)
    assertEquals(4, plan.selectionAfter?.offsetUtf16)
  }

  @Test
  fun preciseInverseRestoresMarksAndBlocks() {
    val original = linearFrom(
      """{"type":"doc","id":"$docId","content":[{"type":"paragraph","id":"$paragraphId","content":[{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"ab","marks":[]},{"type":"text","id":"amaaaaaaaaaaaaaaaaaaaaaaaa","text":"cd","marks":[{"type":"bold"}]}]},{"type":"horizontalRule","id":"aqaaaaaaaaaaaaaaaaaaaaaaaa"},{"type":"paragraph","id":"auaaaaaaaaaaaaaaaaaaaaaaaa","content":[{"type":"text","id":"ayaaaaaaaaaaaaaaaaaaaaaaaa","text":"z","marks":[]}]}]}""",
    )
    val rule = SchemaNode(type = "horizontalRule", id = "aqaaaaaaaaaaaaaaaaaaaaaaaa")
    val cases = listOf(
      listOf(SchemaOperation.AddMark(caretAt(1), caretAt(3), SchemaMark("italic"))),
      listOf(SchemaOperation.RemoveMark(caretAt(0), caretAt(4), "bold")),
      listOf(SchemaOperation.DeleteRange(caretAt(1), caretAt(3), emptyList())),
      listOf(SchemaOperation.InsertText(caretAt(2), "XY", listOf(SchemaMark("underline")))),
      listOf(SchemaOperation.DeleteNode(rule.id, rule)),
    )
    for ((index, operations) in cases.withIndex()) {
      val inverse = LinearModel.invert(operations, original)
      assertNotNull("inverse $index", inverse)
      val restored = LinearModel.apply(inverse!!, LinearModel.apply(operations, original))
      assertEquals("inverse $index", signature(original), signature(restored))
    }
    val crossBlock = listOf(SchemaOperation.DeleteRange(caretAt(3), SchemaSelection("auaaaaaaaaaaaaaaaaaaaaaaaa", 0, "after", 0), emptyList()))
    assertNull(LinearModel.invert(crossBlock, original))
  }

  @Test
  fun toggleBlockquoteWrapsAndUnwraps() {
    var linear = paragraphDoc("""{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"Hi","marks":[]}""")
    linear = LinearModel.apply(LinearCommands.commandPlan("toggleBlockquote", null, linear, caretAt(0), null, emptyList()).operations, linear)
    assertEquals("blockquote", LinearModel.linearToDocument(linear).content.single().type)
    linear = LinearModel.apply(LinearCommands.commandPlan("toggleBlockquote", null, linear, caretAt(0), null, emptyList()).operations, linear)
    assertEquals("paragraph", LinearModel.linearToDocument(linear).content.single().type)
  }

  @Test
  fun editorCharacterLayout() {
    val linear = linearFrom(
      """{"type":"doc","id":"$docId","content":[{"type":"paragraph","id":"$paragraphId","content":[{"type":"text","id":"aiaaaaaaaaaaaaaaaaaaaaaaaa","text":"ab","marks":[]}]},{"type":"taskList","id":"amaaaaaaaaaaaaaaaaaaaaaaaa","content":[{"type":"taskItem","id":"aqaaaaaaaaaaaaaaaaaaaaaaaa","attrs":{"checked":0},"content":[{"type":"paragraph","id":"auaaaaaaaaaaaaaaaaaaaaaaaa","content":[{"type":"text","id":"ayaaaaaaaaaaaaaaaaaaaaaaaa","text":"cd","marks":[]}]}]}]}]}""",
    )
    assertEquals("ab\n${OBJECT_REPLACEMENT}cd", EditPlanner.displayText(linear))
    // Index 3 is the checkbox, which belongs to the start of the task's paragraph.
    assertEquals(SchemaSelection("auaaaaaaaaaaaaaaaaaaaaaaaa", 0, "after", 0), EditPlanner.location(3, "after", linear, 0))
    assertEquals(4, EditPlanner.displayIndex(SchemaSelection("auaaaaaaaaaaaaaaaaaaaaaaaa", 0, "after", 0), linear))
    assertFalse(EditPlanner.isAtomicCharacter(3, linear))
  }

  private fun assertCanonicalRoundTrip(json: String) {
    val node = SchemaNode.parse(JsonParser.parseObject(json))
    val back = LinearModel.linearToDocument(LinearModel.documentToLinear(node))
    assertEquals(CanonicalJson.stringify(node.toJson()), CanonicalJson.stringify(back.toJson()))
  }

  private fun linearFrom(json: String): LinearDocument = LinearModel.documentToLinear(SchemaNode.parse(JsonParser.parseObject(json)))

  private fun paragraphDoc(runs: String): LinearDocument =
    linearFrom("""{"type":"doc","id":"$docId","content":[{"type":"paragraph","id":"$paragraphId","content":[$runs]}]}""")

  private fun caretAt(offset: Int): SchemaSelection = SchemaSelection(paragraphId, offset, "after", 0)

  /** Block kinds plus text grouped by mark set, ignoring run ids that undo regenerates. */
  private fun signature(linear: LinearDocument): List<String> =
    linear.blocks.map { block ->
      val parts = mutableListOf<Pair<String, String>>()
      for (run in block.runs) {
        if (run.text.isEmpty()) {
          continue
        }
        val key = run.marks.map { it.type }.sorted().joinToString(",")
        val last = parts.lastOrNull()
        if (last != null && last.second == key) {
          parts[parts.size - 1] = (last.first + run.text) to key
        } else {
          parts.add(run.text to key)
        }
      }
      "${block.kind.rawValue}:" + parts.joinToString("") { "${it.first}[${it.second}]" }
    }
}
