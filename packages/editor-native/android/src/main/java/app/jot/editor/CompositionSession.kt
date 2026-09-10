package app.jot.editor

internal class CompositionSession {
  var active: Boolean = false
    private set

  var from: LinearSelection? = null
    private set

  var originalText: String = ""
    private set

  var cancelled: Boolean = false
    private set

  fun begin(from: LinearSelection, originalText: String) {
    if (active) {
      return
    }
    active = true
    cancelled = false
    this.from = from
    this.originalText = originalText
  }

  fun cancel() {
    if (!active) {
      return
    }
    cancelled = true
    active = false
  }

  fun takeCommit(): Finish? {
    if (!active) {
      cancelled = false
      from = null
      originalText = ""
      return null
    }
    val finish = Finish(from = from, originalText = originalText)
    active = false
    from = null
    originalText = ""
    cancelled = false
    return finish
  }

  data class Finish(
    val from: LinearSelection?,
    val originalText: String,
  )
}
