package app.jot.editor

import android.content.ClipboardManager
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.BitmapDrawable
import android.os.Build
import android.os.Parcel
import android.os.Parcelable
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ImageSpan
import android.text.style.LeadingMarginSpan
import android.text.style.MetricAffectingSpan
import android.text.style.QuoteSpan
import android.text.style.RelativeSizeSpan
import android.text.style.ReplacementSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.text.style.URLSpan
import android.text.style.UnderlineSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.accessibility.AccessibilityNodeInfo
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject

class JotEditorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onReady by EventDispatcher()
  val onCommittedTransaction by EventDispatcher()
  val onSelectionChanged by EventDispatcher()
  val onCompositionChanged by EventDispatcher()
  val onContentSizeChanged by EventDispatcher()
  val onRecoverableError by EventDispatcher()

  private val journal = DurableJournal(context)
  private val composition = CompositionSession()
  private val queuedRemote = ArrayDeque<List<Map<String, Any?>>>()
  private val undoStack = ArrayDeque<HistoryEntry>()
  private val redoStack = ArrayDeque<HistoryEntry>()

  private var document = LinearDocument(docId = JotIds.createId(), blocks = emptyList())
  private var revision = 0
  private var documentId: String = ""
  private var display = DisplayDocument("", emptyList())
  private var storedMarks = listOf<LinearMark>()
  private var readyEmitted = false
  private var internalApply = false
  private var batchDepth = 0
  private var batchBefore: LinearDocument? = null
  private var batchSelection: LinearSelection? = null
  private var batchCommitted = false
  private var lastCanonical: Map<String, Any?>? = null
  private var loadedDocumentId: String = ""
  private var didLoad = false
  private var pendingRestoreSelection: LinearSelection? = null
  private var pendingTransactionId = ""
  private val imagePaths = mutableMapOf<String, String>()

  // Declared after every field it reads: EditText's constructor calls onSelectionChanged,
  // which reaches display, document, and composition before later initializers run.
  private val editText = JotEditText(context)

  init {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    editText.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    editText.gravity = Gravity.TOP or Gravity.START
    editText.setSingleLine(false)
    editText.setHorizontallyScrolling(false)
    editText.background = null
    editText.isSaveEnabled = false
    editText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    editText.inputType = EditorInfo.TYPE_CLASS_TEXT or
      EditorInfo.TYPE_TEXT_FLAG_MULTI_LINE or
      EditorInfo.TYPE_TEXT_FLAG_AUTO_CORRECT or
      EditorInfo.TYPE_TEXT_FLAG_CAP_SENTENCES
    editText.imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI
    addView(editText)
    editText.setOnFocusChangeListener { _, _ -> reportContentSize() }
    editText.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> reportContentSize() }
    editText.accessibilityDelegate = HeadingCheckboxDelegate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (!readyEmitted) {
      readyEmitted = true
      onReady(
        mapOf(
          "capabilities" to mapOf("undo" to true, "redo" to true, "ime" to true),
          "schemaVersion" to SCHEMA_VERSION,
        ),
      )
    }
    reportContentSize()
    requestApplyInsets()
  }

  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    val bottom = if (Build.VERSION.SDK_INT >= 30) {
      insets.getInsets(WindowInsets.Type.ime()).bottom
    } else {
      @Suppress("DEPRECATION")
      insets.systemWindowInsetBottom
    }
    editText.setPadding(editText.paddingLeft, editText.paddingTop, editText.paddingRight, bottom)
    reportContentSize()
    return super.onApplyWindowInsets(insets)
  }

  override fun onSaveInstanceState(): Parcelable {
    val selection = if (document.blocks.isEmpty()) {
      LinearSelection(document.docId, 0, "after", revision)
    } else {
      currentSelection()
    }
    return EditorSavedState(super.onSaveInstanceState(), documentId, revision, selection)
  }

  override fun onRestoreInstanceState(state: Parcelable) {
    if (state !is EditorSavedState) {
      super.onRestoreInstanceState(state)
      return
    }
    super.onRestoreInstanceState(state.superState)
    pendingRestoreSelection = state.selection
    if (state.documentId.isNotEmpty() && documentId.isEmpty()) {
      documentId = state.documentId
    }
    if (didLoad && pendingRestoreSelection != null &&
      LinearModel.findBlockIndex(document, pendingRestoreSelection!!.nodeId) != null
    ) {
      applyLinearSelection(pendingRestoreSelection!!)
      pendingRestoreSelection = null
    }
  }

  fun loadDocument(id: String, canonicalDocument: Map<String, Any?>, schemaVersion: Int, nextRevision: Int) {
    val switching = id != loadedDocumentId
    documentId = id
    loadedDocumentId = id
    revision = nextRevision
    lastCanonical = canonicalDocument
    didLoad = true
    if (schemaVersion != SCHEMA_VERSION) {
      emitError("schema-version", "expected $SCHEMA_VERSION, got $schemaVersion")
    }
    journal.open(id)
    document = LinearModel.fromDocument(canonicalDocument)
    if (switching) {
      undoStack.clear()
      redoStack.clear()
      storedMarks = emptyList()
    }
    replayUnapplied()
    render(restoreSelection = false)
    pendingRestoreSelection?.let { restored ->
      if (LinearModel.findBlockIndex(document, restored.nodeId) != null) {
        applyLinearSelection(restored)
      }
      pendingRestoreSelection = null
    }
    emitSelection()
  }

  fun setDocumentId(value: String) {
    documentId = value
    if (value.isNotEmpty()) {
      journal.open(value)
    }
  }

  fun setSchemaVersion(value: Int) {
    if (value != 0 && value != SCHEMA_VERSION) {
      emitError("schema-version", "expected $SCHEMA_VERSION, got $value")
    }
  }

  fun setRevision(value: Int) {
    revision = value
  }

  fun setCanonicalDocument(value: Map<String, Any?>?) {
    if (value == null) {
      return
    }
    val id = documentId.ifEmpty { JsonMaps.string(value["id"]) }
    if (didLoad && id == loadedDocumentId && deepEquals(lastCanonical, value)) {
      return
    }
    loadDocument(id, value, SCHEMA_VERSION, revision)
  }

  fun listUnappliedIntake(): List<Map<String, Any?>> {
    if (documentId.isNotEmpty()) {
      journal.open(documentId)
    }
    return journal.listUnapplied().map { (transactionId, payload) ->
      mapOf("transactionId" to transactionId, "payload" to payload)
    }
  }

  fun markIntakeApplied(transactionId: String) {
    if (documentId.isNotEmpty()) {
      journal.open(documentId)
    }
    journal.markApplied(transactionId)
  }

  fun applyTransactions(
    id: String,
    baseRevision: Int,
    transactions: List<Map<String, Any?>>,
    origin: String,
  ) {
    if (id.isNotEmpty() && documentId.isNotEmpty() && id != documentId) {
      emitError("document-mismatch", "applyTransactions documentId does not match loaded document")
      return
    }
    val operations = transactions.flatMap { JsonMaps.listOf(JsonMaps.mapOf(it)["operations"]).map { op -> JsonMaps.mapOf(op) } }
    if (composition.active && origin == "remote") {
      queuedRemote.add(operations)
      return
    }
    document = LinearModel.applyOperations(document, operations)
    revision = baseRevision + transactions.size
    render(restoreSelection = true)
    emitSelection()
  }

  fun dispatchCommand(command: Map<String, Any?>) {
    val name = JsonMaps.string(command["name"])
    val selection = currentSelection()
    when (name) {
      "toggleBold" -> toggleMarkCommand("bold", selection)
      "toggleItalic" -> toggleMarkCommand("italic", selection)
      "toggleUnderline" -> toggleMarkCommand("underline", selection)
      "toggleStrikethrough" -> toggleMarkCommand("strikethrough", selection)
      "toggleInlineCode" -> toggleMarkCommand("inlineCode", selection)
      "setHeading" -> commitBlockChange(selection, LinearBlockKind.HEADING, headingLevel = JsonMaps.int(command["level"], 1).coerceIn(1, 6))
      "setParagraph" -> commitBlockChange(selection, LinearBlockKind.PARAGRAPH)
      "toggleBulletList" -> commitToggleList(selection, LinearBlockKind.BULLET_ITEM)
      "toggleOrderedList" -> commitToggleList(selection, LinearBlockKind.ORDERED_ITEM)
      "toggleTaskList" -> commitToggleList(selection, LinearBlockKind.TASK_ITEM)
      "toggleCodeBlock" -> commitToggleList(selection, LinearBlockKind.CODE_BLOCK)
      "toggleTaskItemChecked" -> toggleChecked(selection.nodeId)
      "toggleBlockquote" -> commitPlan(EditorEdits.planToggleBlockquote(document, selection, revision))
      "insertHorizontalRule" -> commitPlan(EditorEdits.planInsertHorizontalRule(document, selection, revision))
      "insertImage" -> insertImageCommand(command, selection)
      "setLink" -> setLinkCommand(command, selection)
      "unsetLink" -> unsetLinkCommand(selection)
      else -> emitError("unknown-command", name)
    }
  }

  fun setSchemaSelection(selection: Map<String, Any?>) {
    val next = LinearModel.parseSelection(selection, revision)
    display = LinearModel.buildDisplay(document)
    val index = LinearModel.displayIndex(document, display, next).coerceIn(0, editText.text?.length ?: 0)
    internalApply = true
    editText.setSelection(index)
    internalApply = false
    emitSelection()
  }

  fun getDocumentSnapshot(): Map<String, Any?> =
    mapOf(
      "canonicalDocument" to LinearModel.toDocument(document),
      "revision" to revision,
    )

  fun focusEditor() {
    editText.requestFocus()
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    imm.showSoftInput(editText, InputMethodManager.SHOW_IMPLICIT)
  }

  fun blurEditor() {
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    imm.hideSoftInputFromWindow(editText.windowToken, 0)
    editText.clearFocus()
  }

  fun undo() {
    val entry = undoStack.removeLastOrNull() ?: return
    if (!journalAndApply(entry.inverse, entry.before, entry.selectionBefore, pushHistory = false)) {
      undoStack.addLast(entry)
      return
    }
    redoStack.addLast(entry)
  }

  fun redo() {
    val entry = redoStack.removeLastOrNull() ?: return
    if (!journalAndApply(entry.operations, entry.after, entry.selectionAfter, pushHistory = false)) {
      redoStack.addLast(entry)
      return
    }
    undoStack.addLast(entry)
  }

  internal fun onBeginBatch() {
    if (batchDepth == 0) {
      batchBefore = document
      batchSelection = currentSelection()
      batchCommitted = false
    }
    batchDepth += 1
  }

  internal fun onEndBatch() {
    batchDepth = (batchDepth - 1).coerceAtLeast(0)
    if (batchDepth > 0 || composition.active || batchCommitted) {
      return
    }
    val before = batchBefore ?: return
    val selection = batchSelection ?: currentSelection()
    batchBefore = null
    batchSelection = null
    val op = netReplace(before, document, selection) ?: return
    val after = document
    val afterSelection = currentSelection()
    if (!appendJournal(listOf(op), afterSelection)) {
      document = before
      render(restoreSelection = true)
      return
    }
    pushHistory(before, after, listOf(op), inverseReplace(op), selection, afterSelection)
    emitCommitted(listOf(op), afterSelection)
  }

  internal fun onSetComposingRegion(start: Int, end: Int) {
    if (composition.active) {
      return
    }
    display = LinearModel.buildDisplay(document)
    val from = LinearModel.selectionFromDisplay(document, display, start, "before", revision)
    val to = LinearModel.selectionFromDisplay(document, display, end, "after", revision)
    composition.begin(from, LinearModel.sliceText(document, from, to))
    onCompositionChanged(mapOf("active" to true))
  }

  internal fun onSetComposingText(text: CharSequence): Boolean {
    if (!composition.active) {
      val selection = currentSelection()
      val original = LinearModel.sliceText(document, selection, selectionEnd())
      composition.begin(selection, original)
      onCompositionChanged(mapOf("active" to true))
    }
    return true
  }

  internal fun onFinishComposingText(apply: () -> Boolean): Boolean {
    return commitComposition(committedText = null, apply = apply)
  }

  internal fun onCommitText(text: CharSequence, apply: () -> Boolean): Boolean {
    val inserted = text.toString()
    if (composition.active) {
      return commitComposition(committedText = inserted, apply = apply)
    }
    if (inserted == "\n" || inserted == "\r\n") {
      if (tryInputRule()) {
        return true
      }
      return commitEnter()
    }
    if (inserted == " " || inserted == "\u00A0") {
      if (tryInputRule()) {
        return true
      }
    }
    if (batchDepth > 0) {
      val ok = apply()
      if (ok) {
        applyPlainInsert(inserted)
      }
      return ok
    }
    val before = document
    document = LinearModel.ensureEditableBlock(document)
    val rawSelection = currentSelection()
    val nodeId = LinearModel.findBlockIndex(document, rawSelection.nodeId)?.let { rawSelection.nodeId }
      ?: document.blocks.first().nodeId
    val selection = rawSelection.copy(nodeId = nodeId)
    val end = selectionEnd().copy(nodeId = nodeId)
    val deleted = LinearModel.sliceText(document, selection, end)
    val op = replaceRangeOp(selection, end, inserted, deleted)
    if (!appendJournal(listOf(op), afterInsert(selection, inserted))) {
      document = before
      return false
    }
    val ok = apply()
    if (ok) {
      document = LinearModel.replaceBlockText(
        document,
        nodeId,
        selection.offsetUtf16,
        end.offsetUtf16,
        inserted,
        storedMarks,
      )
      val afterSelection = afterInsert(selection, inserted)
      pushHistory(before, document, listOf(op), inverseReplace(op), selection, afterSelection)
      restyle()
      emitCommitted(listOf(op), afterSelection)
    } else {
      document = before
      render(restoreSelection = true)
    }
    return ok
  }

  internal fun onDeleteSurrounding(beforeLength: Int, afterLength: Int, apply: () -> Boolean): Boolean {
    if (composition.active) {
      return apply()
    }
    val selection = currentSelection()
    if (selection.offsetUtf16 == 0 && beforeLength > 0 && afterLength == 0) {
      commitBackspaceAtStart()
      return true
    }
    if (batchDepth > 0) {
      val ok = apply()
      if (ok) {
        applyPlainDelete(beforeLength, afterLength)
      }
      return ok
    }
    val block = LinearModel.blockAt(document, selection.nodeId) ?: return false
    val start = (selection.offsetUtf16 - beforeLength).coerceAtLeast(0)
    val end = (selection.offsetUtf16 + afterLength).coerceAtMost(block.text.length)
    val deleted = block.text.substring(start, end)
    val from = selection.copy(offsetUtf16 = start)
    val to = selection.copy(offsetUtf16 = end)
    val op = replaceRangeOp(from, to, "", deleted)
    val afterSelection = from.copy(affinity = "after", revision = revision + 1)
    if (!appendJournal(listOf(op), afterSelection)) {
      return false
    }
    val ok = apply()
    if (ok) {
      val before = document
      document = LinearModel.replaceBlockText(document, selection.nodeId, start, end, "", emptyList())
      pushHistory(before, document, listOf(op), inverseReplace(op), selection, afterSelection)
      restyle()
      emitCommitted(listOf(op), afterSelection)
    }
    return ok
  }

  internal fun onCommitCorrection(oldText: String, newText: String, offset: Int, apply: () -> Boolean): Boolean {
    if (composition.active) {
      return apply()
    }
    val selection = currentSelection()
    val block = LinearModel.blockAt(document, selection.nodeId) ?: return apply()
    val start = offset.coerceIn(0, block.text.length)
    val end = (offset + oldText.length).coerceIn(start, block.text.length)
    val from = selection.copy(offsetUtf16 = start)
    val to = selection.copy(offsetUtf16 = end)
    val op = replaceRangeOp(from, to, newText, oldText)
    val afterSelection = selection.copy(offsetUtf16 = start + newText.length, revision = revision + 1)
    if (!appendJournal(listOf(op), afterSelection)) {
      return false
    }
    val ok = apply()
    if (ok) {
      val before = document
      document = LinearModel.replaceBlockText(document, selection.nodeId, start, end, newText, storedMarks)
      pushHistory(before, document, listOf(op), inverseReplace(op), selection, afterSelection)
      restyle()
      emitCommitted(listOf(op), afterSelection)
    }
    return ok
  }

  internal fun onKeyCommand(keyCode: Int): Boolean {
    if (composition.active) {
      return false
    }
    if (keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
      if (tryInputRule()) {
        return true
      }
      return commitEnter()
    }
    if (keyCode == KeyEvent.KEYCODE_DEL) {
      val selection = currentSelection()
      if (selection.offsetUtf16 == 0 && editText.selectionStart == editText.selectionEnd) {
        return commitBackspaceAtStart()
      }
    }
    return false
  }

  internal fun onPerformEditorAction(actionCode: Int): Boolean {
    if (composition.active) {
      return false
    }
    val enter = actionCode == EditorInfo.IME_ACTION_DONE ||
      actionCode == EditorInfo.IME_ACTION_GO ||
      actionCode == EditorInfo.IME_ACTION_SEND ||
      actionCode == EditorInfo.IME_ACTION_NEXT
    if (!enter) {
      return false
    }
    if (tryInputRule()) {
      return true
    }
    return commitEnter()
  }

  internal fun onInputConnectionClosed() {
    if (!composition.active) {
      return
    }
    composition.cancel()
    render(restoreSelection = true)
    onCompositionChanged(mapOf("active" to false))
    flushRemote()
  }

  internal fun pastePlainText(raw: String) {
    if (composition.active) {
      return
    }
    val inserted = raw.replace("\r\n", "\n").replace('\r', '\n')
    document = LinearModel.ensureEditableBlock(document)
    val from = currentSelection()
    val to = selectionEnd()
    val deleted = LinearModel.sliceText(document, from, to)
    val plan = EditorEdits.planReplace(document, from, to, inserted, deleted, storedMarks, revision)
    journalAndApply(plan.operations, plan.document, plan.selection, pushHistory = true)
  }

  internal fun createEditorInputConnection(outAttrs: EditorInfo, inner: InputConnection?): InputConnection? {
    val target = inner ?: return null
    return JotEditorInputConnection(target, this)
  }

  internal fun onEditorSelectionChanged(start: Int, end: Int) {
    // EditText's constructor reports a selection before this view is attached, when JS cannot
    // receive the event and `editText` itself is not assigned yet.
    if (internalApply || !isAttachedToWindow) {
      return
    }
    clampAwayFromPrefix(start, end)
    if (!composition.active) {
      emitSelection()
    }
  }

  internal fun onCheckboxTap(nodeId: String) {
    toggleChecked(nodeId)
  }

  private fun commitComposition(committedText: String?, apply: () -> Boolean): Boolean {
    if (composition.cancelled) {
      composition.takeCommit()
      onCompositionChanged(mapOf("active" to false))
      flushRemote()
      return apply()
    }
    val composingNow = extractComposingText()
    val session = composition.takeCommit()
    if (session == null) {
      onCompositionChanged(mapOf("active" to false))
      return apply()
    }
    val from = session.from ?: currentSelection()
    val inserted = committedText ?: composingNow ?: session.originalText
    if (inserted == session.originalText) {
      onCompositionChanged(mapOf("active" to false))
      val ok = apply()
      flushRemote()
      return ok
    }
    val to = from.copy(offsetUtf16 = from.offsetUtf16 + session.originalText.length)
    val op = replaceRangeOp(from, to, inserted, session.originalText)
    val afterSelection = from.copy(offsetUtf16 = from.offsetUtf16 + inserted.length, revision = revision + 1)
    if (!appendJournal(listOf(op), afterSelection)) {
      document = LinearModel.replaceBlockText(document, from.nodeId, from.offsetUtf16, to.offsetUtf16, session.originalText, emptyList())
      render(restoreSelection = true)
      onCompositionChanged(mapOf("active" to false))
      return false
    }
    val ok = apply()
    val before = document
    document = LinearModel.replaceBlockText(document, from.nodeId, from.offsetUtf16, to.offsetUtf16, inserted, storedMarks)
    pushHistory(before, document, listOf(op), inverseReplace(op), from, afterSelection)
    restyle()
    emitCommitted(listOf(op), afterSelection)
    onCompositionChanged(mapOf("active" to false))
    flushRemote()
    return ok
  }

  private fun extractComposingText(): String? {
    val editable = editText.text ?: return null
    var start = -1
    var end = -1
    for (span in editable.getSpans(0, editable.length, Any::class.java)) {
      if (editable.getSpanFlags(span) and Spanned.SPAN_COMPOSING == 0) {
        continue
      }
      val spanStart = editable.getSpanStart(span)
      val spanEnd = editable.getSpanEnd(span)
      if (start < 0 || spanStart < start) {
        start = spanStart
      }
      if (spanEnd > end) {
        end = spanEnd
      }
    }
    if (start < 0 || end < start) {
      return null
    }
    return editable.substring(start, end.coerceAtMost(editable.length))
  }

  private fun commitEnter(): Boolean {
    val selection = currentSelection()
    val plan = EditorEdits.planEnter(document, selection, revision) ?: return false
    return journalAndApply(plan.operations, plan.document, plan.selection, pushHistory = true)
  }

  private fun commitBackspaceAtStart(): Boolean {
    val selection = currentSelection()
    val last = undoStack.lastOrNull()
    if (last?.inputRuleNodeId != null && last.inputRuleNodeId == selection.nodeId && selection.offsetUtf16 == 0) {
      undo()
      return true
    }
    val plan = EditorEdits.planBackspaceAtStart(document, selection, revision) ?: return false
    return journalAndApply(plan.operations, plan.document, plan.selection, pushHistory = true)
  }

  private fun tryInputRule(): Boolean {
    val plan = EditorEdits.planInputRule(document, currentSelection(), revision) ?: return false
    return journalAndApply(
      plan.operations,
      plan.document,
      plan.selection,
      pushHistory = true,
      inputRuleNodeId = plan.inputRuleNodeId,
    )
  }

  private fun replayUnapplied() {
    for ((transactionId, payload) in journal.listUnapplied()) {
      try {
        val parsed = EditorEdits.parseIntakePayload(payload)
        if (parsed.operations.isEmpty()) {
          continue
        }
        document = LinearModel.applyOperations(document, parsed.operations)
        revision = parsed.baseRevision + 1
      } catch (error: Exception) {
        emitError("journal-replay-failed", "$transactionId ${error.message ?: ""}")
      }
    }
  }

  private fun toggleMarkCommand(type: String, selection: LinearSelection) {
    val end = selectionEnd()
    if (selection.nodeId == end.nodeId && selection.offsetUtf16 == end.offsetUtf16) {
      storedMarks = if (storedMarks.any { it.type == type }) {
        storedMarks.filterNot { it.type == type }
      } else {
        storedMarks + LinearMark(type)
      }
      emitSelection()
      return
    }
    val before = document
    val next = LinearModel.toggleMark(document, selection, end, type)
    val adding = LinearModel.activeMarks(before, selection).none { it.type == type }
    val range = mapOf("from" to LinearModel.selectionMap(selection), "to" to LinearModel.selectionMap(end))
    val op = if (adding) {
      mapOf("type" to "addMark", "range" to range, "mark" to LinearModel.markToMap(LinearMark(type)))
    } else {
      mapOf("type" to "removeMark", "range" to range, "markType" to type)
    }
    if (!journalAndApply(listOf(op), next, end, pushHistory = true)) {
      document = before
    }
  }

  private fun commitBlockChange(selection: LinearSelection, kind: LinearBlockKind, headingLevel: Int = 1) {
    val next = LinearModel.setBlockKind(document, selection.nodeId, kind, headingLevel = headingLevel)
    val block = LinearModel.blockAt(next, selection.nodeId) ?: return
    val prior = LinearModel.blockAt(document, selection.nodeId)
    val op = mapOf(
      "type" to "setNodeAttributes",
      "nodeId" to block.nodeId,
      "patch" to when (kind) {
        LinearBlockKind.HEADING -> mapOf("level" to headingLevel)
        LinearBlockKind.CODE_BLOCK -> mapOf("languageId" to block.languageId)
        else -> mapOf("type" to "paragraph")
      },
      "priorValues" to mapOf(
        "level" to (prior?.headingLevel ?: 1),
        "languageId" to (prior?.languageId ?: ""),
      ),
    )
    journalAndApply(listOf(op), next, selection, pushHistory = true)
  }

  private fun commitToggleList(selection: LinearSelection, kind: LinearBlockKind) {
    val before = document
    val next = LinearModel.toggleListKind(document, selection.nodeId, kind)
    val afterBlock = LinearModel.blockAt(next, selection.nodeId) ?: return
    val op = mapOf(
      "type" to "setNodeAttributes",
      "nodeId" to afterBlock.nodeId,
      "patch" to mapOf("kind" to afterBlock.kind.name),
      "priorValues" to mapOf("kind" to LinearModel.blockAt(before, selection.nodeId)?.kind?.name),
    )
    journalAndApply(listOf(op), next, selection, pushHistory = true)
  }

  private fun toggleChecked(nodeId: String) {
    val block = LinearModel.blockAt(document, nodeId) ?: return
    if (block.kind != LinearBlockKind.TASK_ITEM) {
      return
    }
    val checked = !block.checked
    val op = mapOf(
      "type" to "setNodeAttributes",
      "nodeId" to (block.listItemId ?: block.nodeId),
      "patch" to mapOf("checked" to if (checked) 1 else 0),
      "priorValues" to mapOf("checked" to if (block.checked) 1 else 0),
    )
    val next = LinearModel.setChecked(document, nodeId, checked)
    journalAndApply(listOf(op), next, currentSelection(), pushHistory = true)
  }

  private fun commitPlan(plan: EditPlan) {
    if (plan.operations.isEmpty()) {
      return
    }
    journalAndApply(plan.operations, plan.document, plan.selection, pushHistory = true)
  }

  private fun insertImageCommand(command: Map<String, Any?>, selection: LinearSelection) {
    val attachmentId = JsonMaps.string(command["attachmentId"]).ifEmpty { JotIds.createId() }
    val alt = JsonMaps.string(command["alt"])
    val path = JsonMaps.string(command["path"])
    if (path.isNotEmpty()) {
      imagePaths[attachmentId] = path
    }
    commitPlan(EditorEdits.planInsertImage(document, selection, attachmentId, alt, revision))
  }

  private fun setLinkCommand(command: Map<String, Any?>, selection: LinearSelection) {
    val href = JsonMaps.string(command["href"])
    val title = JsonMaps.string(command["title"])
    if (!LinearModel.isAllowedHref(href)) {
      emitError("invalid-href", href)
      return
    }
    val end = selectionEnd()
    if (selection.nodeId == end.nodeId && selection.offsetUtf16 == end.offsetUtf16) {
      storedMarks = storedMarks.filterNot { it.type == "link" } + LinearMark("link", mapOf("href" to href, "title" to title))
      emitSelection()
      return
    }
    val plan = EditorEdits.planSetLink(document, selection, end, href, title, revision) ?: return
    commitPlan(plan)
  }

  private fun unsetLinkCommand(selection: LinearSelection) {
    val end = selectionEnd()
    if (selection.nodeId == end.nodeId && selection.offsetUtf16 == end.offsetUtf16) {
      storedMarks = storedMarks.filterNot { it.type == "link" }
      emitSelection()
      return
    }
    commitPlan(EditorEdits.planUnsetLink(document, selection, end, revision))
  }

  private fun journalAndApply(
    operations: List<Map<String, Any?>>,
    next: LinearDocument,
    selection: LinearSelection,
    pushHistory: Boolean,
    inputRuleNodeId: String? = null,
  ): Boolean {
    val afterSelection = selection.copy(revision = revision + 1)
    if (!appendJournal(operations, afterSelection)) {
      return false
    }
    val before = document
    document = next
    if (batchDepth > 0) {
      batchCommitted = true
      batchBefore = document
    }
    if (pushHistory) {
      val inverse = operations.map { inverseOp(it) }
      pushHistory(before, next, operations, inverse, currentSelection(), afterSelection, inputRuleNodeId)
    }
    render(restoreSelection = true)
    emitCommitted(operations, afterSelection)
    return true
  }

  private fun appendJournal(operations: List<Map<String, Any?>>, selection: LinearSelection): Boolean {
    journal.open(documentId.ifEmpty { document.docId })
    val transactionId = JotIds.createId()
    val body = JSONObject().apply {
      put("transactionId", transactionId)
      put("baseRevision", revision)
      put("operations", toJson(operations))
      put("selection", toJson(LinearModel.selectionMap(selection)))
    }.toString()
    if (!journal.append(transactionId, body)) {
      emitError("journal-append-failed", transactionId)
      return false
    }
    pendingTransactionId = transactionId
    if (batchDepth > 0) {
      batchCommitted = true
      batchBefore = document
    }
    return true
  }

  private fun emitCommitted(operations: List<Map<String, Any?>>, selection: LinearSelection) {
    revision += 1
    onCommittedTransaction(
      mapOf(
        "transactionId" to pendingTransactionId.ifEmpty { JotIds.createId() },
        "baseRevision" to (revision - 1),
        "operations" to operations,
        "selection" to LinearModel.selectionMap(selection.copy(revision = revision)),
      ),
    )
    pendingTransactionId = ""
    emitSelection()
    reportContentSize()
  }

  private fun emitSelection() {
    val selection = currentSelection()
    storedMarks = LinearModel.activeMarks(document, selection).ifEmpty { storedMarks }
    onSelectionChanged(
      mapOf(
        "selection" to LinearModel.selectionMap(selection),
        "activeMarks" to storedMarks.map { LinearModel.markToMap(it) },
      ),
    )
  }

  private fun applyLinearSelection(selection: LinearSelection) {
    display = LinearModel.buildDisplay(document)
    val index = LinearModel.displayIndex(document, display, selection).coerceIn(0, editText.length())
    internalApply = true
    editText.setSelection(index)
    internalApply = false
  }

  private fun deepEquals(left: Any?, right: Any?): Boolean {
    return when {
      left === right -> true
      left is Map<*, *> && right is Map<*, *> -> {
        if (left.size != right.size) {
          false
        } else {
          left.keys.all { key -> deepEquals(left[key], right[key]) }
        }
      }
      left is List<*> && right is List<*> -> {
        left.size == right.size && left.indices.all { deepEquals(left[it], right[it]) }
      }
      left is Number && right is Number -> left.toDouble() == right.toDouble()
      else -> left == right
    }
  }

  private fun emitError(code: String, contextText: String) {
    onRecoverableError(mapOf("code" to code, "context" to contextText))
  }

  private fun currentSelection(): LinearSelection {
    if (document.blocks.isEmpty()) {
      return LinearSelection(document.docId, 0, "after", revision)
    }
    display = LinearModel.buildDisplay(document)
    val start = editText.selectionStart.coerceAtLeast(0)
    return LinearModel.selectionFromDisplay(document, display, start, "after", revision)
  }

  private fun selectionEnd(): LinearSelection {
    display = LinearModel.buildDisplay(document)
    val end = editText.selectionEnd.coerceAtLeast(0)
    return LinearModel.selectionFromDisplay(document, display, end, "before", revision)
  }

  private fun afterInsert(selection: LinearSelection, inserted: String): LinearSelection {
    val nodeId = selection.nodeId.ifEmpty {
      LinearModel.ensureEditableBlock(document).blocks.first().nodeId
    }
    return LinearSelection(nodeId, selection.offsetUtf16 + inserted.length, "after", revision + 1)
  }

  private fun applyPlainInsert(text: String) {
    val selection = currentSelection()
    document = LinearModel.ensureEditableBlock(document)
    val nodeId = selection.nodeId.ifEmpty { document.blocks.first().nodeId }
    document = LinearModel.replaceBlockText(document, nodeId, selection.offsetUtf16, selectionEnd().offsetUtf16, text, storedMarks)
  }

  private fun applyPlainDelete(beforeLength: Int, afterLength: Int) {
    val selection = currentSelection()
    val block = LinearModel.blockAt(document, selection.nodeId) ?: return
    val start = (selection.offsetUtf16 - beforeLength).coerceAtLeast(0)
    val end = (selection.offsetUtf16 + afterLength).coerceAtMost(block.text.length)
    document = LinearModel.replaceBlockText(document, selection.nodeId, start, end, "", emptyList())
  }

  private fun replaceRangeOp(from: LinearSelection, to: LinearSelection, inserted: String, deleted: String): Map<String, Any?> {
    val parent = from.nodeId.ifEmpty { document.docId }
    return mapOf(
      "type" to "replaceRange",
      "from" to LinearModel.selectionMap(from),
      "to" to LinearModel.selectionMap(to),
      "slice" to mapOf("nodes" to listOf(LinearModel.textSliceNode(inserted, storedMarks, parent))),
      "deletedSlice" to mapOf("nodes" to listOf(LinearModel.textSliceNode(deleted, emptyList(), parent))),
    )
  }

  private fun inverseReplace(op: Map<String, Any?>): List<Map<String, Any?>> {
    val from = LinearModel.parseSelection(op["from"], revision)
    val inserted = JsonMaps.string(JsonMaps.mapOf(JsonMaps.listOf(JsonMaps.mapOf(op["slice"])["nodes"]).firstOrNull())["text"])
    val deleted = JsonMaps.string(JsonMaps.mapOf(JsonMaps.listOf(JsonMaps.mapOf(op["deletedSlice"])["nodes"]).firstOrNull())["text"])
    val inverseTo = from.copy(offsetUtf16 = from.offsetUtf16 + inserted.length)
    return listOf(replaceRangeOp(from, inverseTo, deleted, inserted))
  }

  private fun inverseOp(op: Map<String, Any?>): Map<String, Any?> {
    return when (JsonMaps.string(op["type"])) {
      "replaceRange" -> inverseReplace(op).first()
      "addMark" -> mapOf(
        "type" to "removeMark",
        "range" to op["range"],
        "markType" to JsonMaps.string(JsonMaps.mapOf(op["mark"])["type"]),
      )
      "removeMark" -> mapOf(
        "type" to "addMark",
        "range" to op["range"],
        "mark" to mapOf("type" to JsonMaps.string(op["markType"])),
      )
      "setNodeAttributes" -> mapOf(
        "type" to "setNodeAttributes",
        "nodeId" to op["nodeId"],
        "patch" to op["priorValues"],
        "priorValues" to op["patch"],
      )
      "insertNode" -> mapOf("type" to "deleteNode", "nodeId" to JsonMaps.string(JsonMaps.mapOf(op["node"])["id"]), "deletedNode" to op["node"])
      "deleteNode" -> mapOf(
        "type" to "insertNode",
        "parentId" to document.docId,
        "index" to 0,
        "node" to op["deletedNode"],
      )
      "insertText" -> mapOf(
        "type" to "deleteRange",
        "from" to op["position"],
        "to" to LinearModel.selectionMap(
          LinearModel.parseSelection(op["position"], revision).let {
            it.copy(offsetUtf16 = it.offsetUtf16 + JsonMaps.string(op["text"]).length)
          },
        ),
        "deletedSlice" to mapOf("nodes" to listOf(LinearModel.textSliceNode(JsonMaps.string(op["text"]), emptyList(), JsonMaps.string(JsonMaps.mapOf(op["position"])["nodeId"])))),
      )
      else -> op
    }
  }

  private fun netReplace(before: LinearDocument, after: LinearDocument, selection: LinearSelection): Map<String, Any?>? {
    val beforeBlock = LinearModel.blockAt(before, selection.nodeId) ?: return null
    val afterBlock = LinearModel.blockAt(after, selection.nodeId) ?: return null
    if (beforeBlock.text == afterBlock.text) {
      return null
    }
    val left = beforeBlock.text
    val right = afterBlock.text
    var prefix = 0
    while (prefix < left.length && prefix < right.length && left[prefix] == right[prefix]) {
      prefix += 1
    }
    var suffix = 0
    while (prefix + suffix < left.length && prefix + suffix < right.length &&
      left[left.length - 1 - suffix] == right[right.length - 1 - suffix]
    ) {
      suffix += 1
    }
    val from = selection.copy(offsetUtf16 = prefix)
    val to = selection.copy(offsetUtf16 = left.length - suffix)
    val inserted = right.substring(prefix, right.length - suffix)
    val deleted = left.substring(prefix, left.length - suffix)
    return replaceRangeOp(from, to, inserted, deleted)
  }

  private fun pushHistory(
    before: LinearDocument,
    after: LinearDocument,
    operations: List<Map<String, Any?>>,
    inverse: List<Map<String, Any?>>,
    selectionBefore: LinearSelection,
    selectionAfter: LinearSelection,
    inputRuleNodeId: String? = null,
  ) {
    undoStack.addLast(HistoryEntry(before, after, operations, inverse, selectionBefore, selectionAfter, inputRuleNodeId))
    redoStack.clear()
  }

  private fun flushRemote() {
    while (queuedRemote.isNotEmpty()) {
      document = LinearModel.applyOperations(document, queuedRemote.removeFirst())
    }
    render(restoreSelection = true)
  }

  private fun render(restoreSelection: Boolean) {
    val selection = if (restoreSelection) currentSelection() else null
    display = LinearModel.buildDisplay(document)
    val spanned = SpannableStringBuilder(display.text)
    applyPresentation(spanned)
    internalApply = true
    val start = editText.selectionStart
    val end = editText.selectionEnd
    editText.setText(spanned)
    if (restoreSelection && selection != null) {
      val index = LinearModel.displayIndex(document, display, selection).coerceIn(0, spanned.length)
      editText.setSelection(index)
    } else {
      val clampedStart = start.coerceIn(0, spanned.length)
      val clampedEnd = end.coerceIn(0, spanned.length)
      editText.setSelection(clampedStart, clampedEnd)
    }
    internalApply = false
    reportContentSize()
  }

  private fun restyle() {
    val editable = editText.text as? Spannable ?: return
    display = LinearModel.buildDisplay(document)
    applyPresentation(editable)
  }

  private fun applyPresentation(spanned: Spannable) {
    val flags = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
    display.blocks.forEachIndexed { _, layout ->
      val block = document.blocks[layout.blockIndex]
      if (layout.end <= layout.start || layout.end > spanned.length) {
        return@forEachIndexed
      }
      when (block.kind) {
        LinearBlockKind.HEADING -> {
          spanned.setSpan(HeadingSpan(block.headingLevel), layout.textStart, layout.end.coerceAtLeast(layout.textStart), flags)
          spanned.setSpan(RelativeSizeSpan(headingScale(block.headingLevel)), layout.textStart, layout.end.coerceAtLeast(layout.textStart), flags)
          if (block.headingLevel <= 3) {
            spanned.setSpan(StyleSpan(Typeface.BOLD), layout.textStart, layout.end.coerceAtLeast(layout.textStart), flags)
          }
        }
        LinearBlockKind.CODE_BLOCK ->
          spanned.setSpan(TypefaceSpan("monospace"), layout.start, layout.end, flags)
        LinearBlockKind.BLOCKQUOTE ->
          spanned.setSpan(QuoteSpan(), layout.start, layout.end, flags)
        LinearBlockKind.BULLET_ITEM, LinearBlockKind.ORDERED_ITEM ->
          spanned.setSpan(MarkerSpan(block.indent, block.kind, block.orderedIndex), layout.start, layout.end, flags)
        LinearBlockKind.TASK_ITEM -> {
          spanned.setSpan(MarkerSpan(block.indent, block.kind, 0), layout.start, layout.end, flags)
          if (layout.prefixChars > 0 && layout.textStart <= spanned.length) {
            spanned.setSpan(
              CheckboxSpan(block.listItemId ?: block.nodeId, block.checked),
              layout.start,
              (layout.start + 1).coerceAtMost(spanned.length),
              flags,
            )
          }
        }
        LinearBlockKind.ATOMIC -> applyAtomicSpan(spanned, block, layout, flags)
        LinearBlockKind.PARAGRAPH -> Unit
      }
      if (LinearModel.isQuoted(block) && block.kind != LinearBlockKind.BLOCKQUOTE) {
        spanned.setSpan(QuoteSpan(), layout.start, layout.end, flags)
      }
      for (run in block.runs) {
        val start = (layout.textStart + run.startUtf16).coerceIn(layout.textStart, layout.end)
        val end = (layout.textStart + run.endUtf16).coerceIn(start, layout.end)
        if (start >= end) {
          continue
        }
        if (run.marks.any { it.type == "bold" }) {
          spanned.setSpan(StyleSpan(Typeface.BOLD), start, end, flags)
        }
        if (run.marks.any { it.type == "italic" }) {
          spanned.setSpan(StyleSpan(Typeface.ITALIC), start, end, flags)
        }
        if (run.marks.any { it.type == "underline" }) {
          spanned.setSpan(UnderlineSpan(), start, end, flags)
        }
        if (run.marks.any { it.type == "strikethrough" }) {
          spanned.setSpan(StrikethroughSpan(), start, end, flags)
        }
        if (run.marks.any { it.type == "inlineCode" }) {
          spanned.setSpan(TypefaceSpan("monospace"), start, end, flags)
        }
        val link = run.marks.firstOrNull { it.type == "link" }
        if (link != null) {
          val href = JsonMaps.string(link.attrs["href"])
          if (LinearModel.isAllowedHref(href)) {
            spanned.setSpan(URLSpan(href), start, end, flags)
          }
        }
      }
    }
  }

  private fun applyAtomicSpan(spanned: Spannable, block: LinearBlock, layout: BlockDisplay, flags: Int) {
    val start = layout.start
    val end = layout.end.coerceAtLeast(layout.start + 1).coerceAtMost(spanned.length)
    if (start >= end) {
      return
    }
    val type = JsonMaps.string(block.atomicNode?.get("type"), "block")
    val attrs = JsonMaps.mapOf(block.atomicNode?.get("attrs"))
    when (type) {
      "horizontalRule" -> spanned.setSpan(DividerSpan(), start, end, flags)
      "image" -> {
        val alt = JsonMaps.string(attrs["alt"])
        val attachmentId = JsonMaps.string(attrs["attachmentId"])
        val path = imagePaths[attachmentId]
        val imageSpan = if (!path.isNullOrEmpty()) loadImageSpan(path, alt) else null
        spanned.setSpan(imageSpan ?: ImagePlaceholderSpan(alt), start, end, flags)
      }
      else -> spanned.setSpan(AtomicBlockSpan(type), start, end, flags)
    }
  }

  private fun loadImageSpan(path: String, alt: String): ReplacementSpan? {
    val bitmap = BitmapFactory.decodeFile(path) ?: return null
    val maxW = editText.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels.coerceAtLeast(48)
    val maxDisplay = (maxW * 0.9f).toInt().coerceAtLeast(48)
    val drawable = if (bitmap.width > maxDisplay) {
      val height = (bitmap.height * (maxDisplay.toFloat() / bitmap.width)).toInt().coerceAtLeast(1)
      val scaled = android.graphics.Bitmap.createScaledBitmap(bitmap, maxDisplay, height, true)
      BitmapDrawable(resources, scaled)
    } else {
      BitmapDrawable(resources, bitmap)
    }
    drawable.setBounds(0, 0, drawable.intrinsicWidth.coerceAtLeast(1), drawable.intrinsicHeight.coerceAtLeast(1))
    return JotImageSpan(drawable, alt)
  }

  private fun headingScale(level: Int): Float =
    when (level) {
      1 -> 1.8f
      2 -> 1.5f
      3 -> 1.3f
      4 -> 1.15f
      5 -> 1.05f
      else -> 1.0f
    }

  private fun clampAwayFromPrefix(start: Int, end: Int) {
    val layout = display.blocks.lastOrNull { start >= it.start } ?: return
    val block = document.blocks.getOrNull(layout.blockIndex) ?: return
    if (block.kind == LinearBlockKind.ATOMIC) {
      return
    }
    val min = layout.textStart
    if (start < min || end < min) {
      internalApply = true
      editText.setSelection(min.coerceIn(0, editText.length()), min.coerceIn(0, editText.length()))
      internalApply = false
    }
  }

  private fun reportContentSize() {
    val height = editText.height.coerceAtLeast(editText.layout?.height ?: 0)
    onContentSizeChanged(mapOf("height" to height))
  }

  private fun toJson(value: Any?): Any {
    return when (value) {
      null -> JSONObject.NULL
      is Map<*, *> -> JSONObject().also { json ->
        for ((key, nested) in value) {
          json.put(key.toString(), toJson(nested))
        }
      }
      is List<*> -> JSONArray().also { json ->
        for (item in value) {
          json.put(toJson(item))
        }
      }
      else -> value
    }
  }

  private fun linkPrefix(linked: Boolean): String = if (linked) "Link. " else ""

  private inner class HeadingCheckboxDelegate : View.AccessibilityDelegate() {
    override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
      super.onInitializeAccessibilityNodeInfo(host, info)
      val selection = currentSelection()
      val block = LinearModel.blockAt(document, selection.nodeId)
      val plain = block?.text ?: ""
      info.text = plain
      val marks = LinearModel.activeMarks(document, selection)
      val linked = marks.any { it.type == "link" }
      when (block?.kind) {
        LinearBlockKind.HEADING -> {
          info.isHeading = true
          info.contentDescription = linkPrefix(linked) + "Heading ${block.headingLevel}. $plain"
        }
        LinearBlockKind.TASK_ITEM -> {
          info.isCheckable = true
          info.isChecked = block.checked
          if (linked) {
            info.contentDescription = linkPrefix(true) + plain
          }
        }
        LinearBlockKind.ATOMIC -> {
          val type = JsonMaps.string(block.atomicNode?.get("type"), "block")
          val attrs = JsonMaps.mapOf(block.atomicNode?.get("attrs"))
          info.contentDescription = linkPrefix(linked) + when (type) {
            "horizontalRule" -> "Divider"
            "image" -> JsonMaps.string(attrs["alt"]).ifEmpty { "Image" }
            else -> type
          }
        }
        else -> {
          if (linked) {
            info.contentDescription = linkPrefix(true) + plain
          }
        }
      }
    }
  }

  private inner class JotEditText(context: Context) : EditText(context) {
    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
      return createEditorInputConnection(outAttrs, super.onCreateInputConnection(outAttrs))
    }

    override fun onSelectionChanged(selStart: Int, selEnd: Int) {
      super.onSelectionChanged(selStart, selEnd)
      onEditorSelectionChanged(selStart, selEnd)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
      if (event.isCtrlPressed || event.isMetaPressed || event.isAltPressed) {
        return super.onKeyDown(keyCode, event)
      }
      if (onKeyCommand(keyCode)) {
        return true
      }
      if (keyCode == KeyEvent.KEYCODE_DEL || keyCode == KeyEvent.KEYCODE_FORWARD_DEL) {
        val before = if (keyCode == KeyEvent.KEYCODE_DEL) 1 else 0
        val after = if (keyCode == KeyEvent.KEYCODE_FORWARD_DEL) 1 else 0
        return onDeleteSurrounding(before, after) { super.onKeyDown(keyCode, event) }
      }
      val unicode = event.unicodeChar
      if (event.deviceId > 0 && unicode != 0 && !Character.isISOControl(unicode)) {
        return onCommitText(unicode.toChar().toString()) { super.onKeyDown(keyCode, event) }
      }
      return super.onKeyDown(keyCode, event)
    }

    override fun onTextContextMenuItem(id: Int): Boolean {
      if (id == android.R.id.paste || id == android.R.id.pasteAsPlainText) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val item = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)
        val text = item?.text?.toString()
        if (text != null) {
          pastePlainText(text)
          return true
        }
        return true
      }
      return super.onTextContextMenuItem(id)
    }

    override fun onReceiveContent(payload: android.view.ContentInfo): android.view.ContentInfo? {
      val clip = payload.clip
      val text = if (clip.itemCount > 0) clip.getItemAt(0).text?.toString() else null
      if (!text.isNullOrEmpty()) {
        pastePlainText(text)
      }
      return null
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
      if (event.action == MotionEvent.ACTION_UP) {
        val offset = getOffsetForPosition(event.x, event.y)
        val spanned = text
        if (spanned is Spanned) {
          val boxes = spanned.getSpans(offset, offset, CheckboxSpan::class.java)
          if (boxes.isNotEmpty()) {
            onCheckboxTap(boxes[0].nodeId)
            return true
          }
        }
      }
      return super.onTouchEvent(event)
    }
  }

  private data class HistoryEntry(
    val before: LinearDocument,
    val after: LinearDocument,
    val operations: List<Map<String, Any?>>,
    val inverse: List<Map<String, Any?>>,
    val selectionBefore: LinearSelection,
    val selectionAfter: LinearSelection,
    val inputRuleNodeId: String? = null,
  )
}

internal class EditorSavedState : View.BaseSavedState {
  var documentId: String = ""
  var revision: Int = 0
  var nodeId: String = ""
  var offsetUtf16: Int = 0
  var affinity: String = "after"

  constructor(superState: Parcelable?) : super(superState)

  constructor(source: Parcel) : super(source) {
    documentId = source.readString() ?: ""
    revision = source.readInt()
    nodeId = source.readString() ?: ""
    offsetUtf16 = source.readInt()
    affinity = source.readString() ?: "after"
  }

  constructor(superState: Parcelable?, documentId: String, revision: Int, selection: LinearSelection) : super(superState) {
    this.documentId = documentId
    this.revision = revision
    this.nodeId = selection.nodeId
    this.offsetUtf16 = selection.offsetUtf16
    this.affinity = selection.affinity
  }

  val selection: LinearSelection
    get() = LinearSelection(nodeId, offsetUtf16, affinity, revision)

  override fun writeToParcel(out: Parcel, flags: Int) {
    super.writeToParcel(out, flags)
    out.writeString(documentId)
    out.writeInt(revision)
    out.writeString(nodeId)
    out.writeInt(offsetUtf16)
    out.writeString(affinity)
  }

  companion object {
    @JvmField
    val CREATOR = object : Parcelable.Creator<EditorSavedState> {
      override fun createFromParcel(source: Parcel): EditorSavedState = EditorSavedState(source)
      override fun newArray(size: Int): Array<EditorSavedState?> = arrayOfNulls(size)
    }
  }
}

internal class HeadingSpan(val level: Int) : MetricAffectingSpan() {
  override fun updateDrawState(tp: android.text.TextPaint?) {
    tp?.isFakeBoldText = level <= 3
  }

  override fun updateMeasureState(textPaint: android.text.TextPaint) {
    textPaint.isFakeBoldText = level <= 3
  }
}

internal class MarkerSpan(
  private val indent: Int,
  private val kind: LinearBlockKind,
  private val index: Int,
) : LeadingMarginSpan {
  override fun getLeadingMargin(first: Boolean): Int = (indent + 1) * 48

  override fun drawLeadingMargin(
    canvas: Canvas,
    paint: Paint,
    x: Int,
    dir: Int,
    top: Int,
    baseline: Int,
    bottom: Int,
    text: CharSequence?,
    start: Int,
    end: Int,
    first: Boolean,
    layout: android.text.Layout?,
  ) {
    if (!first || kind == LinearBlockKind.TASK_ITEM) {
      return
    }
    val label = if (kind == LinearBlockKind.ORDERED_ITEM) "$index." else "•"
    canvas.drawText(label, (x + dir * (indent * 48 + 8)).toFloat(), baseline.toFloat(), paint)
  }
}

internal class CheckboxSpan(val nodeId: String, private val checked: Boolean) : ReplacementSpan() {
  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    return (paint.textSize * 1.2f).toInt()
  }

  override fun draw(
    canvas: Canvas,
    text: CharSequence?,
    start: Int,
    end: Int,
    x: Float,
    top: Int,
    y: Int,
    bottom: Int,
    paint: Paint,
  ) {
    val size = paint.textSize
    val mark = if (checked) "☑" else "☐"
    canvas.drawText(mark, x, y.toFloat(), paint)
    paint.textSize = size
  }
}

internal class AtomicBlockSpan(private val nodeType: String) : ReplacementSpan() {
  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    return paint.measureText("[$nodeType]").toInt().coerceAtLeast(24)
  }

  override fun draw(
    canvas: Canvas,
    text: CharSequence?,
    start: Int,
    end: Int,
    x: Float,
    top: Int,
    y: Int,
    bottom: Int,
    paint: Paint,
  ) {
    canvas.drawText("[$nodeType]", x, y.toFloat(), paint)
  }
}

internal class DividerSpan : ReplacementSpan() {
  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    return paint.measureText("────────").toInt().coerceAtLeast(48)
  }

  override fun draw(
    canvas: Canvas,
    text: CharSequence?,
    start: Int,
    end: Int,
    x: Float,
    top: Int,
    y: Int,
    bottom: Int,
    paint: Paint,
  ) {
    val mid = ((top + bottom) / 2).toFloat()
    canvas.drawLine(x, mid, x + getSize(paint, text, start, end, null), mid, paint)
  }
}

internal class ImagePlaceholderSpan(val alt: String) : ReplacementSpan() {
  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    val label = alt.ifEmpty { "Image" }
    return paint.measureText(label).toInt().coerceAtLeast(48)
  }

  override fun draw(
    canvas: Canvas,
    text: CharSequence?,
    start: Int,
    end: Int,
    x: Float,
    top: Int,
    y: Int,
    bottom: Int,
    paint: Paint,
  ) {
    canvas.drawText(alt.ifEmpty { "Image" }, x, y.toFloat(), paint)
  }
}

internal class JotImageSpan(drawable: android.graphics.drawable.Drawable, val alt: String) : ImageSpan(drawable)
