package app.jot.editor

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.text.Editable
import android.text.Selection
import android.text.TextWatcher
import android.util.Log
import android.util.TypedValue
import android.view.ContentInfo
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.OnReceiveContentListener
import android.view.ScaleGestureDetector
import android.view.ViewConfiguration
import android.view.WindowInsets
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.webkit.MimeTypeMap
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Android editor. `EditText` shows `EditPlanner.displayText` for the document. The keyboard edits the
 * text directly; each change is read back as one replaced range, planned by `EditPlanner` exactly as
 * `JotEditorView.swift` plans it, journaled, applied to the model, and then the view is brought back
 * in line with the model: styles for the changed blocks, and text only where the plan changed it.
 * Keyboard composition is never planned until it finishes.
 */
class JotEditorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onReady by EventDispatcher()
  val onCommittedTransaction by EventDispatcher()
  val onSelectionChanged by EventDispatcher()
  val onCompositionChanged by EventDispatcher()
  val onContentSizeChanged by EventDispatcher()
  val onFocusChanged by EventDispatcher()
  val onImagePressed by EventDispatcher()
  val onPasteRequested by EventDispatcher()
  val onRecoverableError by EventDispatcher()

  override val shouldUseAndroidLayout: Boolean
    get() = true

  private val journal = DurableJournal(context)
  private val history = UndoStack()
  private val imagePaths = mutableMapOf<String, String>()
  private val imageWidthOverrides = mutableMapOf<String, Int>()
  private val queuedRemote = ArrayDeque<List<SchemaOperation>>()
  private val inputMethods = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
  private var linear = LinearDocument(JotIds.createId(), emptyList())
  private var documentId = ""
  private var revision = 0

  /** Start of the selection. `anchor` is its end when a range is selected. */
  private var selection = SchemaSelection("", 0, "before", 0)
  private var anchor: SchemaSelection? = null
  private var storedMarks: List<LinearMark> = emptyList()
  private var inputRuleBlockId: String? = null

  /** Journal rows already in the next loaded document. Replaying them would apply the edit twice. */
  private var committedElsewhere: Set<String> = emptySet()

  /** The text the document renders to. The editable differs from it only while an edit is pending. */
  private var committedText = ""
  private var touchedStart = Int.MAX_VALUE
  private var composing = false
  private var pasting = false
  private var applying = false
  private var viewReady = false
  private var readyEmitted = false
  private var hasLoaded = false
  private var boundDocumentId = ""
  private var lastCanonical = ""
  private var attachmentsDirectory: File? = null
  private var accentOverride: Int? = null
  private var theme = EditorTheme(context, null)
  private var contentWidth = 0
  private var keyboardOverlap = 0
  private var keyboardHeight = 0
  private var lastReportedHeight = -1f
  private var pinch: Pinch? = null

  // Declared after every field it reads: EditText's constructor reports a selection change.
  private val editText = JotEditText(context)

  init {
    addView(editText, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    editText.gravity = Gravity.TOP or Gravity.START
    editText.background = null
    editText.isSaveEnabled = false
    editText.setHorizontallyScrolling(false)
    editText.inputType = EditorInfo.TYPE_CLASS_TEXT or
      EditorInfo.TYPE_TEXT_FLAG_MULTI_LINE or
      EditorInfo.TYPE_TEXT_FLAG_AUTO_CORRECT or
      EditorInfo.TYPE_TEXT_FLAG_CAP_SENTENCES
    editText.imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI or EditorInfo.IME_FLAG_NO_ENTER_ACTION
    editText.addTextChangedListener(Watcher())
    editText.setOnFocusChangeListener { _, focused ->
      if (!focused) {
        flushEditable()
      }
      onFocusChanged(mapOf("focused" to focused))
    }
    editText.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> reportContentSize() }
    if (Build.VERSION.SDK_INT >= 31) {
      editText.setOnReceiveContentListener(
        arrayOf("image/*"),
        OnReceiveContentListener { _, payload: ContentInfo ->
          val clip = payload.clip
          val image: ClipData.Item? = (0 until clip.itemCount).map { clip.getItemAt(it) }.firstOrNull { it.uri != null }
          if (image == null) {
            payload
          } else {
            receiveImage(image.uri)
            null
          }
        },
      )
    }
    applyTheme()
    viewReady = true
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
    requestApplyInsets()
  }

  override fun onDetachedFromWindow() {
    flushEditable()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    updatePadding()
    reportContentSize()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyTheme()
    if (hasLoaded) {
      renderAll()
    }
  }

  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    keyboardHeight = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.ime()).bottom else legacyBottomInset(insets)
    updateKeyboardOverlap()
    return super.onApplyWindowInsets(insets)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    if (changed) {
      updateKeyboardOverlap()
    }
  }

  /**
   * Pads only the part of this view the keyboard still covers. The keyboard appears before React
   * Native shrinks the screen for it, so the overlap is measured again after every layout; a stale
   * overlap left a large bottom padding that clipped the text.
   */
  private fun updateKeyboardOverlap() {
    val location = IntArray(2)
    getLocationInWindow(location)
    val overlap = if (keyboardHeight > 0) max(0, location[1] + height - (rootView.height - keyboardHeight)) else 0
    if (overlap != keyboardOverlap) {
      keyboardOverlap = overlap
      updatePadding()
    }
  }

  @Suppress("DEPRECATION")
  private fun legacyBottomInset(insets: WindowInsets): Int = insets.systemWindowInsetBottom

  // Props

  fun setDocumentId(value: String) {
    documentId = value
  }

  fun setSchemaVersion(value: Int) {
    if (value != 0 && value != SCHEMA_VERSION) {
      emitError("schema_version", "expected $SCHEMA_VERSION, got $value")
    }
  }

  fun setRevision(value: Int) {
    revision = value
  }

  fun setAttachmentsDirectory(value: String?) {
    val next = value?.removePrefix("file://")?.let { File(Uri.decode(it)) }
    if (next == attachmentsDirectory) {
      return
    }
    attachmentsDirectory = next
    if (hasLoaded) {
      renderAll()
    }
  }

  fun setPlaceholder(value: String?) {
    editText.hint = value ?: ""
  }

  fun setAccentColor(value: String?) {
    val hex = value?.removePrefix("#") ?: return
    if (hex.length != 6) {
      return
    }
    val parsed = hex.toLongOrNull(16) ?: return
    accentOverride = (0xFF000000 or parsed).toInt()
    applyTheme()
    if (hasLoaded) {
      renderAll()
    }
  }

  fun setCanonicalDocument(value: Map<String, Any?>?) {
    if (value == null) {
      return
    }
    val node = SchemaNode.parse(value)
    val id = documentId.ifEmpty { node.id }
    if (hasLoaded && id == boundDocumentId && CanonicalJson.stringify(node.toJson()) == lastCanonical) {
      return
    }
    loadDocument(id, value, SCHEMA_VERSION, revision)
  }

  // Commands from JavaScript

  fun loadDocument(id: String, canonicalDocument: Map<String, Any?>, schemaVersion: Int, nextRevision: Int) {
    documentId = id
    revision = nextRevision
    if (schemaVersion != SCHEMA_VERSION) {
      emitError("schema_version", "expected $SCHEMA_VERSION, got $schemaVersion")
    }
    val node = SchemaNode.parse(canonicalDocument)
    if (node.type != "doc") {
      emitError("invalid_document", "root type")
      return
    }
    linear = LinearModel.withEditableBody(LinearModel.documentToLinear(node))
    history.clear()
    storedMarks = emptyList()
    anchor = null
    imagePaths.clear()
    imageWidthOverrides.clear()
    inputRuleBlockId = null
    journal.open(id)
    replayUnapplied()
    selection = linear.blocks.firstOrNull()?.let { SchemaSelection(it.textNodeId, 0, "before", revision) }
      ?: SchemaSelection(linear.id, 0, "before", revision)
    hasLoaded = true
    renderAll()
    editText.scrollTo(0, 0)
    boundDocumentId = id
    lastCanonical = CanonicalJson.stringify(node.toJson())
    emitSelection()
    reportContentSize()
  }

  fun applyTransactions(id: String, baseRevision: Int, transactions: List<Map<String, Any?>>, origin: String) {
    if (id.isNotEmpty() && documentId.isNotEmpty() && id != documentId) {
      emitError("document_mismatch", "applyTransactions")
      return
    }
    if (origin == "local") {
      flushEditable()
      for (raw in transactions) {
        commit(SchemaOperation.parseList(raw["operations"]), Json.str(raw["transactionId"]) ?: JotIds.createId())
      }
      return
    }
    val operations = transactions.flatMap { SchemaOperation.parseList(it["operations"]) }
    if (composing) {
      queuedRemote.addLast(operations)
      return
    }
    try {
      linear = LinearModel.apply(operations, linear)
    } catch (error: LinearException) {
      emitError("remote_apply_failed", error.message ?: "")
      return
    }
    revision = baseRevision + transactions.size
    clampSelection()
    renderAll()
    emitSelection()
  }

  fun dispatchCommand(command: Map<String, Any?>) {
    flushEditable()
    val name = Json.str(command["name"]) ?: Json.str(command["command"]) ?: ""
    if (name == "insertImage") {
      val path = Json.str(command["path"])
      val attachmentId = Json.str(command["attachmentId"])
      if (!path.isNullOrEmpty() && !attachmentId.isNullOrEmpty()) {
        imagePaths[attachmentId] = Uri.decode(path.removePrefix("file://"))
      }
    }
    val value: Any? = if (command.containsKey("level")) command["level"] else command
    val plan = LinearCommands.commandPlan(name, value, linear, selection, anchor, storedMarks)
    storedMarks = plan.storedMarks
    if (plan.collapsedOnly || plan.operations.isEmpty()) {
      emitSelection()
      return
    }
    commit(
      plan.operations,
      selectionAfter = plan.selectionAfter,
      isInputRule = plan.isInputRule,
      keepRange = plan.selectionAfter == null && anchor != null,
    )
  }

  fun setSchemaSelection(raw: Map<String, Any?>) {
    flushEditable()
    selection = SchemaSelection.parse(raw)
    anchor = null
    applySelectionToView()
    emitSelection()
  }

  fun getDocumentSnapshot(): Map<String, Any?> {
    flushEditable()
    return mapOf("canonicalDocument" to LinearModel.linearToDocument(linear).toJson(), "revision" to revision)
  }

  fun focusEditor() {
    editText.requestFocus()
    inputMethods.showSoftInput(editText, InputMethodManager.SHOW_IMPLICIT)
  }

  fun blurEditor() {
    inputMethods.hideSoftInputFromWindow(editText.windowToken, 0)
    editText.clearFocus()
  }

  fun undo() {
    flushEditable()
    undoStep(render = true)
  }

  fun redo() {
    flushEditable()
    val entry = history.popRedo()
    if (entry == null) {
      emitSelection()
      return
    }
    val operations = entry.afterSnapshot?.let {
      LinearCommands.contentDiffOps(LinearModel.linearToDocument(linear), LinearModel.linearToDocument(it))
    } ?: entry.forward
    replayHistory(entry, operations, "redo", entry.selectionAfter, render = true)
  }

  /** Persisted history from the local store, oldest first, so undo survives relaunch. */
  fun seedHistory(undo: List<Map<String, Any?>>, redo: List<Map<String, Any?>>) {
    // A late seed must never discard edits made in this session.
    if (history.canUndo || history.canRedo) {
      return
    }
    fun entry(raw: Map<String, Any?>): UndoEntry? {
      val id = Json.str(raw["transactionId"]) ?: return null
      val forward = SchemaOperation.parseList(raw["forward"])
      val inverse = SchemaOperation.parseList(raw["inverse"])
      if (forward.isEmpty() || inverse.isEmpty()) {
        return null
      }
      return UndoEntry(id, forward, inverse, caretFor(inverse) ?: selection, caretFor(forward) ?: selection)
    }
    history.seed(undo.mapNotNull { entry(it) }, redo.mapNotNull { entry(it) })
    emitSelection()
  }

  fun setAppliedTransactionIds(ids: List<String>) {
    committedElsewhere = ids.toSet()
  }

  fun listUnappliedIntake(): List<Map<String, Any?>> {
    journal.open(documentId)
    return try {
      journal.listUnapplied().map { (transactionId, payload) -> mapOf("transactionId" to transactionId, "payload" to payload) }
    } catch (error: Exception) {
      emitError("journal_read_failed", error.message ?: "listUnapplied")
      emptyList()
    }
  }

  fun markIntakeApplied(transactionId: String) {
    journal.open(documentId)
    journal.markApplied(transactionId)
  }

  // Text changes from the keyboard

  internal fun onCompositionFinished() {
    if (composing) {
      flushEditable()
    }
  }

  private inner class Watcher : TextWatcher {
    override fun beforeTextChanged(s: CharSequence, start: Int, count: Int, after: Int) = Unit

    override fun onTextChanged(s: CharSequence, start: Int, before: Int, count: Int) {
      if (!applying) {
        touchedStart = min(touchedStart, start)
      }
    }

    override fun afterTextChanged(s: Editable) {
      if (applying || !hasLoaded) {
        return
      }
      if (BaseInputConnection.getComposingSpanStart(s) >= 0) {
        if (!composing) {
          composing = true
          onCompositionChanged(mapOf("active" to true))
        }
        return
      }
      flushEditable()
    }
  }

  /** Reads a pending change out of the editable and plans it. */
  private fun flushEditable() {
    if (!viewReady || applying || !hasLoaded) {
      return
    }
    val editable = editText.text ?: return
    val wasComposing = composing
    if (composing) {
      composing = false
      onCompositionChanged(mapOf("active" to false))
    }
    val current = editable.toString()
    if (current == committedText) {
      touchedStart = Int.MAX_VALUE
      flushRemote()
      return
    }
    val old = committedText
    // One contiguous change. Text before the first touched character did not change.
    val limit = min(min(old.length, current.length), touchedStart)
    var prefix = 0
    while (prefix < limit && old[prefix] == current[prefix]) {
      prefix += 1
    }
    var suffix = 0
    while (suffix < old.length - prefix && suffix < current.length - prefix &&
      old[old.length - 1 - suffix] == current[current.length - 1 - suffix]
    ) {
      suffix += 1
    }
    val caretStart = Selection.getSelectionStart(editable)
    val caretEnd = Selection.getSelectionEnd(editable)
    handleUserChange(
      start = prefix,
      removedLength = old.length - suffix - prefix,
      inserted = current.substring(prefix, current.length - suffix),
      oneCharacterAtATime = wasComposing && !pasting,
      caret = caretStart to caretEnd,
    )
    flushRemote()
  }

  private fun handleUserChange(start: Int, removedLength: Int, inserted: String, oneCharacterAtATime: Boolean, caret: Pair<Int, Int>) {
    val previous = linear
    if (removedLength > 0 && removedLength == inserted.length && committedText.regionMatches(start, inserted, 0, inserted.length)) {
      // Dismissing a suggestion replaces a word with itself. Recording that adds an undo step that changes nothing.
      syncView(previous)
      applySelectionToView()
      return
    }
    val startBlock = LinearModel.block(EditPlanner.location(start, "before", linear, revision).nodeId, linear)
    if (inserted.length > 1 && inserted.contains('\n') && startBlock?.kind != LinearBlockKind.CODE_BLOCK) {
      // Several lines at once, from dictation or a keyboard, go through Markdown parsing in JavaScript.
      deleteDisplayRange(start, removedLength, render = false)
      syncView(previous)
      applySelectionToView()
      emitSelection()
      onPasteRequested(mapOf("text" to inserted))
      return
    }
    // Composed text arrives as a word at a time. Planning it per character lets Markdown shortcuts fire as typed.
    val pieces = if (oneCharacterAtATime && removedLength == 0) codePoints(inserted) else listOf(inserted)
    var position = start
    var length = removedLength
    for (piece in pieces) {
      val change = EditPlanner.change(position, length, piece, linear, revision)
      when (val outcome = EditPlanner.plan(change, linear, storedMarks, inputRuleBlockId)) {
        EditPlanner.Outcome.Ignore -> break
        EditPlanner.Outcome.UndoInputRule -> {
          // Backspace right after a Markdown shortcut restores the characters that triggered it.
          undoStep(render = false)
          break
        }
        is EditPlanner.Outcome.Plan -> {
          val plan = outcome.plan
          if (!commit(plan.operations, selectionAfter = plan.selectionAfter, isInputRule = plan.isInputRule, render = false)) {
            break
          }
          if (plan.storedMarks != storedMarks && piece in MARKDOWN_TRIGGERS) {
            storedMarks = plan.storedMarks
          }
          position = EditPlanner.displayIndex(selection, linear)
          length = 0
        }
      }
    }
    val syncStarted = SystemClock.elapsedRealtimeNanos()
    val textChanged = syncView(previous)
    if (Log.isLoggable(TAG, Log.DEBUG)) {
      Log.d(TAG, "keystroke blocks=${linear.blocks.size} sync_ms=${ms(SystemClock.elapsedRealtimeNanos() - syncStarted)} text_changed=$textChanged")
    }
    val insertionEnd = start + inserted.length
    val caretMoved = caret.first != insertionEnd || caret.second != insertionEnd
    if (caretMoved && !textChanged && caret.first >= 0) {
      // The caret moved while the keyboard was still composing, so it belongs where the person put it.
      placeSelection(caret.first, caret.second)
    } else {
      applySelectionToView()
    }
    emitSelection()
    reportContentSize()
  }

  private fun deleteDisplayRange(start: Int, length: Int, render: Boolean) {
    if (length <= 0) {
      return
    }
    val from = EditPlanner.location(start, "before", linear, revision)
    val to = EditPlanner.location(start + length, "after", linear, revision)
    val plan = if (from.nodeId == to.nodeId) {
      EditPlanner.textReplacement(from, to, length, "", linear, storedMarks)
    } else {
      EditPlanner.crossBlockReplacement(from, to, "", linear, storedMarks)
    }
    if (plan != null && plan.operations.isNotEmpty()) {
      commit(plan.operations, selectionAfter = plan.selectionAfter, render = render)
    }
  }

  internal fun onEditorSelectionChanged(start: Int, end: Int) {
    if (!viewReady || applying || composing || !hasLoaded || touchedStart != Int.MAX_VALUE) {
      return
    }
    placeSelection(start, end)
    emitSelection()
  }

  private fun placeSelection(start: Int, end: Int) {
    val lo = min(start, end).coerceAtLeast(0)
    val hi = max(start, end).coerceAtLeast(0)
    selection = EditPlanner.location(lo, if (lo == hi) "after" else "before", linear, revision)
    anchor = if (hi > lo) EditPlanner.location(hi, "after", linear, revision) else null
    if (lo == hi) {
      // A caret before a bullet, number, or checkbox belongs after it.
      val expected = EditPlanner.displayIndex(selection, linear)
      if (expected != lo && expected <= editText.length()) {
        val wasApplying = applying
        applying = true
        editText.setSelection(expected)
        applying = wasApplying
      }
    }
    LinearModel.block(selection.nodeId, linear)?.let { storedMarks = it.markTypes(selection.offsetUtf16) }
  }

  // Commit

  private fun commit(
    operations: List<SchemaOperation>,
    transactionId: String = JotIds.createId(),
    journalFirst: Boolean = true,
    recordUndo: Boolean = true,
    emitCommitted: Boolean = true,
    selectionAfter: SchemaSelection? = null,
    isInputRule: Boolean = false,
    origin: String = "local",
    historyOf: String? = null,
    keepRange: Boolean = false,
    render: Boolean = true,
  ): Boolean {
    if (operations.isEmpty()) {
      return true
    }
    val base = revision
    val selectionBefore = selection
    val journalStarted = SystemClock.elapsedRealtimeNanos()
    if (journalFirst) {
      val payload = CanonicalJson.stringify(
        mapOf(
          "transactionId" to transactionId,
          "baseRevision" to base,
          "operations" to operations.map { it.toJson() },
          "selection" to selection.toJson(),
        ),
      )
      journal.open(documentId)
      if (!journal.append(transactionId, payload)) {
        emitError("journal_append_failed", "sqlite")
        return false
      }
    }
    val applyStarted = SystemClock.elapsedRealtimeNanos()
    val before = linear
    linear = try {
      LinearModel.apply(operations, linear)
    } catch (error: LinearException) {
      emitError("apply_failed", error.message ?: "linear")
      return false
    }
    val applyFinished = SystemClock.elapsedRealtimeNanos()
    revision += 1
    if (selectionAfter != null) {
      selection = selectionAfter.copy(revision = revision)
      anchor = null
    } else {
      clampSelection(keepRange)
    }
    if (isInputRule) {
      inputRuleBlockId = selection.nodeId
    } else if (emitCommitted) {
      inputRuleBlockId = null
    }
    val renderStarted = SystemClock.elapsedRealtimeNanos()
    if (render) {
      syncView(before)
      applySelectionToView()
    }
    val historyStarted = SystemClock.elapsedRealtimeNanos()
    if (recordUndo) {
      val inverse = LinearModel.invert(operations, before)
      history.push(
        UndoEntry(
          transactionId = transactionId,
          forward = operations,
          inverse = inverse ?: emptyList(),
          selectionBefore = selectionBefore,
          selectionAfter = selection,
          beforeSnapshot = if (inverse == null) before else null,
          afterSnapshot = if (inverse == null) linear else null,
        ),
      )
    }
    val historyFinished = SystemClock.elapsedRealtimeNanos()
    if (Log.isLoggable(TAG, Log.DEBUG)) {
      Log.d(
        TAG,
        "commit blocks=${linear.blocks.size} journal_ms=${ms(applyStarted - journalStarted)} apply_ms=${ms(applyFinished - applyStarted)} " +
          "render_ms=${ms(historyStarted - renderStarted)} history_ms=${ms(historyFinished - historyStarted)}",
      )
    }
    if (emitCommitted) {
      val event = mutableMapOf<String, Any>(
        "transactionId" to transactionId,
        "baseRevision" to base,
        "operations" to operations.map { it.toJson() },
        "selection" to selection.toJson(),
        "origin" to origin,
      )
      if (historyOf != null) {
        event["historyOf"] = historyOf
      }
      onCommittedTransaction(event)
    }
    if (render) {
      emitSelection()
      reportContentSize()
    }
    return true
  }

  private fun clampSelection(keepRange: Boolean = false) {
    val block = LinearModel.block(selection.nodeId, linear)
    if (block != null) {
      selection = selection.copy(offsetUtf16 = min(selection.offsetUtf16, block.utf16Length), revision = revision)
      if (!keepRange) {
        anchor = null
      }
      return
    }
    val last = linear.blocks.lastOrNull() ?: return
    selection = SchemaSelection(last.textNodeId, last.utf16Length, "after", revision)
    anchor = null
  }

  private fun undoStep(render: Boolean) {
    val entry = history.popUndo()
    if (entry == null) {
      emitSelection()
      return
    }
    val operations = entry.beforeSnapshot?.let {
      LinearCommands.contentDiffOps(LinearModel.linearToDocument(linear), LinearModel.linearToDocument(it))
    } ?: entry.inverse
    replayHistory(entry, operations, "undo", entry.selectionBefore, render)
  }

  private fun replayHistory(entry: UndoEntry, operations: List<SchemaOperation>, origin: String, caret: SchemaSelection, render: Boolean) {
    if (operations.isEmpty()) {
      emitSelection()
      return
    }
    val target = if (LinearModel.block(caret.nodeId, linear) != null) caret else null
    if (!commit(operations, recordUndo = false, selectionAfter = target, origin = origin, historyOf = entry.transactionId, render = render)) {
      history.clear()
      emitError("${origin}_failed", entry.transactionId)
      return
    }
    if (target == null) {
      // The caret's block did not exist until this step ran.
      LinearModel.block(caret.nodeId, linear)?.let { restored ->
        selection = SchemaSelection(caret.nodeId, min(caret.offsetUtf16, restored.utf16Length), caret.affinity, revision)
        if (render) {
          applySelectionToView()
          emitSelection()
        }
      }
    }
  }

  private fun caretFor(operations: List<SchemaOperation>): SchemaSelection? {
    for (operation in operations) {
      when (operation) {
        is SchemaOperation.InsertText -> return operation.position
        is SchemaOperation.DeleteRange -> return operation.from
        is SchemaOperation.ReplaceRange -> return operation.from
        is SchemaOperation.AddMark -> return operation.from
        is SchemaOperation.RemoveMark -> return operation.from
        is SchemaOperation.SetNodeAttributes -> return SchemaSelection(operation.nodeId, 0, "before", revision)
        is SchemaOperation.InsertNode, is SchemaOperation.DeleteNode -> Unit
      }
    }
    return null
  }

  private fun replayUnapplied() {
    val alreadyCommitted = committedElsewhere
    committedElsewhere = emptySet()
    val rows = try {
      journal.listUnapplied()
    } catch (error: Exception) {
      emitError("journal_read_failed", error.message ?: "listUnapplied")
      return
    }
    for ((transactionId, payload) in rows) {
      if (transactionId in alreadyCommitted) {
        journal.markApplied(transactionId)
        continue
      }
      val parsed = JournalPayload.parse(payload)
      if (parsed == null) {
        emitError("unapplied_payload_parse_failed", transactionId)
        continue
      }
      val applied = commit(
        parsed.operations,
        parsed.transactionId,
        journalFirst = false,
        recordUndo = false,
        emitCommitted = false,
        render = false,
      )
      if (!applied) {
        emitError("unapplied_payload_apply_failed", transactionId)
      }
    }
  }

  private fun flushRemote() {
    if (queuedRemote.isEmpty()) {
      return
    }
    while (queuedRemote.isNotEmpty()) {
      try {
        linear = LinearModel.apply(queuedRemote.removeFirst(), linear)
      } catch (error: LinearException) {
        emitError("remote_apply_failed", error.message ?: "")
      }
    }
    clampSelection()
    renderAll()
    emitSelection()
  }

  // Rendering

  private fun applyTheme() {
    theme = EditorTheme(context, accentOverride)
    editText.setTextColor(theme.ink)
    editText.setHintTextColor(theme.inkFaint)
    editText.highlightColor = (theme.accent and 0x00FFFFFF) or 0x44000000
    editText.typeface = theme.serif
    editText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
    editText.setLineSpacing(theme.dp(3f), 1f)
    if (Build.VERSION.SDK_INT >= 29) {
      editText.textCursorDrawable = GradientDrawable().apply {
        setColor(theme.accent)
        setSize(theme.dp(2f).roundToInt(), 1)
      }
    }
    updatePadding()
  }

  private fun updatePadding() {
    if (!viewReady && width == 0) {
      return
    }
    val horizontal = max(theme.dp(20f), floor((width - theme.dp(READABLE_WIDTH_DP)) / 2f)).roundToInt()
    editText.setPadding(horizontal, theme.dp(12f).roundToInt(), horizontal, theme.dp(40f).roundToInt() + keyboardOverlap)
    val nextWidth = max(0, width - horizontal * 2)
    if (nextWidth != contentWidth && width > 0) {
      contentWidth = nextWidth
      if (hasLoaded && linear.blocks.any { it.kind == LinearBlockKind.IMAGE || it.kind == LinearBlockKind.HORIZONTAL_RULE }) {
        renderAll()
      }
    }
  }

  private fun renderContext(): RenderContext {
    val width = if (contentWidth > 0) contentWidth else resources.displayMetrics.widthPixels - theme.dp(40f).roundToInt()
    return RenderContext(theme, width, imagePaths, attachmentsDirectory, imageWidthOverrides)
  }

  private fun renderAll() {
    val rendered = EditorRenderer.render(linear, 0, linear.blocks.size, renderContext())
    val wasApplying = applying
    applying = true
    editText.setText(rendered)
    applying = wasApplying
    committedText = rendered.toString()
    touchedStart = Int.MAX_VALUE
    composing = false
    applySelectionToView()
  }

  /**
   * Brings the editable in line with the model after `previous` became `linear`. Text is replaced
   * only where it differs; styles are redrawn for the blocks that changed. Returns true when text changed.
   */
  private fun syncView(previous: LinearDocument): Boolean {
    val editable = editText.text
    if (editable == null || previous.id != linear.id || linear.blocks.isEmpty()) {
      renderAll()
      return true
    }
    val newText = EditPlanner.displayText(linear)
    val current = editable.toString()
    val wasApplying = applying
    applying = true
    var changedFrom = -1
    var changedTo = -1
    if (current != newText) {
      val limit = min(current.length, newText.length)
      var prefix = 0
      while (prefix < limit && current[prefix] == newText[prefix]) {
        prefix += 1
      }
      var suffix = 0
      while (suffix < current.length - prefix && suffix < newText.length - prefix &&
        current[current.length - 1 - suffix] == newText[newText.length - 1 - suffix]
      ) {
        suffix += 1
      }
      editable.replace(prefix, current.length - suffix, newText, prefix, newText.length - suffix)
      changedFrom = prefix
      changedTo = newText.length - suffix
    }
    val blocks = linear.blocks
    val old = previous.blocks
    var prefix = 0
    while (prefix < old.size && prefix < blocks.size && old[prefix] == blocks[prefix]) {
      prefix += 1
    }
    var oldEnd = old.size
    var newEnd = blocks.size
    while (oldEnd > prefix && newEnd > prefix && old[oldEnd - 1] == blocks[newEnd - 1]) {
      oldEnd -= 1
      newEnd -= 1
    }
    val ends = EditorRenderer.blockEnds(linear)
    var lo = Int.MAX_VALUE
    var hi = -1
    if (prefix != old.size || prefix != blocks.size) {
      lo = min(prefix, blocks.size - 1)
      hi = max(newEnd - 1, lo)
    }
    if (changedFrom >= 0) {
      lo = min(lo, blockIndexAt(ends, changedFrom))
      hi = max(hi, blockIndexAt(ends, changedTo))
    }
    if (hi >= 0) {
      restyle(max(0, lo - 1), min(blocks.size - 1, hi + 1), ends)
    }
    applying = wasApplying
    committedText = newText
    touchedStart = Int.MAX_VALUE
    // No restartInput here: the keyboard learns about the new text from the selection update
    // TextView sends, and restarting input mid-typing drops the keys that follow a shortcut.
    return changedFrom >= 0
  }

  private fun restyle(from: Int, to: Int, ends: IntArray = EditorRenderer.blockEnds(linear)) {
    val editable = editText.text ?: return
    val blocks = linear.blocks
    if (blocks.isEmpty()) {
      return
    }
    var lo = from.coerceIn(0, blocks.size - 1)
    var hi = to.coerceIn(lo, blocks.size - 1)
    // List numbers depend on neighbouring items, so a change inside a list redraws the whole run.
    if ((lo..hi).any { LinearModel.isListKind(blocks[it].kind) }) {
      while (lo > 0 && LinearModel.isListKind(blocks[lo - 1].kind)) {
        lo -= 1
      }
      while (hi < blocks.size - 1 && LinearModel.isListKind(blocks[hi + 1].kind)) {
        hi += 1
      }
    }
    val context = renderContext()
    for (index in lo..hi) {
      val start = if (index == 0) 0 else ends[index - 1] + 1
      val end = if (index == blocks.size - 1) ends[index] else ends[index] + 1
      if (end > editable.length || start > end) {
        renderAll()
        return
      }
      val segment = EditorRenderer.render(linear, index, index + 1, context)
      if (segment.length != end - start) {
        renderAll()
        return
      }
      val existing = editable.getSpans(start, end, EditorSpan::class.java).filter {
        val spanStart = editable.getSpanStart(it)
        (spanStart in start until end) || (spanStart == editable.getSpanEnd(it) && spanStart == end)
      }
      val wanted = segment.getSpans(0, segment.length, EditorSpan::class.java)
      // Typing inside a paragraph usually leaves its spans exactly right. Setting them again reflows
      // the paragraph once per span, which was most of a keystroke's cost in a long note.
      val existingKeys = existing.map { "${editable.getSpanStart(it) - start}|${editable.getSpanEnd(it) - start}|${it.signature}" }.sorted()
      val wantedKeys = wanted.map { "${segment.getSpanStart(it)}|${segment.getSpanEnd(it)}|${it.signature}" }.sorted()
      if (existingKeys == wantedKeys) {
        continue
      }
      existing.forEach { editable.removeSpan(it) }
      for (span in wanted) {
        editable.setSpan(span, start + segment.getSpanStart(span), start + segment.getSpanEnd(span), segment.getSpanFlags(span))
      }
    }
  }

  private fun blockIndexAt(ends: IntArray, offset: Int): Int {
    var lo = 0
    var hi = ends.size - 1
    while (lo < hi) {
      val mid = (lo + hi) / 2
      if (ends[mid] >= offset) {
        hi = mid
      } else {
        lo = mid + 1
      }
    }
    return lo
  }

  private fun applySelectionToView() {
    val length = editText.length()
    val start = EditPlanner.displayIndex(selection, linear).coerceIn(0, length)
    val end = anchor?.let { EditPlanner.displayIndex(it, linear).coerceIn(0, length) }
    val wasApplying = applying
    applying = true
    if (end == null || end == start) {
      editText.setSelection(start)
    } else {
      editText.setSelection(min(start, end), max(start, end))
    }
    applying = wasApplying
  }

  // Events

  private fun emitSelection() {
    val block = LinearModel.block(selection.nodeId, linear)
    val blockInfo = mutableMapOf<String, Any?>()
    if (block != null) {
      blockInfo["kind"] = block.kind.rawValue
      blockInfo["inQuote"] = block.quoteChain.isNotEmpty()
      block.headingLevel?.let { blockInfo["headingLevel"] = it }
    }
    val end = anchor
    val active = if (end != null) {
      MARK_TYPES.filter { LinearModel.rangeHasMark(it, selection, end, linear) }.map { LinearMark(it) }
    } else {
      storedMarks
    }
    onSelectionChanged(
      mapOf(
        "selection" to selection.toJson(),
        "activeMarks" to active.map { it.toJson() },
        "block" to blockInfo,
        "collapsed" to (end == null),
        "canUndo" to history.canUndo,
        "canRedo" to history.canRedo,
      ),
    )
  }

  private fun emitError(code: String, detail: String) {
    onRecoverableError(mapOf("code" to code, "context" to detail))
  }

  private fun reportContentSize() {
    if (!viewReady) {
      return
    }
    val layoutHeight = editText.layout?.height ?: 0
    val height = (layoutHeight + editText.paddingTop + theme.dp(40f)) / resources.displayMetrics.density
    if (abs(height - lastReportedHeight) < 0.5f) {
      return
    }
    lastReportedHeight = height
    onContentSizeChanged(mapOf("height" to height))
  }

  // Taps, pinches, and paste

  private sealed class Hit {
    data class Image(val span: ImageBlockSpan) : Hit()

    data class Checkbox(val nodeId: String) : Hit()
  }

  private data class Pinch(val nodeId: String, val startWidth: Int, var currentWidth: Int, var scale: Float)

  private fun onAtomTapped(hit: Hit) {
    flushEditable()
    when (hit) {
      is Hit.Checkbox -> {
        val block = LinearModel.block(hit.nodeId, linear) ?: return
        if (block.kind != LinearBlockKind.TASK_ITEM) {
          return
        }
        val next = if ((block.checked ?: 0) == 0) 1 else 0
        editText.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        commit(listOf(SchemaOperation.SetNodeAttributes(block.id, mapOf("checked" to next), mapOf("checked" to (block.checked ?: 0)))))
      }
      is Hit.Image -> {
        val span = hit.span
        val index = LinearModel.indexOfBlock(span.nodeId, linear)
        if (editText.hasFocus() && index != null) {
          // Keep typing out of the image: park the caret where the next block starts.
          selection = if (index + 1 < linear.blocks.size) {
            SchemaSelection(linear.blocks[index + 1].textNodeId, 0, "after", revision)
          } else {
            SchemaSelection(span.nodeId, 1, "after", revision)
          }
          anchor = null
          applySelectionToView()
          emitSelection()
        }
        onImagePressed(mapOf("nodeId" to span.nodeId, "attachmentId" to span.attachmentId, "widthBasisPoints" to span.widthBasisPoints))
      }
    }
  }

  private fun beginPinch(hit: Hit?): Boolean {
    val image = hit as? Hit.Image ?: return false
    flushEditable()
    pinch = Pinch(image.span.nodeId, image.span.widthBasisPoints, image.span.widthBasisPoints, 1f)
    editText.parent?.requestDisallowInterceptTouchEvent(true)
    return true
  }

  private fun updatePinch(factor: Float) {
    val active = pinch ?: return
    active.scale *= factor
    val next = (active.startWidth * active.scale).roundToInt().coerceIn(LinearCommands.MINIMUM_IMAGE_WIDTH_BASIS_POINTS, 10000)
    if (abs(next - active.currentWidth) < PINCH_STEP) {
      return
    }
    if (next == 10000 && active.currentWidth != 10000) {
      editText.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
    }
    active.currentWidth = next
    imageWidthOverrides[active.nodeId] = next
    restyleBlock(active.nodeId)
  }

  private fun endPinch() {
    val active = pinch ?: return
    pinch = null
    imageWidthOverrides.remove(active.nodeId)
    val final = if (active.currentWidth >= 9600) 10000 else active.currentWidth
    if (final == active.startWidth) {
      restyleBlock(active.nodeId)
      return
    }
    dispatchCommand(mapOf("name" to "setImageWidth", "nodeId" to active.nodeId, "widthBasisPoints" to final))
  }

  private fun restyleBlock(nodeId: String) {
    val index = LinearModel.indexOfBlock(nodeId, linear) ?: return
    val wasApplying = applying
    applying = true
    restyle(index, index)
    applying = wasApplying
  }

  /** Images and Markdown go to JavaScript. Returns false when the editable should paste plain text itself. */
  private fun handlePaste(): Boolean {
    flushEditable()
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = clipboard.primaryClip ?: return true
    if (clip.itemCount == 0) {
      return true
    }
    val item = clip.getItemAt(0)
    val uri = item.uri
    if (uri != null && context.contentResolver.getType(uri)?.startsWith("image/") == true) {
      receiveImage(uri)
      return true
    }
    val text = item.coerceToText(context)?.toString() ?: return true
    if (text.isEmpty()) {
      return true
    }
    if (LinearModel.block(selection.nodeId, linear)?.kind == LinearBlockKind.CODE_BLOCK) {
      return false
    }
    if (!text.contains('\n') && !looksLikeMarkdown(text)) {
      return false
    }
    deleteSelectionForPaste()
    onPasteRequested(mapOf("text" to text))
    return true
  }

  private fun receiveImage(uri: Uri) {
    flushEditable()
    val type = context.contentResolver.getType(uri) ?: "image/jpeg"
    val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(type) ?: "jpg"
    val file = File(context.cacheDir, "jot-paste-${JotIds.createId()}.$extension")
    val copied = try {
      context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } } != null
    } catch (_: Exception) {
      false
    }
    if (!copied) {
      emitError("paste_image_failed", "copy")
      return
    }
    deleteSelectionForPaste()
    onPasteRequested(mapOf("imagePath" to file.absolutePath))
  }

  private fun deleteSelectionForPaste() {
    val end = anchor ?: return
    val start = EditPlanner.displayIndex(selection, linear)
    val stop = EditPlanner.displayIndex(end, linear)
    deleteDisplayRange(min(start, stop), abs(stop - start), render = true)
  }

  private inner class JotEditText(context: Context) : EditText(context) {
    private var downHit: Hit? = null
    private var downX = 0f
    private var downY = 0f
    private var swallowing = false
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private val scaleDetector = ScaleGestureDetector(
      context,
      object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScaleBegin(detector: ScaleGestureDetector): Boolean = beginPinch(hitTest(detector.focusX, detector.focusY))

        override fun onScale(detector: ScaleGestureDetector): Boolean {
          updatePinch(detector.scaleFactor)
          return true
        }

        override fun onScaleEnd(detector: ScaleGestureDetector) {
          endPinch()
        }
      },
    )

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
      val inner = super.onCreateInputConnection(outAttrs) ?: return null
      return JotEditorInputConnection(inner, this@JotEditorView)
    }

    override fun onSelectionChanged(selStart: Int, selEnd: Int) {
      super.onSelectionChanged(selStart, selEnd)
      onEditorSelectionChanged(selStart, selEnd)
    }

    override fun onTextContextMenuItem(id: Int): Boolean {
      if (id == android.R.id.paste || id == android.R.id.pasteAsPlainText) {
        if (handlePaste()) {
          return true
        }
        pasting = true
        try {
          return super.onTextContextMenuItem(android.R.id.pasteAsPlainText)
        } finally {
          pasting = false
        }
      }
      return super.onTextContextMenuItem(id)
    }

    override fun onKeyShortcut(keyCode: Int, event: KeyEvent): Boolean {
      if (event.isCtrlPressed || event.isMetaPressed) {
        when (keyCode) {
          KeyEvent.KEYCODE_B -> dispatchCommand(mapOf("name" to "toggleBold"))
          KeyEvent.KEYCODE_I -> dispatchCommand(mapOf("name" to "toggleItalic"))
          KeyEvent.KEYCODE_U -> dispatchCommand(mapOf("name" to "toggleUnderline"))
          KeyEvent.KEYCODE_Z -> if (event.isShiftPressed) redo() else undo()
          KeyEvent.KEYCODE_Y -> redo()
          else -> return super.onKeyShortcut(keyCode, event)
        }
        return true
      }
      return super.onKeyShortcut(keyCode, event)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
      scaleDetector.onTouchEvent(event)
      if (pinch != null && !swallowing) {
        swallowing = true
        cancelTouch(event)
      }
      if (swallowing) {
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
          swallowing = false
        }
        return true
      }
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downHit = hitTest(event.x, event.y)
          downX = event.x
          downY = event.y
        }
        MotionEvent.ACTION_UP -> {
          val hit = downHit
          downHit = null
          if (hit != null && abs(event.x - downX) < touchSlop && abs(event.y - downY) < touchSlop && hitTest(event.x, event.y) == hit) {
            // A tap on an image or checkbox acts on it without moving the caret or opening the keyboard.
            cancelTouch(event)
            onAtomTapped(hit)
            return true
          }
        }
        MotionEvent.ACTION_CANCEL -> downHit = null
      }
      return super.onTouchEvent(event)
    }

    private fun cancelTouch(event: MotionEvent) {
      val cancel = MotionEvent.obtain(event)
      cancel.action = MotionEvent.ACTION_CANCEL
      super.onTouchEvent(cancel)
      cancel.recycle()
    }

    fun hitTest(x: Float, y: Float): Hit? {
      val layout = layout ?: return null
      val content = text ?: return null
      val layoutX = x - totalPaddingLeft + scrollX
      val layoutY = y - totalPaddingTop + scrollY
      if (layoutY < 0 || layoutY > layout.height) {
        return null
      }
      val line = layout.getLineForVertical(layoutY.toInt())
      val lineStart = layout.getLineStart(line)
      val lineEnd = layout.getLineEnd(line)
      for (span in content.getSpans(lineStart, lineEnd, ImageBlockSpan::class.java)) {
        if (span.drawnRect.contains(layoutX, layoutY)) {
          return Hit.Image(span)
        }
      }
      for (span in content.getSpans(lineStart, lineEnd, CheckboxSpan::class.java)) {
        val spanStart = content.getSpanStart(span)
        if (spanStart < lineStart || spanStart >= lineEnd) {
          continue
        }
        val left = layout.getPrimaryHorizontal(spanStart)
        if (layoutX >= left - theme.dp(8f) && layoutX <= left + theme.dp(34f)) {
          return Hit.Checkbox(span.nodeId)
        }
      }
      return null
    }
  }

  private companion object {
    const val TAG = "JotEditor"
    const val READABLE_WIDTH_DP = 680f
    const val PINCH_STEP = 100
    val MARK_TYPES = listOf("bold", "italic", "underline", "strikethrough", "inlineCode", "link")
    val MARKDOWN_TRIGGERS = setOf("*", "_", "~", "`", ")")
    private val markdownLine = Regex("^\\s*(#{1,6}\\s|[-*+]\\s|\\d+[.)]\\s|>\\s?)")
    private val markdownInline = Regex("(\\*\\*|__|~~|`|\\[[^\\]]+\\]\\([^)]+\\))")

    fun looksLikeMarkdown(text: String): Boolean = markdownLine.containsMatchIn(text) || markdownInline.containsMatchIn(text)

    fun codePoints(text: String): List<String> {
      val out = mutableListOf<String>()
      var i = 0
      while (i < text.length) {
        val count = Character.charCount(text.codePointAt(i))
        out.add(text.substring(i, i + count))
        i += count
      }
      return out
    }

    fun ms(nanos: Long): String = String.format("%.2f", nanos / 1_000_000.0)
  }
}
