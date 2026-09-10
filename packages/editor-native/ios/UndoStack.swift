import Foundation

struct UndoEntry {
  var transactionId: String
  var forward: [SchemaOperation]
  var inverse: [SchemaOperation]
  var selectionBefore: SchemaSelection
  var selectionAfter: SchemaSelection
}

final class UndoStack {
  private(set) var undoItems: [UndoEntry] = []
  private(set) var redoItems: [UndoEntry] = []

  var canUndo: Bool { !undoItems.isEmpty }
  var canRedo: Bool { !redoItems.isEmpty }

  func push(_ entry: UndoEntry) {
    undoItems.append(entry)
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

  func clear() {
    undoItems.removeAll()
    redoItems.removeAll()
  }
}
