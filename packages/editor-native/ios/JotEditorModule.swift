import ExpoModulesCore

public class JotEditorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("JotEditor")

    View(JotEditorView.self) {
      Events(
        "onReady",
        "onCommittedTransaction",
        "onSelectionChanged",
        "onCompositionChanged",
        "onContentSizeChanged",
        "onRecoverableError"
      )

      Prop("documentId") { (view: JotEditorView, value: String?) in
        view.setDocumentId(value ?? "")
      }

      Prop("schemaVersion") { (view: JotEditorView, value: Int) in
        view.setSchemaVersion(value)
      }

      Prop("revision") { (view: JotEditorView, value: Int) in
        view.setRevision(value)
      }

      Prop("canonicalDocument") { (view: JotEditorView, value: [String: Any]?) in
        view.setCanonicalDocument(value)
      }

      AsyncFunction("loadDocument") { (view: JotEditorView, documentId: String, canonicalDocument: [String: Any], schemaVersion: Int, revision: Int) in
        try view.loadDocument(
          documentId: documentId,
          canonicalDocument: canonicalDocument,
          schemaVersion: schemaVersion,
          revision: revision
        )
      }

      AsyncFunction("applyTransactions") { (view: JotEditorView, documentId: String, baseRevision: Int, transactions: [[String: Any]], origin: String) in
        try view.applyTransactions(
          documentId: documentId,
          baseRevision: baseRevision,
          transactions: transactions,
          origin: origin
        )
      }

      AsyncFunction("dispatchCommand") { (view: JotEditorView, command: [String: Any]) in
        try view.dispatchCommand(command)
      }

      AsyncFunction("setSelection") { (view: JotEditorView, selection: [String: Any]) in
        view.setSelection(selection)
      }

      AsyncFunction("getDocumentSnapshot") { (view: JotEditorView) -> [String: Any] in
        view.snapshotDictionary()
      }

      AsyncFunction("focus") { (view: JotEditorView) in
        view.focusEditor()
      }

      AsyncFunction("blur") { (view: JotEditorView) in
        view.blurEditor()
      }

      AsyncFunction("undo") { (view: JotEditorView) in
        try view.undo()
      }

      AsyncFunction("redo") { (view: JotEditorView) in
        try view.redo()
      }

      AsyncFunction("listUnappliedIntake") { (view: JotEditorView) -> [[String: Any]] in
        view.listUnappliedIntake()
      }

      AsyncFunction("markIntakeApplied") { (view: JotEditorView, transactionId: String) in
        try view.markIntakeApplied(transactionId: transactionId)
      }
    }
  }
}
