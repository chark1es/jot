package app.jot.editor

internal data class UndoEntry(
  val transactionId: String,
  val forward: List<SchemaOperation>,
  val inverse: List<SchemaOperation>,
  val selectionBefore: SchemaSelection,
  val selectionAfter: SchemaSelection,
  /**
   * Set when `inverse` cannot express the edit, such as a join across blocks. Undo then diffs the
   * current document back to this snapshot, and redo diffs forward to `afterSnapshot`.
   */
  val beforeSnapshot: LinearDocument? = null,
  val afterSnapshot: LinearDocument? = null,
)

internal class UndoStack {
  private val undoItems = ArrayDeque<UndoEntry>()
  private val redoItems = ArrayDeque<UndoEntry>()

  val canUndo: Boolean
    get() = undoItems.isNotEmpty()

  val canRedo: Boolean
    get() = redoItems.isNotEmpty()

  fun push(entry: UndoEntry) {
    undoItems.addLast(entry)
    while (undoItems.size > LIMIT) {
      undoItems.removeFirst()
    }
    redoItems.clear()
  }

  fun popUndo(): UndoEntry? {
    val entry = undoItems.removeLastOrNull() ?: return null
    redoItems.addLast(entry)
    return entry
  }

  fun popRedo(): UndoEntry? {
    val entry = redoItems.removeLastOrNull() ?: return null
    undoItems.addLast(entry)
    return entry
  }

  /** Restores history persisted by the local store. Both lists are oldest first. */
  fun seed(undo: List<UndoEntry>, redo: List<UndoEntry>) {
    undoItems.clear()
    undoItems.addAll(undo.takeLast(LIMIT))
    redoItems.clear()
    redoItems.addAll(redo)
  }

  fun clear() {
    undoItems.clear()
    redoItems.clear()
  }

  companion object {
    const val LIMIT = 500
  }
}
