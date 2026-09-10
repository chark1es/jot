package app.jot.editor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinearModelTest {
  @Test
  fun paragraphBoldRoundTrip() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(
        mapOf(
          "type" to "paragraph",
          "id" to "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "content" to listOf(
            mapOf(
              "type" to "text",
              "id" to "aiaaaaaaaaaaaaaaaaaaaaaaaa",
              "text" to "Hello",
              "marks" to listOf(mapOf("type" to "bold")),
            ),
          ),
        ),
      ),
    )
    val roundTrip = LinearModel.toDocument(LinearModel.fromDocument(original))
    assertEquals(deep(original), deep(roundTrip))
  }

  @Test
  fun headingLevelsRoundTrip() {
    val headings = (1..6).map { level ->
      mapOf(
        "type" to "heading",
        "id" to "h$level".padEnd(26, 'a'),
        "attrs" to mapOf("level" to level),
        "content" to listOf(
          mapOf(
            "type" to "text",
            "id" to "t$level".padEnd(26, 'a'),
            "text" to "h$level",
            "marks" to emptyList<Map<String, Any?>>(),
          ),
        ),
      )
    }
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to headings,
    )
    val roundTrip = LinearModel.toDocument(LinearModel.fromDocument(original))
    assertEquals(deep(original), deep(roundTrip))
  }

  @Test
  fun nestedListsAndTasksRoundTrip() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(
        mapOf(
          "type" to "bulletList",
          "id" to "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "content" to listOf(
            mapOf(
              "type" to "listItem",
              "id" to "aiaaaaaaaaaaaaaaaaaaaaaaaa",
              "content" to listOf(paragraph("amaaaaaaaaaaaaaaaaaaaaaaaa", "aqaaaaaaaaaaaaaaaaaaaaaaaa", "one")),
            ),
            mapOf(
              "type" to "listItem",
              "id" to "auaaaaaaaaaaaaaaaaaaaaaaaa",
              "content" to listOf(
                paragraph("ayaaaaaaaaaaaaaaaaaaaaaaaa", "a4aaaaaaaaaaaaaaaaaaaaaaaa", "two"),
                mapOf(
                  "type" to "bulletList",
                  "id" to "baaaaaaaaaaaaaaaaaaaaaaaaa",
                  "content" to listOf(
                    mapOf(
                      "type" to "listItem",
                      "id" to "beaaaaaaaaaaaaaaaaaaaaaaaa",
                      "content" to listOf(paragraph("biaaaaaaaaaaaaaaaaaaaaaaaa", "bmaaaaaaaaaaaaaaaaaaaaaaaa", "nested")),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        mapOf(
          "type" to "orderedList",
          "id" to "bqaaaaaaaaaaaaaaaaaaaaaaaa",
          "attrs" to mapOf("start" to 2),
          "content" to listOf(
            mapOf(
              "type" to "listItem",
              "id" to "buaaaaaaaaaaaaaaaaaaaaaaaa",
              "content" to listOf(paragraph("byaaaaaaaaaaaaaaaaaaaaaaaa", "b4aaaaaaaaaaaaaaaaaaaaaaaa", "second")),
            ),
          ),
        ),
        mapOf(
          "type" to "taskList",
          "id" to "caaaaaaaaaaaaaaaaaaaaaaaaa",
          "content" to listOf(
            mapOf(
              "type" to "taskItem",
              "id" to "ceaaaaaaaaaaaaaaaaaaaaaaaa",
              "attrs" to mapOf("checked" to 0),
              "content" to listOf(paragraph("ciaaaaaaaaaaaaaaaaaaaaaaaa", "cmaaaaaaaaaaaaaaaaaaaaaaaa", "todo")),
            ),
            mapOf(
              "type" to "taskItem",
              "id" to "cqaaaaaaaaaaaaaaaaaaaaaaaa",
              "attrs" to mapOf("checked" to 1),
              "content" to listOf(paragraph("cuaaaaaaaaaaaaaaaaaaaaaaaa", "cyaaaaaaaaaaaaaaaaaaaaaaaa", "done")),
            ),
          ),
        ),
      ),
    )
    val linear = LinearModel.fromDocument(original)
    assertEquals(LinearBlockKind.BULLET_ITEM, linear.blocks[0].kind)
    assertEquals(0, linear.blocks[0].indent)
    assertEquals("one", linear.blocks[0].text)
    assertEquals(1, linear.blocks[2].indent)
    assertEquals("nested", linear.blocks[2].text)
    assertEquals(2, linear.blocks[3].orderedStart)
    assertTrue(linear.blocks[5].checked)
    assertEquals(deep(original), deep(LinearModel.toDocument(linear)))
  }

  @Test
  fun unknownAtomicBlockPreservesUserText() {
    val image = mapOf(
      "type" to "image",
      "id" to "aeaaaaaaaaaaaaaaaaaaaaaaaa",
      "attrs" to mapOf(
        "attachmentId" to "aiaaaaaaaaaaaaaaaaaaaaaaaa",
        "widthBasisPoints" to 5000,
        "alt" to "photo",
      ),
      "content" to listOf(
        mapOf(
          "type" to "caption",
          "id" to "amaaaaaaaaaaaaaaaaaaaaaaaa",
          "content" to listOf(
            mapOf(
              "type" to "text",
              "id" to "aqaaaaaaaaaaaaaaaaaaaaaaaa",
              "text" to "A photo",
              "marks" to emptyList<Map<String, Any?>>(),
            ),
          ),
        ),
      ),
    )
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(
        image,
        paragraph("baaaaaaaaaaaaaaaaaaaaaaaaa", "beaaaaaaaaaaaaaaaaaaaaaaaa", "after"),
      ),
    )
    val linear = LinearModel.fromDocument(original)
    assertEquals(LinearBlockKind.ATOMIC, linear.blocks[0].kind)
    assertEquals("photo", JsonMaps.string(JsonMaps.mapOf(linear.blocks[0].atomicNode?.get("attrs"))["alt"]))
    assertEquals("after", linear.blocks[1].text)
    assertEquals(deep(original), deep(LinearModel.toDocument(linear)))
  }

  @Test
  fun utf16OffsetsUseCodeUnitsNotCodePoints() {
    val emoji = "😀"
    assertEquals(2, LinearModel.utf16Length(emoji))
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(paragraph("aeaaaaaaaaaaaaaaaaaaaaaaaa", "aiaaaaaaaaaaaaaaaaaaaaaaaa", emoji + "x")),
    )
    val linear = LinearModel.fromDocument(original)
    assertEquals(3, linear.blocks[0].text.length)
    val display = LinearModel.buildDisplay(linear)
    val afterEmoji = LinearSelection(linear.blocks[0].nodeId, 2, "after", 0)
    assertEquals(2, LinearModel.displayIndex(linear, display, afterEmoji))
    val inserted = LinearModel.replaceBlockText(linear, linear.blocks[0].nodeId, 2, 2, "y", emptyList())
    assertEquals(emoji + "yx", inserted.blocks[0].text)
    assertEquals(deep(original), deep(LinearModel.toDocument(LinearModel.fromDocument(original))))
  }

  @Test
  fun heading1InputRule() {
    val document = LinearModel.fromDocument(
      mapOf(
        "type" to "doc",
        "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        "content" to listOf(paragraph("aeaaaaaaaaaaaaaaaaaaaaaaaa", "aiaaaaaaaaaaaaaaaaaaaaaaaa", "#")),
      ),
    )
    val plan = EditorEdits.planInputRule(
      document,
      LinearSelection("aeaaaaaaaaaaaaaaaaaaaaaaaa", 1, "after", 0),
      0,
    )
    assertTrue(plan != null)
    assertEquals(LinearBlockKind.HEADING, plan!!.document.blocks[0].kind)
    assertEquals(1, plan.document.blocks[0].headingLevel)
    assertEquals("", plan.document.blocks[0].text)
    val applied = LinearModel.applyOperations(document, plan.operations)
    assertEquals(LinearBlockKind.HEADING, applied.blocks[0].kind)
    assertEquals(1, applied.blocks[0].headingLevel)
  }

  @Test
  fun bulletInputRule() {
    val document = LinearModel.fromDocument(
      mapOf(
        "type" to "doc",
        "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        "content" to listOf(paragraph("aeaaaaaaaaaaaaaaaaaaaaaaaa", "aiaaaaaaaaaaaaaaaaaaaaaaaa", "-")),
      ),
    )
    val plan = EditorEdits.planInputRule(
      document,
      LinearSelection("aeaaaaaaaaaaaaaaaaaaaaaaaa", 1, "after", 0),
      0,
    )
    assertTrue(plan != null)
    assertEquals(LinearBlockKind.BULLET_ITEM, plan!!.document.blocks[0].kind)
    assertEquals("", plan.document.blocks[0].text)
  }

  @Test
  fun listSplitAndJoin() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(
        mapOf(
          "type" to "bulletList",
          "id" to "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "content" to listOf(
            mapOf(
              "type" to "listItem",
              "id" to "aiaaaaaaaaaaaaaaaaaaaaaaaa",
              "content" to listOf(
                paragraph("amaaaaaaaaaaaaaaaaaaaaaaaa", "aqaaaaaaaaaaaaaaaaaaaaaaaa", "hello world"),
              ),
            ),
          ),
        ),
      ),
    )
    val document = LinearModel.fromDocument(original)
    val split = EditorEdits.planEnter(
      document,
      LinearSelection("amaaaaaaaaaaaaaaaaaaaaaaaa", 6, "before", 0),
      0,
    )
    assertTrue(split != null)
    assertEquals(2, split!!.document.blocks.size)
    assertEquals("hello ", split.document.blocks[0].text)
    assertEquals("world", split.document.blocks[1].text)
    val join = EditorEdits.planBackspaceAtStart(
      split.document,
      LinearSelection(split.document.blocks[1].nodeId, 0, "before", 1),
      1,
    )
    assertTrue(join != null)
    assertEquals(1, join!!.document.blocks.size)
    assertEquals("hello world", join.document.blocks[0].text)
    val replayed = LinearModel.applyOperations(document, split.operations)
    assertEquals("hello ", replayed.blocks[0].text)
    assertEquals("world", replayed.blocks[1].text)
  }

  @Test
  fun emptyDocumentRoundTrip() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to emptyList<Map<String, Any?>>(),
    )
    assertEquals(deep(original), deep(LinearModel.toDocument(LinearModel.fromDocument(original))))
  }

  @Test
  fun emptyListItemEnterLiftsToParagraph() {
    val original = docWithBullet("")
    val linear = LinearModel.fromDocument(original)
    val plan = EditorEdits.planEnter(linear, LinearSelection(linear.blocks[0].nodeId, 0, "after", 0), 0)
    requireNotNull(plan)
    assertEquals(LinearBlockKind.PARAGRAPH, plan.document.blocks[0].kind)
    assertEquals(1, plan.document.blocks.size)
  }

  @Test
  fun listJoinAtStartMergesIntoPrevious() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(
        mapOf(
          "type" to "bulletList",
          "id" to "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "content" to listOf(
            mapOf(
              "type" to "listItem",
              "id" to "aiaaaaaaaaaaaaaaaaaaaaaaaa",
              "content" to listOf(paragraph("amaaaaaaaaaaaaaaaaaaaaaaaa", "aqaaaaaaaaaaaaaaaaaaaaaaaa", "he")),
            ),
            mapOf(
              "type" to "listItem",
              "id" to "auaaaaaaaaaaaaaaaaaaaaaaaa",
              "content" to listOf(paragraph("ayaaaaaaaaaaaaaaaaaaaaaaaa", "a4aaaaaaaaaaaaaaaaaaaaaaaa", "llo")),
            ),
          ),
        ),
      ),
    )
    val linear = LinearModel.fromDocument(original)
    val plan = EditorEdits.planBackspaceAtStart(linear, LinearSelection(linear.blocks[1].nodeId, 0, "after", 0), 0)
    requireNotNull(plan)
    assertEquals(1, plan.document.blocks.size)
    assertEquals("hello", plan.document.blocks[0].text)
    assertEquals(LinearBlockKind.BULLET_ITEM, plan.document.blocks[0].kind)
    val applied = LinearModel.applyOperations(linear, plan.operations)
    assertEquals("hello", applied.blocks[0].text)
    assertEquals(1, applied.blocks.size)
  }

  @Test
  fun quoteInputRule() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(paragraph("aeaaaaaaaaaaaaaaaaaaaaaaaa", "aiaaaaaaaaaaaaaaaaaaaaaaaa", ">")),
    )
    val linear = LinearModel.fromDocument(original)
    val plan = EditorEdits.planInputRule(linear, LinearSelection(linear.blocks[0].nodeId, 1, "after", 0), 0)
    requireNotNull(plan)
    assertEquals(LinearBlockKind.BLOCKQUOTE, plan.document.blocks[0].kind)
    assertEquals("", plan.document.blocks[0].text)
    val applied = LinearModel.applyOperations(linear, plan.operations)
    assertEquals(LinearBlockKind.BLOCKQUOTE, applied.blocks[0].kind)
    val roundTrip = LinearModel.toDocument(applied)
    val quote = JsonMaps.mapOf(JsonMaps.listOf(roundTrip["content"]).first())
    assertEquals("blockquote", JsonMaps.string(quote["type"]))
  }

  @Test
  fun journalPayloadApplyInsertText() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(paragraph("aeaaaaaaaaaaaaaaaaaaaaaaaa", "aiaaaaaaaaaaaaaaaaaaaaaaaa", "")),
    )
    val linear = LinearModel.fromDocument(original)
    val payload =
      """{"transactionId":"tx1","baseRevision":0,"operations":[{"type":"insertText","position":{"nodeId":"aeaaaaaaaaaaaaaaaaaaaaaaaa","offsetUtf16":0,"affinity":"after","revision":0},"text":"Hi","storedMarks":[]}],"selection":{"nodeId":"aeaaaaaaaaaaaaaaaaaaaaaaaa","offsetUtf16":2,"affinity":"after","revision":1}}"""
    val parsed = EditorEdits.parseIntakePayload(payload)
    assertEquals("tx1", parsed.transactionId)
    assertEquals(0, parsed.baseRevision)
    assertTrue(parsed.selection.isNotEmpty())
    val applied = LinearModel.applyOperations(linear, parsed.operations)
    assertEquals("Hi", applied.blocks[0].text)
  }

  @Test
  fun journalPayloadReplaceRangeMatchesIosShape() {
    val payload =
      """{"transactionId":"tx2","baseRevision":3,"operations":[{"type":"replaceRange","from":{"nodeId":"n1","offsetUtf16":0,"affinity":"before","revision":3},"to":{"nodeId":"n1","offsetUtf16":1,"affinity":"after","revision":3},"slice":{"nodes":[{"type":"text","id":"t1","text":"ab","marks":[]}]},"deletedSlice":{"nodes":[{"type":"text","id":"t0","text":"a","marks":[]}]}}],"selection":{"nodeId":"n1","offsetUtf16":2,"affinity":"after","revision":4}}"""
    val parsed = EditorEdits.parseIntakePayload(payload)
    assertEquals("tx2", parsed.transactionId)
    assertEquals(3, parsed.baseRevision)
    assertEquals("replaceRange", JsonMaps.string(parsed.operations[0]["type"]))
    assertEquals("n1", JsonMaps.string(parsed.selection["nodeId"]))
  }

  @Test
  fun underlineStrikethroughInlineCodeRoundTrip() {
    val marks = listOf("underline", "strikethrough", "inlineCode")
    for (type in marks) {
      val original = mapOf(
        "type" to "doc",
        "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        "content" to listOf(
          markedParagraph(
            "aeaaaaaaaaaaaaaaaaaaaaaaaa",
            "aiaaaaaaaaaaaaaaaaaaaaaaaa",
            "Hello",
            listOf(mapOf("type" to type)),
          ),
        ),
      )
      val linear = LinearModel.fromDocument(original)
      assertTrue(linear.blocks[0].runs[0].marks.any { it.type == type })
      assertEquals(deep(original), deep(LinearModel.toDocument(linear)))
      val from = LinearSelection(linear.blocks[0].nodeId, 0, "after", 0)
      val to = LinearSelection(linear.blocks[0].nodeId, 5, "before", 0)
      val toggledOff = EditorEdits.planToggleMark(linear, from, to, type, 0)
      assertTrue(toggledOff.document.blocks[0].runs.none { run -> run.marks.any { it.type == type } })
      val toggledOn = EditorEdits.planToggleMark(toggledOff.document, from, to, type, 1)
      assertTrue(toggledOn.document.blocks[0].runs.any { run -> run.marks.any { it.type == type } })
    }
  }

  @Test
  fun linkMarkRoundTripAndHrefFilter() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(
        markedParagraph(
          "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "aiaaaaaaaaaaaaaaaaaaaaaaaa",
          "read",
          listOf(mapOf("type" to "link", "attrs" to mapOf("href" to "https://example.com/path", "title" to ""))),
        ),
      ),
    )
    val linear = LinearModel.fromDocument(original)
    assertEquals("https://example.com/path", JsonMaps.string(linear.blocks[0].runs[0].marks.first { it.type == "link" }.attrs["href"]))
    assertEquals(deep(original), deep(LinearModel.toDocument(linear)))
    val from = LinearSelection(linear.blocks[0].nodeId, 0, "after", 0)
    val to = LinearSelection(linear.blocks[0].nodeId, 4, "before", 0)
    assertNull(EditorEdits.planSetLink(linear, from, to, "javascript:alert(1)", "", 0))
    assertNull(EditorEdits.planSetLink(linear, from, to, "ftp://example.com", "", 0))
    assertTrue(LinearModel.isAllowedHref("https://example.com"))
    assertTrue(LinearModel.isAllowedHref("http://example.com"))
    assertTrue(LinearModel.isAllowedHref("mailto:a@example.com"))
    assertTrue(!LinearModel.isAllowedHref("javascript:alert(1)"))
    val set = EditorEdits.planSetLink(linear, from, to, "https://jot.example/note", "title", 0)
    requireNotNull(set)
    val href = JsonMaps.string(
      set.document.blocks[0].runs.first { it.marks.any { mark -> mark.type == "link" } }
        .marks.first { it.type == "link" }.attrs["href"],
    )
    assertEquals("https://jot.example/note", href)
    val unset = EditorEdits.planUnsetLink(set.document, from, to, 1)
    assertTrue(unset.document.blocks[0].runs.none { run -> run.marks.any { it.type == "link" } })
  }

  @Test
  fun blockquoteRoundTripAndToggle() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(
        mapOf(
          "type" to "blockquote",
          "id" to "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "content" to listOf(paragraph("aiaaaaaaaaaaaaaaaaaaaaaaaa", "amaaaaaaaaaaaaaaaaaaaaaaaa", "quoted")),
        ),
      ),
    )
    val linear = LinearModel.fromDocument(original)
    assertEquals(LinearBlockKind.BLOCKQUOTE, linear.blocks[0].kind)
    assertEquals("aeaaaaaaaaaaaaaaaaaaaaaaaa", linear.blocks[0].blockquoteId)
    assertEquals("quoted", linear.blocks[0].text)
    assertEquals(deep(original), deep(LinearModel.toDocument(linear)))
    val plan = EditorEdits.planToggleBlockquote(
      linear,
      LinearSelection(linear.blocks[0].nodeId, 0, "after", 0),
      0,
    )
    assertEquals(LinearBlockKind.PARAGRAPH, plan.document.blocks[0].kind)
    assertEquals(null, plan.document.blocks[0].blockquoteId)
    val quotedAgain = EditorEdits.planToggleBlockquote(
      plan.document,
      LinearSelection(plan.document.blocks[0].nodeId, 0, "after", 1),
      1,
    )
    assertEquals(LinearBlockKind.BLOCKQUOTE, quotedAgain.document.blocks[0].kind)
    val tree = LinearModel.toDocument(quotedAgain.document)
    assertEquals("blockquote", JsonMaps.string(JsonMaps.mapOf(JsonMaps.listOf(tree["content"]).first())["type"]))
  }

  @Test
  fun horizontalRuleRoundTripAndInsert() {
    val original = mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(
        mapOf("type" to "horizontalRule", "id" to "aeaaaaaaaaaaaaaaaaaaaaaaaa"),
        paragraph("baaaaaaaaaaaaaaaaaaaaaaaaa", "beaaaaaaaaaaaaaaaaaaaaaaaa", "after"),
      ),
    )
    val linear = LinearModel.fromDocument(original)
    assertEquals(LinearBlockKind.ATOMIC, linear.blocks[0].kind)
    assertEquals("horizontalRule", JsonMaps.string(linear.blocks[0].atomicNode?.get("type")))
    assertEquals(deep(original), deep(LinearModel.toDocument(linear)))
    val start = LinearModel.fromDocument(
      mapOf(
        "type" to "doc",
        "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        "content" to listOf(paragraph("aeaaaaaaaaaaaaaaaaaaaaaaaa", "aiaaaaaaaaaaaaaaaaaaaaaaaa", "hi")),
      ),
    )
    val plan = EditorEdits.planInsertHorizontalRule(
      start,
      LinearSelection(start.blocks[0].nodeId, 2, "after", 0),
      0,
    )
    assertEquals(3, plan.document.blocks.size)
    assertEquals("horizontalRule", JsonMaps.string(plan.document.blocks[1].atomicNode?.get("type")))
    assertEquals(LinearBlockKind.ATOMIC, plan.document.blocks[1].kind)
    assertEquals(LinearBlockKind.PARAGRAPH, plan.document.blocks[2].kind)
  }

  @Test
  fun insertImageCreatesAtomicWithAlt() {
    val start = LinearModel.fromDocument(
      mapOf(
        "type" to "doc",
        "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        "content" to listOf(paragraph("aeaaaaaaaaaaaaaaaaaaaaaaaa", "aiaaaaaaaaaaaaaaaaaaaaaaaa", "hi")),
      ),
    )
    val plan = EditorEdits.planInsertImage(
      start,
      LinearSelection(start.blocks[0].nodeId, 2, "after", 0),
      "amaaaaaaaaaaaaaaaaaaaaaaaa",
      "photo",
      0,
    )
    val image = plan.document.blocks[1]
    assertEquals(LinearBlockKind.ATOMIC, image.kind)
    assertEquals("image", JsonMaps.string(image.atomicNode?.get("type")))
    assertEquals("photo", JsonMaps.string(JsonMaps.mapOf(image.atomicNode?.get("attrs"))["alt"]))
    assertEquals("amaaaaaaaaaaaaaaaaaaaaaaaa", JsonMaps.string(JsonMaps.mapOf(image.atomicNode?.get("attrs"))["attachmentId"]))
  }

  private fun docWithBullet(text: String): Map<String, Any?> =
    mapOf(
      "type" to "doc",
      "id" to "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content" to listOf(
        mapOf(
          "type" to "bulletList",
          "id" to "aeaaaaaaaaaaaaaaaaaaaaaaaa",
          "content" to listOf(
            mapOf(
              "type" to "listItem",
              "id" to "aiaaaaaaaaaaaaaaaaaaaaaaaa",
              "content" to listOf(paragraph("amaaaaaaaaaaaaaaaaaaaaaaaa", "aqaaaaaaaaaaaaaaaaaaaaaaaa", text)),
            ),
          ),
        ),
      ),
    )

  private fun paragraph(paragraphId: String, textId: String, text: String): Map<String, Any?> =
    markedParagraph(paragraphId, textId, text, emptyList())

  private fun markedParagraph(
    paragraphId: String,
    textId: String,
    text: String,
    marks: List<Map<String, Any?>>,
  ): Map<String, Any?> =
    mapOf(
      "type" to "paragraph",
      "id" to paragraphId,
      "content" to listOf(
        mapOf(
          "type" to "text",
          "id" to textId,
          "text" to text,
          "marks" to marks,
        ),
      ),
    )

  private fun deep(value: Any?): Any? {
    return when (value) {
      is Map<*, *> -> value.entries.associate { (key, nested) -> key.toString() to deep(nested) }.toSortedMap()
      is List<*> -> value.map { deep(it) }
      else -> value
    }
  }
}
