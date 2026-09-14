import QuartzCore
import os

/// Debug-level timings for committed edits. Debug messages are not persisted; read them with
/// `xcrun simctl spawn booted log stream --level debug --predicate 'subsystem == "app.jot.editor"'`.
enum EditorPerformanceLog {
  private static let logger = Logger(subsystem: "app.jot.editor", category: "performance")

  static func now() -> CFTimeInterval {
    CACurrentMediaTime()
  }

  /// One incremental redraw: building the attributed segment, then swapping it into storage.
  static func segment(blocks: Int, build: CFTimeInterval, replace: CFTimeInterval) {
    logger.debug(
      "segment blocks=\(blocks, privacy: .public) build_ms=\(build * 1000, format: .fixed(precision: 2), privacy: .public) replace_ms=\(replace * 1000, format: .fixed(precision: 2), privacy: .public)"
    )
  }

  /// A whole redraw: the storage change, then caret restore, scroll correction, and typing attributes.
  static func rebuild(replace: CFTimeInterval, caret: CFTimeInterval, scroll: CFTimeInterval, typing: CFTimeInterval) {
    logger.debug(
      "rebuild replace_ms=\(replace * 1000, format: .fixed(precision: 2), privacy: .public) caret_ms=\(caret * 1000, format: .fixed(precision: 2), privacy: .public) scroll_ms=\(scroll * 1000, format: .fixed(precision: 2), privacy: .public) typing_ms=\(typing * 1000, format: .fixed(precision: 2), privacy: .public)"
    )
  }

  static func commit(blocks: Int, journal: CFTimeInterval, apply: CFTimeInterval, render: CFTimeInterval, history: CFTimeInterval) {
    let total = journal + apply + render + history
    logger.debug(
      "commit blocks=\(blocks, privacy: .public) journal_ms=\(journal * 1000, format: .fixed(precision: 2), privacy: .public) apply_ms=\(apply * 1000, format: .fixed(precision: 2), privacy: .public) render_ms=\(render * 1000, format: .fixed(precision: 2), privacy: .public) history_ms=\(history * 1000, format: .fixed(precision: 2), privacy: .public) total_ms=\(total * 1000, format: .fixed(precision: 2), privacy: .public)"
    )
  }
}
