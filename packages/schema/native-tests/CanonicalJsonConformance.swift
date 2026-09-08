import Foundation

/// Loads a committed `*.canonical.json` fixture and asserts the generated encoder
/// round-trips it byte for byte. Wire this to XCTest / Swift Testing in the native lane.
public enum CanonicalJsonConformance {
    public static func assertRoundTrip(canonicalJSON: Data) throws {
        let object = try JSONSerialization.jsonObject(with: canonicalJSON, options: [.fragmentsAllowed])
        let value = try decode(object)
        let encoded = try CanonicalJson.canonicalize(value)
        if encoded != canonicalJSON {
            throw CanonicalJsonError.invalidValue("canonical round-trip mismatch")
        }
    }

    private static func decode(_ raw: Any) throws -> CanonicalJsonValue {
        if raw is NSNull {
            return .null
        }
        if let flag = raw as? Bool {
            return .bool(flag)
        }
        if let number = raw as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return .bool(number.boolValue)
            }
            guard number.doubleValue.rounded() == number.doubleValue else {
                throw CanonicalJsonError.nonIntegerNumber
            }
            return .integer(number.int64Value)
        }
        if let text = raw as? String {
            return .string(text)
        }
        if let items = raw as? [Any] {
            return .array(try items.map(decode))
        }
        if let object = raw as? [String: Any] {
            var mapped: [String: CanonicalJsonValue] = [:]
            for (key, field) in object {
                mapped[key] = try decode(field)
            }
            return .object(mapped)
        }
        throw CanonicalJsonError.invalidValue("unsupported JSON value")
    }
}
