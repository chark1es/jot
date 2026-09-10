import Foundation

/// iOS marked text stays entirely native. Intermediate IME candidates never
/// emit `committedTransaction`. On insert/unmark commit, one `replaceRange`
/// from the pre-composition range to the committed text. On cancel, emit nothing.
///
/// If the process dies during composition, the uncommitted candidate may be
/// lost. That loss is outside the committed-edit promise.
struct CompositionSession {
  var active = false
  var originRange = NSRange(location: 0, length: 0)
  var originText = ""
  var originNodeId = ""
  var originOffsetUtf16 = 0
  var originAffinity = "before"

  mutating func begin(
    range: NSRange,
    text: String,
    nodeId: String,
    offsetUtf16: Int,
    affinity: String
  ) {
    active = true
    originRange = range
    originText = text
    originNodeId = nodeId
    originOffsetUtf16 = offsetUtf16
    originAffinity = affinity
  }

  mutating func end() {
    active = false
    originRange = NSRange(location: 0, length: 0)
    originText = ""
    originNodeId = ""
    originOffsetUtf16 = 0
    originAffinity = "before"
  }

  func originSelection(revision: Int) -> SchemaSelection {
    SchemaSelection(
      nodeId: originNodeId,
      offsetUtf16: originOffsetUtf16,
      affinity: originAffinity,
      revision: revision
    )
  }
}
