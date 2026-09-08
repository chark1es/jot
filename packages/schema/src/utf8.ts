import { CanonicalJsonError } from "./errors.js";

export function rejectUnpairedSurrogates(value: string, path = "string"): void {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new CanonicalJsonError(
          "unpaired-surrogate",
          `${path}: unpaired high surrogate`,
        );
      }
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new CanonicalJsonError("unpaired-surrogate", `${path}: unpaired low surrogate`);
    }
  }
}

export function utf8Encode(value: string): Uint8Array {
  rejectUnpairedSurrogates(value);
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit <= 0x7f) {
      bytes.push(unit);
    } else if (unit <= 0x7ff) {
      bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(i + 1);
      i += 1;
      const codePoint = 0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00);
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];
    if (b0 === undefined) {
      break;
    }
    if (b0 <= 0x7f) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      const b1 = bytes[i + 1];
      if (b1 === undefined || (b1 & 0xc0) !== 0x80) {
        throw new CanonicalJsonError("invalid-utf8", "invalid UTF-8");
      }
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      if (b1 === undefined || b2 === undefined || (b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) {
        throw new CanonicalJsonError("invalid-utf8", "invalid UTF-8");
      }
      const codePoint = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      out += String.fromCharCode(codePoint);
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const b3 = bytes[i + 3];
      if (
        b1 === undefined ||
        b2 === undefined ||
        b3 === undefined ||
        (b1 & 0xc0) !== 0x80 ||
        (b2 & 0xc0) !== 0x80 ||
        (b3 & 0xc0) !== 0x80
      ) {
        throw new CanonicalJsonError("invalid-utf8", "invalid UTF-8");
      }
      const codePoint =
        ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      const offset = codePoint - 0x10000;
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
      i += 4;
    } else {
      throw new CanonicalJsonError("invalid-utf8", "invalid UTF-8");
    }
  }
  return out;
}

export function utf8Compare(a: string, b: string): number {
  const left = utf8Encode(a);
  const right = utf8Encode(b);
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const av = left[i];
    const bv = right[i];
    if (av === undefined || bv === undefined || av === bv) {
      continue;
    }
    return av < bv ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}
