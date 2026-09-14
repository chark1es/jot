package app.jot.editor

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.media.ExifInterface
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.LeadingMarginSpan
import android.text.style.LineBackgroundSpan
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import android.text.style.StrikethroughSpan
import android.text.style.UnderlineSpan
import android.text.style.UpdateLayout
import android.util.LruCache
import android.util.TypedValue
import java.io.File
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Colors and type from `@jot/tokens`: warm ink on canvas, Noto Serif for writing. */
internal class EditorTheme(context: Context, accentOverride: Int?) {
  private val dark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
  private val metrics = context.resources.displayMetrics

  val ink = if (dark) 0xFFECEAE4.toInt() else 0xFF1A1916.toInt()
  val inkMuted = if (dark) 0xFFA8A39A.toInt() else 0xFF534F48.toInt()
  val inkFaint = if (dark) 0xFF908B82.toInt() else 0xFF68635B.toInt()
  val hairline = if (dark) 0xFF3A3834.toInt() else 0xFFD5D1C8.toInt()
  val fill = if (dark) 0xFF2A2926.toInt() else 0xFFECEAE4.toInt()
  val accent = accentOverride ?: if (dark) 0xFF9EB6C9.toInt() else 0xFF2E4A63.toInt()

  val serif: Typeface = Typeface.create(Typeface.SERIF, 400, false)
  val serifSemibold: Typeface = Typeface.create(Typeface.SERIF, 600, false)
  val serifBold: Typeface = Typeface.create(Typeface.SERIF, 700, false)
  private val mono: Typeface = Typeface.MONOSPACE

  fun dp(value: Float): Float = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, metrics)

  fun sp(value: Float): Float = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, value, metrics)

  fun typeface(block: LinearBlock, bold: Boolean, italic: Boolean, code: Boolean): Typeface {
    if (code || block.kind == LinearBlockKind.CODE_BLOCK) {
      return Typeface.create(mono, if (bold) 600 else 400, italic)
    }
    val weight = when {
      block.kind == LinearBlockKind.HEADING && (block.headingLevel ?: 1) <= 2 -> 700
      block.kind == LinearBlockKind.HEADING -> 600
      bold -> 700
      else -> 400
    }
    return Typeface.create(Typeface.SERIF, weight, italic)
  }

  fun textSize(block: LinearBlock, code: Boolean): Float {
    if (block.kind == LinearBlockKind.CODE_BLOCK) {
      return sp(15f)
    }
    if (code) {
      return sp(15.5f)
    }
    if (block.kind != LinearBlockKind.HEADING) {
      return sp(17f)
    }
    return when (block.headingLevel ?: 1) {
      1 -> sp(28f)
      2 -> sp(22f)
      3 -> sp(20f)
      4, 5 -> sp(17f)
      else -> sp(15f)
    }
  }
}

internal class RenderContext(
  val theme: EditorTheme,
  val contentWidth: Int,
  val imagePaths: Map<String, String>,
  val attachmentsDirectory: File?,
  /** Widths shown while a pinch is still in progress, keyed by image node id. */
  val imageWidthOverrides: Map<String, Int>,
) {
  fun imageFile(attachmentId: String): File? {
    imagePaths[attachmentId]?.let { return File(it) }
    val directory = attachmentsDirectory ?: return null
    if (attachmentId.isEmpty()) {
      return null
    }
    return File(directory, attachmentId).takeIf { it.exists() }
  }
}

/**
 * Kotlin counterpart of `AttributedBridge.swift`. The text is `EditPlanner.displayText`: markers as
 * object replacement characters drawn by spans, block text, and a newline after every block but
 * the last. Each block's paragraph spans cover its own characters and its newline.
 */
internal object EditorRenderer {
  private val bullets = listOf("•", "◦", "▪")

  fun render(linear: LinearDocument, from: Int, until: Int, context: RenderContext): SpannableStringBuilder {
    val out = SpannableStringBuilder()
    val markers = listMarkers(linear.blocks)
    for (index in from until until) {
      appendBlock(out, linear.blocks[index], markers[index], index + 1 < linear.blocks.size, context)
    }
    return out
  }

  /** End offset of each block's text, before its newline, in editor characters. */
  fun blockEnds(linear: LinearDocument): IntArray {
    val ends = IntArray(linear.blocks.size)
    var cursor = 0
    linear.blocks.forEachIndexed { index, block ->
      cursor += LinearModel.leadingCount(block) + block.utf16Length
      ends[index] = cursor
      if (index + 1 < linear.blocks.size) {
        cursor += 1
      }
    }
    return ends
  }

  /** Bullet or number for every list item, keyed by block index. Numbers count one list at one depth. */
  fun listMarkers(blocks: List<LinearBlock>): Map<Int, String> {
    val counters = mutableMapOf<String, Int>()
    val markers = mutableMapOf<Int, String>()
    blocks.forEachIndexed { index, block ->
      when (block.kind) {
        LinearBlockKind.BULLET_ITEM -> markers[index] = bullets[block.indent % bullets.size]
        LinearBlockKind.ORDERED_ITEM -> {
          val key = "${block.listId ?: ""}|${block.indent}"
          val next = (counters[key] ?: (max(1, block.listStart ?: 1) - 1)) + 1
          counters[key] = next
          markers[index] = "$next."
        }
        else -> Unit
      }
    }
    return markers
  }

  private fun appendBlock(out: SpannableStringBuilder, block: LinearBlock, marker: String?, separator: Boolean, context: RenderContext) {
    val theme = context.theme
    val start = out.length
    val checked = block.kind == LinearBlockKind.TASK_ITEM && block.checked == 1
    val color = if (checked || block.quoteChain.isNotEmpty()) theme.inkMuted else theme.ink
    val size = theme.textSize(block, code = false)
    val baseFace = theme.typeface(block, bold = false, italic = false, code = false)
    val markerPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      typeface = theme.serif
      textSize = theme.sp(17f)
    }
    val markerWidth = marker?.let { max(theme.dp(22f), ceil(markerPaint.measureText(it))) } ?: 0f

    if (block.quoteChain.isNotEmpty()) {
      appendAtom(out, QuoteBarSpan(theme.hairline, theme.dp(3f), theme.dp(10f)))
    }
    when (block.kind) {
      LinearBlockKind.TASK_ITEM ->
        appendAtom(out, CheckboxSpan(block.id, checked, theme.accent, theme.inkFaint, theme.dp(22f), theme.dp(8f)))
      LinearBlockKind.BULLET_ITEM, LinearBlockKind.ORDERED_ITEM ->
        appendAtom(out, ListMarkerSpan(marker ?: bullets[0], markerPaint.typeface, markerPaint.textSize, theme.ink, markerWidth, theme.dp(6f)))
      else -> Unit
    }

    when (block.kind) {
      LinearBlockKind.HORIZONTAL_RULE -> appendAtom(out, DividerSpan(context.contentWidth, theme.hairline, theme.dp(14f)))
      LinearBlockKind.IMAGE -> {
        val node = block.placeholderNode
        val attachmentId = Json.str(node?.attrs?.get("attachmentId")) ?: ""
        val stored = Json.int(node?.attrs?.get("widthBasisPoints")) ?: 10000
        val width = context.imageWidthOverrides[block.id] ?: stored
        appendAtom(
          out,
          ImageBlockSpan(
            nodeId = block.id,
            attachmentId = attachmentId,
            alt = Json.str(node?.attrs?.get("alt")) ?: block.plainText,
            widthBasisPoints = width.coerceIn(1, 10000),
            file = context.imageFile(attachmentId),
            contentWidth = context.contentWidth,
            placeholderColor = theme.fill,
            glyphColor = theme.inkFaint,
            cornerRadius = theme.dp(10f),
            minimumHeight = theme.dp(80f),
          ),
        )
      }
      LinearBlockKind.PLACEHOLDER -> appendAtom(out, PlaceholderSpan(block.plainText, theme.inkMuted, theme.dp(12f), theme.dp(16f)))
      else -> for (run in block.runs) {
        if (run.isPlaceholder) {
          appendAtom(out, PlaceholderSpan(run.fallbackText, theme.inkMuted, theme.dp(12f), theme.dp(16f)))
          continue
        }
        val runStart = out.length
        out.append(run.text)
        val runEnd = out.length
        if (runEnd == runStart) {
          continue
        }
        val bold = run.marks.any { it.type == "bold" }
        val italic = run.marks.any { it.type == "italic" }
        val code = run.marks.any { it.type == "inlineCode" }
        if (bold || italic || code) {
          out.setSpan(TextStyleSpan(theme.typeface(block, bold, italic, code), theme.textSize(block, code), null), runStart, runEnd, EXCLUSIVE)
        }
        if (run.marks.any { it.type == "underline" }) {
          out.setSpan(JotUnderlineSpan(), runStart, runEnd, EXCLUSIVE)
        }
        if (run.marks.any { it.type == "strikethrough" } || checked) {
          out.setSpan(JotStrikethroughSpan(), runStart, runEnd, EXCLUSIVE)
        }
        if (code && block.kind != LinearBlockKind.CODE_BLOCK) {
          out.setSpan(JotBackgroundSpan(theme.fill), runStart, runEnd, EXCLUSIVE)
        }
        val link = run.marks.firstOrNull { it.type == "link" }
        if (link != null && !Json.str(link.attrs["href"]).isNullOrEmpty()) {
          out.setSpan(JotColorSpan(theme.accent), runStart, runEnd, EXCLUSIVE)
          out.setSpan(JotUnderlineSpan(), runStart, runEnd, EXCLUSIVE)
        }
      }
    }
    if (separator) {
      out.append('\n')
    }
    val end = out.length
    if (end == start) {
      return
    }
    // The base style goes first so run styles set above, which Android applies in insertion order
    // after it, still win. Inserting at the front of the span list keeps that order.
    insertSpanFirst(out, TextStyleSpan(baseFace, size, color), start, end)

    val indent = block.indent * theme.dp(24f)
    var first = indent
    var rest = indent
    var before = 0f
    var after = theme.dp(10f)
    when (block.kind) {
      LinearBlockKind.BULLET_ITEM, LinearBlockKind.ORDERED_ITEM -> {
        rest += markerWidth + theme.dp(6f)
        after = theme.dp(4f)
      }
      LinearBlockKind.TASK_ITEM -> {
        rest += theme.dp(30f)
        after = theme.dp(6f)
      }
      LinearBlockKind.CODE_BLOCK -> {
        first += theme.dp(8f)
        rest += theme.dp(8f)
        after = 0f
        out.setSpan(CodeBackgroundSpan(theme.fill), start, end, PARAGRAPH)
      }
      LinearBlockKind.HEADING -> {
        before = theme.dp(if ((block.headingLevel ?: 1) <= 2) 12f else 8f)
        after = theme.dp(6f)
      }
      LinearBlockKind.IMAGE -> {
        before = theme.dp(6f)
        after = theme.dp(14f)
      }
      LinearBlockKind.HORIZONTAL_RULE -> {
        before = theme.dp(4f)
        after = theme.dp(12f)
      }
      else -> Unit
    }
    if (block.quoteChain.isNotEmpty()) {
      rest += theme.dp(13f)
    }
    if (first > 0f || rest > 0f) {
      out.setSpan(JotMarginSpan(first.toInt(), rest.toInt()), start, end, PARAGRAPH)
    }
    out.setSpan(ParagraphSpacingSpan(before.toInt(), after.toInt()), start, end, PARAGRAPH)
  }

  private fun appendAtom(out: SpannableStringBuilder, span: Any) {
    val at = out.length
    out.append(OBJECT_REPLACEMENT)
    out.setSpan(span, at, at + 1, EXCLUSIVE)
  }

  private fun insertSpanFirst(out: SpannableStringBuilder, span: TextStyleSpan, start: Int, end: Int) {
    val existing = out.getSpans(start, end, TextStyleSpan::class.java)
      .map { Triple(it, out.getSpanStart(it), out.getSpanEnd(it)) }
    existing.forEach { out.removeSpan(it.first) }
    out.setSpan(span, start, end, EXCLUSIVE)
    existing.forEach { (item, itemStart, itemEnd) -> out.setSpan(item, itemStart, itemEnd, EXCLUSIVE) }
  }

  const val EXCLUSIVE = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
  private const val PARAGRAPH = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
}

/** Marker interface for every span the renderer owns, so a redraw removes these and leaves IME spans alone. */
internal interface EditorSpan {
  /** Everything that decides how the span draws. Equal signatures at equal positions mean nothing to redraw. */
  val signature: String
}

internal class JotUnderlineSpan : UnderlineSpan(), EditorSpan {
  override val signature: String
    get() = "underline"
}

internal class JotStrikethroughSpan : StrikethroughSpan(), EditorSpan {
  override val signature: String
    get() = "strikethrough"
}

internal class JotBackgroundSpan(color: Int) : BackgroundColorSpan(color), EditorSpan {
  override val signature: String
    get() = "background|$backgroundColor"
}

internal class JotColorSpan(color: Int) : ForegroundColorSpan(color), EditorSpan {
  override val signature: String
    get() = "color|$foregroundColor"
}

/** Paragraph spans implement UpdateLayout so a redraw that only swaps spans still reflows the text. */
internal class JotMarginSpan(first: Int, rest: Int) : LeadingMarginSpan.Standard(first, rest), UpdateLayout, EditorSpan {
  override val signature: String
    get() = "margin|${getLeadingMargin(true)}|${getLeadingMargin(false)}"
}

internal class TextStyleSpan(private val face: Typeface, private val sizePx: Float, private val color: Int?) : MetricAffectingSpan(), EditorSpan {
  override val signature: String
    get() = "text|${System.identityHashCode(face)}|$sizePx|$color"

  override fun updateMeasureState(paint: TextPaint) {
    paint.typeface = face
    paint.textSize = sizePx
  }

  override fun updateDrawState(paint: TextPaint) {
    updateMeasureState(paint)
    if (color != null) {
      paint.color = color
    }
  }
}

internal class ParagraphSpacingSpan(private val before: Int, private val after: Int) : LineHeightSpan, UpdateLayout, EditorSpan {
  override val signature: String
    get() = "spacing|$before|$after"

  override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanstartv: Int, lineHeight: Int, fm: Paint.FontMetricsInt) {
    val spanned = text as? Spanned ?: return
    if (before > 0 && start == spanned.getSpanStart(this)) {
      fm.ascent -= before
      fm.top -= before
    }
    if (after > 0 && end == spanned.getSpanEnd(this)) {
      fm.descent += after
      fm.bottom += after
    }
  }
}

internal class CodeBackgroundSpan(private val color: Int) : LineBackgroundSpan, EditorSpan {
  override val signature: String
    get() = "code|$color"

  override fun drawBackground(
    canvas: Canvas,
    paint: Paint,
    left: Int,
    right: Int,
    top: Int,
    baseline: Int,
    bottom: Int,
    text: CharSequence,
    start: Int,
    end: Int,
    lineNumber: Int,
  ) {
    val previous = paint.color
    paint.color = color
    canvas.drawRect(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat(), paint)
    paint.color = previous
  }
}

internal class ListMarkerSpan(
  private val label: String,
  private val face: Typeface,
  private val sizePx: Float,
  private val color: Int,
  private val width: Float,
  private val gap: Float,
) : ReplacementSpan(), EditorSpan {
  override val signature: String
    get() = "marker|$label|${System.identityHashCode(face)}|$sizePx|$color|$width|$gap"

  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int = ceil(width + gap).toInt()

  override fun draw(canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
    val marker = TextPaint(paint).apply {
      typeface = face
      textSize = sizePx
      this.color = this@ListMarkerSpan.color
    }
    canvas.drawText(label, x + width - marker.measureText(label), y.toFloat(), marker)
  }
}

internal class CheckboxSpan(
  val nodeId: String,
  private val checked: Boolean,
  private val accent: Int,
  private val stroke: Int,
  private val size: Float,
  private val gap: Float,
) : ReplacementSpan(), EditorSpan {
  override val signature: String
    get() = "checkbox|$nodeId|$checked|$accent|$stroke|$size|$gap"

  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int = ceil(size + gap).toInt()

  override fun draw(canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
    val radius = size * 0.43f
    val cx = x + size / 2
    val cy = y + (paint.descent() + paint.ascent()) / 2
    val circle = Paint(Paint.ANTI_ALIAS_FLAG)
    if (checked) {
      circle.color = accent
      canvas.drawCircle(cx, cy, radius, circle)
      val check = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        style = Paint.Style.STROKE
        strokeWidth = size * 0.09f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
      }
      val path = Path().apply {
        moveTo(cx - radius * 0.45f, cy + radius * 0.02f)
        lineTo(cx - radius * 0.1f, cy + radius * 0.36f)
        lineTo(cx + radius * 0.48f, cy - radius * 0.34f)
      }
      canvas.drawPath(path, check)
    } else {
      circle.color = stroke
      circle.style = Paint.Style.STROKE
      circle.strokeWidth = size * 0.07f
      canvas.drawCircle(cx, cy, radius, circle)
    }
  }
}

internal class QuoteBarSpan(private val color: Int, private val barWidth: Float, private val gap: Float) : ReplacementSpan(), EditorSpan {
  override val signature: String
    get() = "quote|$color|$barWidth|$gap"

  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int = ceil(barWidth + gap).toInt()

  override fun draw(canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
    val bar = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = this@QuoteBarSpan.color }
    val lineTop = y + paint.ascent()
    val lineBottom = y + paint.descent()
    canvas.drawRoundRect(RectF(x, lineTop, x + barWidth, lineBottom), barWidth / 2, barWidth / 2, bar)
  }
}

internal class DividerSpan(private val width: Int, private val color: Int, private val height: Float) : ReplacementSpan(), EditorSpan {
  override val signature: String
    get() = "divider|$width|$color|$height"

  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    if (fm != null) {
      fm.ascent = -height.toInt()
      fm.top = fm.ascent
      fm.descent = 0
      fm.bottom = 0
    }
    return max(width, 40)
  }

  override fun draw(canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
    val line = Paint().apply { this.color = this@DividerSpan.color }
    val mid = y - height / 2
    canvas.drawRect(x, mid, x + max(width, 40), mid + 1f, line)
  }
}

internal class PlaceholderSpan(val fallback: String, private val color: Int, private val width: Float, private val height: Float) : ReplacementSpan(), EditorSpan {
  override val signature: String
    get() = "placeholder|$fallback|$color|$width|$height"

  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int = ceil(width).toInt()

  override fun draw(canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
    val box = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = this@PlaceholderSpan.color }
    val boxTop = y - height * 0.8f
    canvas.drawRect(x + width * 0.17f, boxTop + height * 0.12f, x + width * 0.83f, boxTop + height * 0.88f, box)
  }
}

internal class ImageBlockSpan(
  val nodeId: String,
  val attachmentId: String,
  val alt: String,
  val widthBasisPoints: Int,
  file: File?,
  private val contentWidth: Int,
  private val placeholderColor: Int,
  private val glyphColor: Int,
  private val cornerRadius: Float,
  minimumHeight: Float,
) : ReplacementSpan(), EditorSpan {
  override val signature: String
    get() = "image|$nodeId|$attachmentId|$alt|$widthBasisPoints|$contentWidth|$displayWidth|$displayHeight|${bitmap?.generationId}"

  private val displayWidth = floor(max(contentWidth, 40) * widthBasisPoints / 10000f).toInt().coerceAtLeast(1)
  private val bitmap: Bitmap? = file?.let { ImageRenderCache.bitmap(it, displayWidth) }
  private val displayHeight = bitmap?.let { floor(displayWidth * it.height.toFloat() / it.width).toInt() }
    ?: max(minimumHeight, floor(displayWidth * 0.56f)).toInt()

  /** Where the image was last drawn, in layout coordinates, for taps and pinches. */
  var drawnRect = RectF()
    private set

  override fun getSize(paint: Paint, text: CharSequence?, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    if (fm != null) {
      fm.ascent = -displayHeight
      fm.top = fm.ascent
      fm.descent = 0
      fm.bottom = 0
    }
    return max(contentWidth, displayWidth)
  }

  override fun draw(canvas: Canvas, text: CharSequence?, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
    val left = x + (max(contentWidth, displayWidth) - displayWidth) / 2f
    val rect = RectF(left, (y - displayHeight).toFloat(), left + displayWidth, y.toFloat())
    drawnRect = RectF(rect)
    val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    val image = bitmap
    if (image != null) {
      val shader = BitmapShader(image, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
      shader.setLocalMatrix(
        Matrix().apply {
          setScale(rect.width() / image.width, rect.height() / image.height)
          postTranslate(rect.left, rect.top)
        },
      )
      fillPaint.shader = shader
      canvas.drawRoundRect(rect, cornerRadius, cornerRadius, fillPaint)
      return
    }
    fillPaint.color = placeholderColor
    canvas.drawRoundRect(rect, cornerRadius, cornerRadius, fillPaint)
    val glyph = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = glyphColor
      style = Paint.Style.STROKE
      strokeWidth = cornerRadius * 0.18f
      strokeJoin = Paint.Join.ROUND
    }
    val unit = min(rect.width(), rect.height()) * 0.12f
    val cx = rect.centerX()
    val cy = rect.centerY()
    canvas.drawRoundRect(RectF(cx - unit * 1.4f, cy - unit, cx + unit * 1.4f, cy + unit), unit * 0.3f, unit * 0.3f, glyph)
    val mountain = Path().apply {
      moveTo(cx - unit * 1.1f, cy + unit * 0.7f)
      lineTo(cx - unit * 0.3f, cy - unit * 0.1f)
      lineTo(cx + unit * 0.3f, cy + unit * 0.4f)
      lineTo(cx + unit * 0.7f, cy)
      lineTo(cx + unit * 1.1f, cy + unit * 0.7f)
    }
    canvas.drawPath(mountain, glyph)
  }
}

/**
 * Decodes attachments at display size. A 12 MP photo decoded at full size costs about 48 MB, so the
 * editor never asks for more pixels than the screen shows.
 */
internal object ImageRenderCache {
  private val cache = object : LruCache<String, Bitmap>(64 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount
  }

  fun bitmap(file: File, width: Int): Bitmap? {
    if (width <= 1 || !file.exists()) {
      return null
    }
    val key = "${file.absolutePath}|$width"
    cache.get(key)?.let { return it }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      return null
    }
    val orientation = try {
      ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    } catch (_: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
    val swaps = orientation in listOf(
      ExifInterface.ORIENTATION_TRANSPOSE,
      ExifInterface.ORIENTATION_ROTATE_90,
      ExifInterface.ORIENTATION_TRANSVERSE,
      ExifInterface.ORIENTATION_ROTATE_270,
    )
    val sourceWidth = if (swaps) bounds.outHeight else bounds.outWidth
    var sample = 1
    while (sourceWidth / (sample * 2) >= width) {
      sample *= 2
    }
    val decoded = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val rotation = when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_TRANSPOSE -> 90f
      ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      ExifInterface.ORIENTATION_ROTATE_270, ExifInterface.ORIENTATION_TRANSVERSE -> 270f
      else -> 0f
    }
    val upright = if (rotation == 0f) {
      decoded
    } else {
      Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(rotation) }, true)
    }
    cache.put(key, upright)
    return upright
  }
}

internal fun Layout.lineRectForOffset(offset: Int): RectF {
  val line = getLineForOffset(offset)
  return RectF(getLineLeft(line), getLineTop(line).toFloat(), getLineRight(line), getLineBottom(line).toFloat())
}
