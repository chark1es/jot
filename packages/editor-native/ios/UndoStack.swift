import Foundation

struct UndoEntry {
  var transactionId: String
  var forward: [SchemaOperation]
  var inverse: [SchemaOperation]
  var selectionBefore: SchemaSelection
  var selectionAfter: SchemaSelection
  /// Set when `inverse` cannot express the edit, such as a join across blocks. Undo then
  /// diffs the current document back to this snapshot, and redo diffs forward to `afterSnapshot`.
  var beforeSnapshot: LinearDocument? = nil
  var afterSnapshot: LinearDocument? = nil
}

final class UndoStack {
  static let limit = 500

  private(set) var undoItems: [UndoEntry] = []
  private(set) var redoItems: [UndoEntry] = []

  var canUndo: Bool { !undoItems.isEmpty }
  var canRedo: Bool { !redoItems.isEmpty }

  func push(_ entry: UndoEntry) {
    undoItems.append(entry)
    if undoItems.count > Self.limit {
      undoItems.removeFirst(undoItems.count - Self.limit)
    }
    redoItems.removeAll()
  }

  func popUndo() -> UndoEntry? {
    guard let entry = undoItems.popLast() else { return nil }
    redoItems.append(entry)
    return entry
  }

  func popRedo() -> UndoEntry? {
    guard let entry = redoItems.popLast() else { return nil }
    undoItems.append(entry)
    return entry
  }

  /// Restores history persisted by the local store. Both arrays are oldest first.
  func seed(undo: [UndoEntry], redo: [UndoEntry]) {
    undoItems = Array(undo.suffix(Self.limit))
    redoItems = redo
  }

  func clear() {
    undoItems.removeAll()
    redoItems.removeAll()
  }
}
