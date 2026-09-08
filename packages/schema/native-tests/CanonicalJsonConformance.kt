import org.json.JSONObject

/**
 * Loads a committed `*.canonical.json` fixture and asserts CanonicalJson
 * round-trips it byte for byte. Wire this to the Android test lane.
 */
object CanonicalJsonConformance {
    fun assertRoundTrip(canonicalJson: ByteArray) {
        val value = decode(org.json.JSONTokener(canonicalJson.toString(Charsets.UTF_8)).nextValue())
        val encoded = CanonicalJson.canonicalize(value)
        if (!encoded.contentEquals(canonicalJson)) {
            throw CanonicalJsonError("canonical round-trip mismatch")
        }
    }

    private fun decode(raw: Any?): CanonicalJsonValue {
        return when (raw) {
            null, JSONObject.NULL -> CanonicalJsonValue.Null
            is Boolean -> CanonicalJsonValue.Bool(raw)
            is Int -> CanonicalJsonValue.Integer(raw.toLong())
            is Long -> CanonicalJsonValue.Integer(raw)
            is Double -> {
                if (raw % 1.0 != 0.0) {
                    throw CanonicalJsonError("non-integer number")
                }
                CanonicalJsonValue.Integer(raw.toLong())
            }
            is String -> CanonicalJsonValue.Text(raw)
            is org.json.JSONArray -> {
                CanonicalJsonValue.ArrayValue((0 until raw.length()).map { decode(raw.get(it)) })
            }
            is org.json.JSONObject -> {
                val mapped = LinkedHashMap<String, CanonicalJsonValue>()
                for (key in raw.keys()) {
                    mapped[key] = decode(raw.get(key))
                }
                CanonicalJsonValue.ObjectValue(mapped)
            }
            else -> throw CanonicalJsonError("unsupported JSON value ${raw::class.simpleName}")
        }
    }
}
