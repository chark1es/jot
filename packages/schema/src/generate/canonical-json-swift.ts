import { GENERATED_HEADER } from "./header.js";

export function emitCanonicalJsonSwift(): string {
  return `${GENERATED_HEADER}

import Foundation

public enum CanonicalJsonError: Error, Equatable {
    case nonIntegerNumber
    case nonFiniteNumber
    case unpairedSurrogate
    case undefinedField(String)
    case invalidValue(String)
}

public enum CanonicalJsonValue: Equatable {
    case null
    case bool(Bool)
    case integer(Int64)
    case string(String)
    case array([CanonicalJsonValue])
    case object([String: CanonicalJsonValue])
}

public enum CanonicalJson {
    public static func canonicalize(_ value: CanonicalJsonValue) throws -> Data {
        var bytes: [UInt8] = []
        try emit(value, into: &bytes)
        return Data(bytes)
    }

    public static func canonicalizeToString(_ value: CanonicalJsonValue) throws -> String {
        let data = try canonicalize(value)
        guard let string = String(data: data, encoding: .utf8) else {
            throw CanonicalJsonError.invalidValue("utf8")
        }
        return string
    }

    private static func emit(_ value: CanonicalJsonValue, into bytes: inout [UInt8]) throws {
        switch value {
        case .null:
            bytes.append(contentsOf: Array("null".utf8))
        case .bool(let flag):
            bytes.append(contentsOf: Array((flag ? "true" : "false").utf8))
        case .integer(let number):
            bytes.append(contentsOf: Array(String(number).utf8))
        case .string(let text):
            try emitString(text, into: &bytes)
        case .array(let items):
            bytes.append(0x5B)
            for (index, item) in items.enumerated() {
                if index > 0 {
                    bytes.append(0x2C)
                }
                try emit(item, into: &bytes)
            }
            bytes.append(0x5D)
        case .object(let object):
            bytes.append(0x7B)
            let keys = object.keys.sorted(by: utf8LessThan)
            for (index, key) in keys.enumerated() {
                if index > 0 {
                    bytes.append(0x2C)
                }
                try emitString(key, into: &bytes)
                bytes.append(0x3A)
                guard let field = object[key] else {
                    throw CanonicalJsonError.undefinedField(key)
                }
                try emit(field, into: &bytes)
            }
            bytes.append(0x7D)
        }
    }

    private static func utf8LessThan(_ left: String, _ right: String) -> Bool {
        let a = Array(left.utf8)
        let b = Array(right.utf8)
        let count = min(a.count, b.count)
        var index = 0
        while index < count {
            if a[index] != b[index] {
                return a[index] < b[index]
            }
            index += 1
        }
        return a.count < b.count
    }

    private static func rejectUnpairedSurrogates(_ value: String) throws {
        var iterator = value.utf16.makeIterator()
        while let unit = iterator.next() {
            if (0xD800...0xDBFF).contains(unit) {
                guard let next = iterator.next(), (0xDC00...0xDFFF).contains(next) else {
                    throw CanonicalJsonError.unpairedSurrogate
                }
            } else if (0xDC00...0xDFFF).contains(unit) {
                throw CanonicalJsonError.unpairedSurrogate
            }
        }
    }

    private static func appendUtf8(codePoint: UInt32, into bytes: inout [UInt8]) {
        if codePoint <= 0x7F {
            bytes.append(UInt8(codePoint))
        } else if codePoint <= 0x7FF {
            bytes.append(UInt8(0xC0 | (codePoint >> 6)))
            bytes.append(UInt8(0x80 | (codePoint & 0x3F)))
        } else if codePoint <= 0xFFFF {
            bytes.append(UInt8(0xE0 | (codePoint >> 12)))
            bytes.append(UInt8(0x80 | ((codePoint >> 6) & 0x3F)))
            bytes.append(UInt8(0x80 | (codePoint & 0x3F)))
        } else {
            bytes.append(UInt8(0xF0 | (codePoint >> 18)))
            bytes.append(UInt8(0x80 | ((codePoint >> 12) & 0x3F)))
            bytes.append(UInt8(0x80 | ((codePoint >> 6) & 0x3F)))
            bytes.append(UInt8(0x80 | (codePoint & 0x3F)))
        }
    }

    private static func emitHexEscape(_ code: UInt32, into bytes: inout [UInt8]) {
        let hex = String(code, radix: 16, uppercase: false)
        let padded = String(repeating: "0", count: max(0, 4 - hex.count)) + hex
        bytes.append(0x5C)
        bytes.append(0x75)
        bytes.append(contentsOf: Array(padded.utf8))
    }

    private static func emitString(_ value: String, into bytes: inout [UInt8]) throws {
        try rejectUnpairedSurrogates(value)
        bytes.append(0x22)
        let units = Array(value.utf16)
        var index = 0
        while index < units.count {
            let code = UInt32(units[index])
            switch code {
            case 0x22:
                bytes.append(contentsOf: [0x5C, 0x22])
            case 0x5C:
                bytes.append(contentsOf: [0x5C, 0x5C])
            case 0x08:
                bytes.append(contentsOf: [0x5C, 0x62])
            case 0x0C:
                bytes.append(contentsOf: [0x5C, 0x66])
            case 0x0A:
                bytes.append(contentsOf: [0x5C, 0x6E])
            case 0x0D:
                bytes.append(contentsOf: [0x5C, 0x72])
            case 0x09:
                bytes.append(contentsOf: [0x5C, 0x74])
            default:
                if code < 0x20 {
                    emitHexEscape(code, into: &bytes)
                } else if (0xD800...0xDBFF).contains(code) {
                    let low = UInt32(units[index + 1])
                    let point = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                    appendUtf8(codePoint: point, into: &bytes)
                    index += 1
                } else {
                    appendUtf8(codePoint: code, into: &bytes)
                }
            }
            index += 1
        }
        bytes.append(0x22)
    }
}
`;
}
