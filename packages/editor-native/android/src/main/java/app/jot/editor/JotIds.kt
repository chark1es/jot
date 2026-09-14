package app.jot.editor

internal object JotIds {
  private const val ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
  private val random = java.security.SecureRandom()

  fun createId(): String {
    val bytes = ByteArray(16)
    random.nextBytes(bytes)
    return encodeBase32(bytes)
  }

  fun deriveId(parentId: String, purpose: String, index: Int): String {
    val seed = "$parentId|$purpose|$index"
    var h1 = 0x811c9dc5.toInt()
    var h2 = 0x01000193
    var h3 = 0x243f6a88
    var h4 = (0x85a308d3).toInt()
    for (i in seed.indices) {
      val byte = seed[i].code and 0xff
      h1 = mix32(h1, byte, 0x01000193)
      h2 = mix32(h2, byte xor (i and 0xff), 0x811c9dc5.toInt())
      h3 = mix32(h3, (byte + i) and 0xff, 0x1b873593)
      h4 = mix32(h4, byte, 0x9e3779b9.toInt())
    }
    val out = ByteArray(16)
    write32(out, 0, h1)
    write32(out, 4, h2)
    write32(out, 8, h3)
    write32(out, 12, h4)
    return encodeBase32(out)
  }

  fun encodeBase32(bytes: ByteArray): String {
    var bits = 0
    var acc = 0
    val out = StringBuilder()
    for (byte in bytes) {
      acc = (acc shl 8) or (byte.toInt() and 0xff)
      bits += 8
      while (bits >= 5) {
        out.append(ALPHABET[(acc ushr (bits - 5)) and 31])
        bits -= 5
      }
    }
    if (bits > 0) {
      out.append(ALPHABET[(acc shl (5 - bits)) and 31])
    }
    return out.toString()
  }

  private fun mix32(h: Int, byte: Int, mul: Int): Int = (h xor byte) * mul

  private fun write32(out: ByteArray, offset: Int, value: Int) {
    out[offset] = (value and 0xff).toByte()
    out[offset + 1] = ((value ushr 8) and 0xff).toByte()
    out[offset + 2] = ((value ushr 16) and 0xff).toByte()
    out[offset + 3] = ((value ushr 24) and 0xff).toByte()
  }
}
