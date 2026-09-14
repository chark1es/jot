package app.jot.editor

import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper

/**
 * Tells the editor when keyboard composition ends. Finishing composition removes the composing span
 * without changing text, so no text watcher sees it.
 */
internal class JotEditorInputConnection(
  target: InputConnection,
  private val editor: JotEditorView,
) : InputConnectionWrapper(target, true) {
  override fun finishComposingText(): Boolean {
    val finished = super.finishComposingText()
    editor.onCompositionFinished()
    return finished
  }

  override fun closeConnection() {
    super.closeConnection()
    editor.onCompositionFinished()
  }
}
