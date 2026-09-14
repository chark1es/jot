package app.jot.editor

import java.io.File

/**
 * Runs the shared editor corpus (`packages/editor-native/corpus`) through the Kotlin planner and
 * model, step for step like `EditorCorpusRunner.swift`. `scripts/native-editor-check.ts` compares
 * the two outputs with each other, TypeScript, and Yjs.
 */
object EditorCorpusRunner {
  private val markdownTriggers = setOf("*", "_", "~", "`", ")")

  @JvmStatic
  fun main(args: Array<String>) {
    require(args.size >= 3) { "usage: EditorCorpusRunner corpus.json fixturesDirectory output.json" }
    val corpus = Json.normalize(JsonParser.parseObject(File(args[0]).readText()))
    val fixtures = (File(args[1]).listFiles() ?: emptyArray())
      .filter { it.name.endsWith(".canonical.json") }
      .sortedBy { it.name }
      .map { it.name to Json.normalize(JsonParser.parseObject(it.readText())) }
    File(args[2]).writeText(CanonicalJson.stringify(run(corpus, fixtures)))
    println("EditorCorpus wrote ${args[2]}")
  }

  internal fun run(corpus: Any?, fixtures: List<Pair<String, Any?>>): Map<String, Any?> =
    mapOf(
      "platform" to "kotlin",
      "scenarios" to Json.arr(Json.obj(corpus)["scenarios"]).map { runScenario(Json.obj(it)) },
      "fixtures" to fixtures.map { (name, document) ->
        val back = LinearModel.linearToDocument(LinearModel.documentToLinear(SchemaNode.parse(document)))
        mapOf("name" to name, "document" to back.toJson())
      },
    )

  private fun runScenario(scenario: Map<String, Any?>): Map<String, Any?> {
    val session = Session(SchemaNode.parse(scenario["doc"]))
    var failure: String? = null
    try {
      for (raw in Json.arr(scenario["steps"])) {
        session.perform(Json.obj(raw))
      }
    } catch (error: Exception) {
      failure = error.message ?: error.toString()
    }
    return mapOf(
      "name" to (Json.str(scenario["name"]) ?: ""),
      "steps" to session.records,
      "document" to LinearModel.linearToDocument(session.linear).toJson(),
      "caret" to session.caret,
      "text" to EditPlanner.displayText(session.linear),
      "error" to failure,
    )
  }

  private class Session(document: SchemaNode) {
    var linear = LinearModel.withEditableBody(LinearModel.documentToLinear(document))
    var caret = 0
    var anchor: Int? = null
    var storedMarks: List<LinearMark> = emptyList()
    var inputRuleBlockId: String? = null
    var revision = 0
    val records = mutableListOf<Map<String, Any?>>()
    val history = UndoStack()

    private val lower: Int
      get() = minOf(caret, anchor ?: caret)

    private val upper: Int
      get() = maxOf(caret, anchor ?: caret)

    fun perform(step: Map<String, Any?>) {
      when {
        step.containsKey("caret") -> place(Json.int(step["caret"]) ?: 0, null)
        step.containsKey("select") -> {
          val range = Json.arr(step["select"])
          place(Json.int(range.getOrNull(0)) ?: 0, Json.int(range.getOrNull(1)) ?: 0)
        }
        step.containsKey("marks") -> storedMarks = Json.arr(step["marks"]).mapNotNull { Json.str(it) }.map { LinearMark(it) }
        step.containsKey("type") -> type(Json.str(step["type"]) ?: "")
        step.containsKey("key") -> when (val key = Json.str(step["key"])) {
          "enter" -> type("\n")
          "backspace" -> backspace()
          "undo" -> undo()
          "redo" -> redo()
          else -> throw IllegalArgumentException("unknown key $key")
        }
        step.containsKey("command") -> {
          var value = step["value"]
          val target = Json.int(step["targetBlock"])
          if (target != null && target < linear.blocks.size) {
            value = Json.obj(value).toMutableMap().also { it["nodeId"] = linear.blocks[target].id }
          }
          command(Json.str(step["command"]) ?: "", value)
        }
        else -> throw IllegalArgumentException("unknown step")
      }
    }

    private fun selection(index: Int, affinity: String): SchemaSelection =
      EditPlanner.location(index, affinity, linear, revision)

    private fun place(index: Int, end: Int?) {
      caret = index
      anchor = end
      val start = selection(minOf(index, end ?: index), if (end == null) "after" else "before")
      LinearModel.block(start.nodeId, linear)?.let { storedMarks = it.markTypes(start.offsetUtf16) }
    }

    private fun type(text: String) {
      var i = 0
      while (i < text.length) {
        val codePoint = text.codePointAt(i)
        val count = Character.charCount(codePoint)
        edit(lower, upper, text.substring(i, i + count))
        i += count
      }
    }

    private fun backspace() {
      val end = anchor
      if (end != null && end != caret) {
        edit(lower, upper, "")
        return
      }
      if (caret <= 0) {
        records.add(mapOf("step" to "ignored"))
        return
      }
      val text = EditPlanner.displayText(linear)
      var start = caret - 1
      if (start > 0 && start < text.length && Character.isLowSurrogate(text[start]) && Character.isHighSurrogate(text[start - 1])) {
        start -= 1
      }
      edit(start, caret, "")
    }

    private fun edit(start: Int, end: Int, replacement: String) {
      val change = EditPlanner.change(start, end - start, replacement, linear, revision)
      when (val outcome = EditPlanner.plan(change, linear, storedMarks, inputRuleBlockId)) {
        EditPlanner.Outcome.Ignore -> records.add(mapOf("step" to "ignored"))
        EditPlanner.Outcome.UndoInputRule -> undo()
        is EditPlanner.Outcome.Plan -> {
          commit(outcome.plan, "edit")
          if (outcome.plan.storedMarks != storedMarks && replacement in markdownTriggers) {
            storedMarks = outcome.plan.storedMarks
          }
        }
      }
    }

    private fun command(name: String, value: Any?) {
      val collapsed = lower == upper
      val plan = LinearCommands.commandPlan(
        name,
        value,
        linear,
        selection(lower, if (collapsed) "after" else "before"),
        if (collapsed) null else selection(upper, "after"),
        storedMarks,
      )
      storedMarks = plan.storedMarks
      if (plan.collapsedOnly || plan.operations.isEmpty()) {
        records.add(mapOf("step" to "noChange"))
        return
      }
      commit(plan, "command")
    }

    private fun undo() {
      val entry = history.popUndo()
      if (entry == null) {
        records.add(mapOf("step" to "noChange"))
        return
      }
      val operations = entry.beforeSnapshot?.let {
        LinearCommands.contentDiffOps(LinearModel.linearToDocument(linear), LinearModel.linearToDocument(it))
      } ?: entry.inverse
      replay(operations, entry.selectionBefore, "undo")
    }

    private fun redo() {
      val entry = history.popRedo()
      if (entry == null) {
        records.add(mapOf("step" to "noChange"))
        return
      }
      val operations = entry.afterSnapshot?.let {
        LinearCommands.contentDiffOps(LinearModel.linearToDocument(linear), LinearModel.linearToDocument(it))
      } ?: entry.forward
      replay(operations, entry.selectionAfter, "redo")
    }

    private fun replay(operations: List<SchemaOperation>, target: SchemaSelection, kind: String) {
      if (operations.isEmpty()) {
        records.add(mapOf("step" to "noChange"))
        return
      }
      val exists = LinearModel.block(target.nodeId, linear) != null
      commit(EditPlan(operations, storedMarks, false, if (exists) target else null, false), kind, recordUndo = false)
      if (!exists && LinearModel.block(target.nodeId, linear) != null) {
        caret = EditPlanner.displayIndex(target, linear)
        anchor = null
      }
    }

    private fun commit(plan: EditPlan, kind: String, recordUndo: Boolean = true) {
      val before = linear
      val start = selection(lower, "after")
      linear = LinearModel.apply(plan.operations, linear)
      revision += 1
      val inverse = LinearModel.invert(plan.operations, before)
      val after = plan.selectionAfter
      val end = anchor
      when {
        after != null -> {
          caret = EditPlanner.displayIndex(after, linear)
          anchor = null
        }
        end != null -> {
          val length = EditPlanner.displayText(linear).length
          caret = minOf(caret, length)
          anchor = minOf(end, length)
        }
        else -> caret = EditPlanner.displayIndex(start, linear)
      }
      if (recordUndo) {
        history.push(
          UndoEntry(
            transactionId = "",
            forward = plan.operations,
            inverse = inverse ?: emptyList(),
            selectionBefore = start,
            selectionAfter = after ?: start,
            beforeSnapshot = if (inverse == null) before else null,
            afterSnapshot = if (inverse == null) linear else null,
          ),
        )
      }
      inputRuleBlockId = if (plan.isInputRule) after?.nodeId else null
      records.add(
        mapOf(
          "step" to kind,
          "operations" to plan.operations.map { it.toJson() },
          "inverse" to inverse?.map { it.toJson() },
        ),
      )
    }
  }
}
