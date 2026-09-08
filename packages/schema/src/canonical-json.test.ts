import { describe, expect, it } from "vitest";
import { canonicalize, canonicalizeToString } from "./canonical-json.js";
import { CanonicalJsonError } from "./errors.js";

describe("canonical JSON", () => {
  it("emits compact UTF-8 with sorted keys", () => {
    expect(canonicalizeToString({ b: 1, a: [true, false, null] })).toBe('{"a":[true,false,null],"b":1}');
  });

  it("does not escape slashes", () => {
    expect(canonicalizeToString("https://jolt.local/a")).toBe('"https://jolt.local/a"');
  });

  it("uses short escapes for the usual controls and \\u00xx otherwise", () => {
    expect(canonicalizeToString("\b\f\n\r\t")).toBe('"\\b\\f\\n\\r\\t"');
    expect(canonicalizeToString("\u0001")).toBe('"\\u0001"');
    expect(canonicalizeToString("\\")).toBe('"\\\\"');
    expect(canonicalizeToString('"')).toBe('"\\""');
  });

  it("does not \\u-escape other BMP characters", () => {
    expect(canonicalizeToString("שלום")).toBe('"שלום"');
  });

  it("rejects floats and non-finite numbers", () => {
    expect(() => canonicalize(1.5)).toThrow(CanonicalJsonError);
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(CanonicalJsonError);
  });

  it("rejects unpaired surrogates", () => {
    expect(() => canonicalize("\uD800")).toThrow(CanonicalJsonError);
    expect(() => canonicalize("\uDC00")).toThrow(CanonicalJsonError);
  });

  it("emits 0 for negative zero", () => {
    expect(canonicalizeToString(-0)).toBe("0");
  });

  it("returns UTF-8 bytes without a BOM", () => {
    const bytes = canonicalize({ z: "é" });
    expect(bytes[0]).not.toBe(0xef);
    expect(canonicalizeToString({ z: "é" })).toBe('{"z":"é"}');
  });
});
