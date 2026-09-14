package app.jot.editor

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class JotEditorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("JotEditor")

    View(JotEditorView::class) {
      Events(
        "onReady",
        "onCommittedTransaction",
        "onSelectionChanged",
        "onCompositionChanged",
        "onContentSizeChanged",
        "onFocusChanged",
        "onImagePressed",
        "onPasteRequested",
        "onRecoverableError",
      )

      Prop("documentId") { view: JotEditorView, value: String? ->
        view.setDocumentId(value ?: "")
      }

      Prop("schemaVersion") { view: JotEditorView, value: Int ->
        view.setSchemaVersion(value)
      }

      Prop("revision") { view: JotEditorView, value: Int ->
        view.setRevision(value)
      }

      Prop("canonicalDocument") { view: JotEditorView, value: Map<String, Any?>? ->
        view.setCanonicalDocument(value)
      }

      Prop("attachmentsDirectory") { view: JotEditorView, value: String? ->
        view.setAttachmentsDirectory(value)
      }

      Prop("placeholder") { view: JotEditorView, value: String? ->
        view.setPlaceholder(value)
      }

      Prop("accentColor") { view: JotEditorView, value: String? ->
        view.setAccentColor(value)
      }

      AsyncFunction("loadDocument") { view: JotEditorView, documentId: String, canonicalDocument: Map<String, Any?>, schemaVersion: Int, revision: Int ->
        view.loadDocument(documentId, canonicalDocument, schemaVersion, revision)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("applyTransactions") { view: JotEditorView, documentId: String, baseRevision: Int, transactions: List<Map<String, Any?>>, origin: String ->
        view.applyTransactions(documentId, baseRevision, transactions, origin)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("dispatchCommand") { view: JotEditorView, command: Map<String, Any?> ->
        view.dispatchCommand(command)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("setSelection") { view: JotEditorView, selection: Map<String, Any?> ->
        view.setSchemaSelection(selection)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("getDocumentSnapshot") { view: JotEditorView ->
        view.getDocumentSnapshot()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("focus") { view: JotEditorView ->
        view.focusEditor()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("blur") { view: JotEditorView ->
        view.blurEditor()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("undo") { view: JotEditorView ->
        view.undo()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("redo") { view: JotEditorView ->
        view.redo()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("setAppliedTransactionIds") { view: JotEditorView, ids: List<String> ->
        view.setAppliedTransactionIds(ids)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("seedHistory") { view: JotEditorView, undo: List<Map<String, Any?>>, redo: List<Map<String, Any?>> ->
        view.seedHistory(undo, redo)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("listUnappliedIntake") { view: JotEditorView ->
        view.listUnappliedIntake()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("markIntakeApplied") { view: JotEditorView, transactionId: String ->
        view.markIntakeApplied(transactionId)
      }.runOnQueue(Queues.MAIN)
    }
  }
}
