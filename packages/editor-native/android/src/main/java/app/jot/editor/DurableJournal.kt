package app.jot.editor

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase

internal class DurableJournal(private val context: Context) {
  private var db: SQLiteDatabase? = null
  private var openDocumentId: String? = null

  fun open(documentId: String) {
    val id = documentId.ifEmpty { UNBOUND }
    if (openDocumentId == id && db?.isOpen == true) {
      return
    }
    close()
    val database = context.openOrCreateDatabase(fileName(id), Context.MODE_PRIVATE, null)
    database.disableWriteAheadLogging()
    // journal_mode returns a row, and Android's execSQL throws on statements that return rows.
    database.rawQuery("PRAGMA journal_mode = DELETE", null).use { it.moveToFirst() }
    database.execSQL("PRAGMA synchronous = FULL")
    database.execSQL(
      """
      CREATE TABLE IF NOT EXISTS editor_intake (
        transaction_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        applied INTEGER NOT NULL DEFAULT 0
      )
      """.trimIndent(),
    )
    db = database
    openDocumentId = id
  }

  fun append(transactionId: String, payload: String): Boolean {
    val database = db ?: return false
    return try {
      database.beginTransaction()
      try {
        val values = ContentValues().apply {
          put("transaction_id", transactionId)
          put("payload", payload)
          put("applied", 0)
        }
        if (database.insertOrThrow("editor_intake", null, values) < 0) {
          return false
        }
        database.setTransactionSuccessful()
      } finally {
        database.endTransaction()
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  fun listUnapplied(): List<Pair<String, String>> {
    val database = db ?: return emptyList()
    val rows = mutableListOf<Pair<String, String>>()
    database.rawQuery(
      "SELECT transaction_id, payload FROM editor_intake WHERE applied = 0 ORDER BY rowid",
      null,
    ).use { cursor ->
      while (cursor.moveToNext()) {
        rows.add(cursor.getString(0) to cursor.getString(1))
      }
    }
    return rows
  }

  fun markApplied(transactionId: String) {
    val database = db ?: return
    val values = ContentValues().apply { put("applied", 1) }
    database.update("editor_intake", values, "transaction_id = ?", arrayOf(transactionId))
  }

  fun close() {
    db?.close()
    db = null
    openDocumentId = null
  }

  companion object {
    private const val UNBOUND = "unbound"

    fun fileName(documentId: String): String {
      val safe = documentId.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifEmpty { UNBOUND }
      return "jot_editor_intake_$safe.db"
    }
  }
}
