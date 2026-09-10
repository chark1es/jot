package app.jot.editor

internal object JsonParser {
  fun parseObject(text: String): Map<String, Any?> {
    val reader = Reader(text)
    val value = reader.parseValue()
    reader.skipWs()
    require(reader.eof) { "trailing json" }
    @Suppress("UNCHECKED_CAST")
    return value as Map<String, Any?>
  }

  private class Reader(private val text: String) {
    private var i = 0

    val eof: Boolean
      get() = i >= text.length

    fun skipWs() {
      while (i < text.length && text[i].isWhitespace()) {
        i += 1
      }
    }

    fun parseValue(): Any? {
      skipWs()
      check(i < text.length) { "unexpected end" }
      return when (val ch = text[i]) {
        '{' -> parseObject()
        '[' -> parseArray()
        '"' -> parseString()
        't', 'f' -> parseBoolean()
        'n' -> parseNull()
        '-', in '0'..'9' -> parseNumber()
        else -> error("unexpected '$ch'")
      }
    }

    private fun parseObject(): Map<String, Any?> {
      i += 1
      val out = linkedMapOf<String, Any?>()
      skipWs()
      if (peek('}')) {
        i += 1
        return out
      }
      while (true) {
        skipWs()
        val key = parseString()
        skipWs()
        require(peek(':')) { "expected ':'" }
        i += 1
        out[key] = parseValue()
        skipWs()
        when {
          peek(',') -> i += 1
          peek('}') -> {
            i += 1
            return out
          }
          else -> error("expected ',' or '}'")
        }
      }
    }

    private fun parseArray(): List<Any?> {
      i += 1
      val out = mutableListOf<Any?>()
      skipWs()
      if (peek(']')) {
        i += 1
        return out
      }
      while (true) {
        out.add(parseValue())
        skipWs()
        when {
          peek(',') -> i += 1
          peek(']') -> {
            i += 1
            return out
          }
          else -> error("expected ',' or ']'")
        }
      }
    }

    private fun parseString(): String {
      require(peek('"')) { "expected string" }
      i += 1
      val out = StringBuilder()
      while (i < text.length) {
        val ch = text[i]
        i += 1
        when (ch) {
          '"' -> return out.toString()
          '\\' -> {
            check(i < text.length) { "unterminated escape" }
            val esc = text[i]
            i += 1
            out.append(
              when (esc) {
                '"', '\\', '/' -> esc
                'b' -> '\b'
                'f' -> '\u000C'
                'n' -> '\n'
                'r' -> '\r'
                't' -> '\t'
                'u' -> {
                  check(i + 4 <= text.length) { "bad unicode escape" }
                  val code = text.substring(i, i + 4).toInt(16)
                  i += 4
                  code.toChar()
                }
                else -> error("bad escape")
              },
            )
          }
          else -> out.append(ch)
        }
      }
      error("unterminated string")
    }

    private fun parseBoolean(): Boolean {
      return when {
        match("true") -> true
        match("false") -> false
        else -> error("expected boolean")
      }
    }

    private fun parseNull(): Any? {
      require(match("null")) { "expected null" }
      return null
    }

    private fun parseNumber(): Number {
      val start = i
      if (peek('-')) {
        i += 1
      }
      while (i < text.length && text[i] in '0'..'9') {
        i += 1
      }
      var fractional = false
      if (peek('.')) {
        fractional = true
        i += 1
        while (i < text.length && text[i] in '0'..'9') {
          i += 1
        }
      }
      if (i < text.length && (text[i] == 'e' || text[i] == 'E')) {
        fractional = true
        i += 1
        if (peek('+') || peek('-')) {
          i += 1
        }
        while (i < text.length && text[i] in '0'..'9') {
          i += 1
        }
      }
      val raw = text.substring(start, i)
      if (!fractional) {
        val asLong = raw.toLong()
        if (asLong in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) {
          return asLong.toInt()
        }
        return asLong
      }
      return raw.toDouble()
    }

    private fun peek(ch: Char): Boolean = i < text.length && text[i] == ch

    private fun match(token: String): Boolean {
      if (text.startsWith(token, i)) {
        i += token.length
        return true
      }
      return false
    }
  }
}
