package app.jot.editor

import android.view.KeyEvent
import android.view.inputmethod.CorrectionInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.view.inputmethod.TextAttribute

internal class JotEditorInputConnection(
  target: InputConnection,
  private val editor: JotEditorView,
) : InputConnectionWrapper(target, true) {
  override fun beginBatchEdit(): Boolean {
    editor.onBeginBatch()
    return super.beginBatchEdit()
  }

  override fun endBatchEdit(): Boolean {
    val applied = super.endBatchEdit()
    editor.onEndBatch()
    return applied
  }

  override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
    if (!editor.onSetComposingText(text?.toString() ?: "")) {
      return false
    }
    return super.setComposingText(text, newCursorPosition)
  }

  override fun setComposingText(
    text: CharSequence,
    newCursorPosition: Int,
    textAttribute: TextAttribute?,
  ): Boolean {
    if (!editor.onSetComposingText(text.toString())) {
      return false
    }
    return super.setComposingText(text, newCursorPosition, textAttribute)
  }

  override fun setComposingRegion(start: Int, end: Int): Boolean {
    editor.onSetComposingRegion(start, end)
    return super.setComposingRegion(start, end)
  }

  override fun finishComposingText(): Boolean {
    return editor.onFinishComposingText { super.finishComposingText() }
  }

  override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
    return editor.onCommitText(text?.toString() ?: "") {
      super.commitText(text, newCursorPosition)
    }
  }

  override fun commitText(
    text: CharSequence,
    newCursorPosition: Int,
    textAttribute: TextAttribute?,
  ): Boolean {
    return editor.onCommitText(text.toString()) {
      super.commitText(text, newCursorPosition, textAttribute)
    }
  }

  override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
    return editor.onDeleteSurrounding(beforeLength, afterLength) {
      super.deleteSurroundingText(beforeLength, afterLength)
    }
  }

  override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean {
    return editor.onDeleteSurrounding(beforeLength, afterLength) {
      super.deleteSurroundingTextInCodePoints(beforeLength, afterLength)
    }
  }

  override fun commitCorrection(correctionInfo: CorrectionInfo): Boolean {
    val oldText = correctionInfo.oldText?.toString() ?: ""
    val newText = correctionInfo.newText?.toString() ?: ""
    return editor.onCommitCorrection(oldText, newText, correctionInfo.offset) {
      super.commitCorrection(correctionInfo)
    }
  }

  override fun performEditorAction(editorAction: Int): Boolean {
    if (editor.onPerformEditorAction(editorAction)) {
      return true
    }
    return super.performEditorAction(editorAction)
  }

  override fun sendKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN && editor.onKeyCommand(event.keyCode)) {
      return true
    }
    return super.sendKeyEvent(event)
  }

  override fun closeConnection() {
    editor.onInputConnectionClosed()
    super.closeConnection()
  }
}
