import Foundation
import Security

enum JotIds {
  static let length = 26
  static let byteLength = 16
  private static let alphabet = Array("abcdefghijklmnopqrstuvwxyz234567")

  static func create() -> String {
    var bytes = [UInt8](repeating: 0, count: byteLength)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    if status != errSecSuccess {
      for i in 0..<bytes.count {
        bytes[i] = UInt8.random(in: 0...255)
      }
    }
    return encodeBase32(bytes)
  }

  static func encodeBase32(_ bytes: [UInt8]) -> String {
    var bits = 0
    var acc = 0
    var out = ""
    out.reserveCapacity(length)
    for byte in bytes {
      acc = (acc << 8) | Int(byte)
      bits += 8
      while bits >= 5 {
        let index = (acc >> (bits - 5)) & 31
        out.append(alphabet[index])
        bits -= 5
      }
    }
    if bits > 0 {
      let index = (acc << (5 - bits)) & 31
      out.append(alphabet[index])
    }
    if out.count >= length {
      return String(out.prefix(length))
    }
    return out.padding(toLength: length, withPad: "a", startingAt: 0)
  }

  static func derive(parentId: String, purpose: String, index: Int) -> String {
    let seed = Array("\(parentId)|\(purpose)|\(index)".utf8)
    var h1: UInt32 = 0x811c9dc5
    var h2: UInt32 = 0x01000193
    var h3: UInt32 = 0x243f6a88
    var h4: UInt32 = 0x85a308d3
    for (i, byte) in seed.enumerated() {
      h1 = mix32(h1, UInt32(byte), 0x01000193)
      h2 = mix32(h2, UInt32(byte) ^ UInt32(i & 0xff), 0x811c9dc5)
      h3 = mix32(h3, UInt32((Int(byte) + i) & 0xff), 0x1b873593)
      h4 = mix32(h4, UInt32(byte), 0x9e3779b9)
    }
    var out = [UInt8](repeating: 0, count: byteLength)
    write32(&out, 0, h1)
    write32(&out, 4, h2)
    write32(&out, 8, h3)
    write32(&out, 12, h4)
    return encodeBase32(out)
  }

  private static func mix32(_ h: UInt32, _ byte: UInt32, _ mul: UInt32) -> UInt32 {
    return (h ^ byte) &* mul
  }

  private static func write32(_ out: inout [UInt8], _ offset: Int, _ value: UInt32) {
    out[offset] = UInt8(value & 0xff)
    out[offset + 1] = UInt8((value >> 8) & 0xff)
    out[offset + 2] = UInt8((value >> 16) & 0xff)
    out[offset + 3] = UInt8((value >> 24) & 0xff)
  }
}

enum Utf16 {
  static func count(_ string: String) -> Int {
    string.utf16.count
  }

  static func hasUnpairedSurrogates(_ string: String) -> Bool {
    let units = Array(string.utf16)
    var i = 0
    while i < units.count {
      let unit = units[i]
      if unit >= 0xD800 && unit <= 0xDBFF {
        if i + 1 >= units.count {
          return true
        }
        let next = units[i + 1]
        if next < 0xDC00 || next > 0xDFFF {
          return true
        }
        i += 2
      } else if unit >= 0xDC00 && unit <= 0xDFFF {
        return true
      } else {
        i += 1
      }
    }
    return false
  }

  static func slice(_ string: String, offset: Int, length: Int) -> String {
    let units = Array(string.utf16)
    let start = max(0, min(offset, units.count))
    let end = max(start, min(start + max(0, length), units.count))
    if start >= end {
      return ""
    }
    return String(utf16CodeUnits: Array(units[start..<end]), count: end - start)
  }

  static func concat(_ parts: [String]) -> String {
    parts.joined()
  }

  static func insert(_ string: String, offset: Int, text: String) -> String {
    let units = Array(string.utf16)
    let inserted = Array(text.utf16)
    let index = max(0, min(offset, units.count))
    var out: [UInt16] = []
    out.reserveCapacity(units.count + inserted.count)
    out.append(contentsOf: units[..<index])
    out.append(contentsOf: inserted)
    out.append(contentsOf: units[index...])
    return String(utf16CodeUnits: out, count: out.count)
  }

  static func delete(_ string: String, offset: Int, length: Int) -> String {
    let units = Array(string.utf16)
    let start = max(0, min(offset, units.count))
    let end = max(start, min(start + max(0, length), units.count))
    var out: [UInt16] = []
    out.append(contentsOf: units[..<start])
    out.append(contentsOf: units[end...])
    return String(utf16CodeUnits: out, count: out.count)
  }
}
