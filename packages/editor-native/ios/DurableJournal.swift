import Foundation
import SQLite3

final class DurableJournal {
  enum JournalError: Error {
    case openFailed(Int32)
    case execFailed(Int32)
    case appendFailed(Int32)
  }

  private var db: OpaquePointer?
  private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  init(fileURL: URL) throws {
    let directory = fileURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var handle: OpaquePointer?
    let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
    let status = fileURL.path.withCString { path in
      sqlite3_open_v2(path, &handle, flags, nil)
    }
    guard status == SQLITE_OK, let handle else {
      throw JournalError.openFailed(status)
    }
    db = handle
    try exec("PRAGMA synchronous=FULL")
    try exec("PRAGMA journal_mode=DELETE")
    try exec(
      """
      CREATE TABLE IF NOT EXISTS editor_intake(
        transaction_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        applied INTEGER NOT NULL DEFAULT 0
      )
      """
    )
  }

  deinit {
    if let db {
      sqlite3_close(db)
    }
  }

  func append(transactionId: String, payload: String) throws {
    try exec("BEGIN IMMEDIATE")
    var statement: OpaquePointer?
    let sql = "INSERT INTO editor_intake(transaction_id, payload, applied) VALUES (?, ?, 0)"
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      _ = sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
      throw JournalError.appendFailed(sqlite3_errcode(db))
    }
    defer { sqlite3_finalize(statement) }
    sqlite3_bind_text(statement, 1, transactionId, -1, sqliteTransient)
    sqlite3_bind_text(statement, 2, payload, -1, sqliteTransient)
    let step = sqlite3_step(statement)
    if step != SQLITE_DONE {
      _ = sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
      throw JournalError.appendFailed(step)
    }
    do {
      try exec("COMMIT")
    } catch {
      _ = sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
      throw error
    }
  }

  func markApplied(transactionId: String) throws {
    var statement: OpaquePointer?
    let sql = "UPDATE editor_intake SET applied = 1 WHERE transaction_id = ?"
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw JournalError.execFailed(sqlite3_errcode(db))
    }
    defer { sqlite3_finalize(statement) }
    sqlite3_bind_text(statement, 1, transactionId, -1, sqliteTransient)
    if sqlite3_step(statement) != SQLITE_DONE {
      throw JournalError.execFailed(sqlite3_errcode(db))
    }
  }

  func listUnapplied() throws -> [(transactionId: String, payload: String)] {
    var statement: OpaquePointer?
    let sql = "SELECT transaction_id, payload FROM editor_intake WHERE applied = 0 ORDER BY rowid"
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw JournalError.execFailed(sqlite3_errcode(db))
    }
    defer { sqlite3_finalize(statement) }
    var rows: [(String, String)] = []
    while sqlite3_step(statement) == SQLITE_ROW {
      let id = sqlite3_column_text(statement, 0).map { String(cString: $0) } ?? ""
      let payload = sqlite3_column_text(statement, 1).map { String(cString: $0) } ?? ""
      rows.append((id, payload))
    }
    return rows
  }

  private func exec(_ sql: String) throws {
    var errorMessage: UnsafeMutablePointer<CChar>?
    let status = sqlite3_exec(db, sql, nil, nil, &errorMessage)
    if let errorMessage {
      sqlite3_free(errorMessage)
    }
    if status != SQLITE_OK {
      throw JournalError.execFailed(status)
    }
  }
}
