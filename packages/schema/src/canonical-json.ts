import { CanonicalJsonError } from "./errors.js";
import { rejectUnpairedSurrogates, utf8Compare, utf8Encode } from "./utf8.js";

export type CanonicalObject = { readonly [key: string]: CanonicalValue };

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | CanonicalObject;

function emitInteger(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError("non-finite", "numbers must be finite integers");
  }
  if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new CanonicalJsonError("non-integer", "numbers must be safe integers");
  }
  if (Object.is(value, -0)) {
    return "0";
  }
  return String(value);
}

function emitString(value: string): string {
  rejectUnpairedSurrogates(value);
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x22) {
      out += '\\"';
    } else if (code === 0x5c) {
      out += "\\\\";
    } else if (code === 0x08) {
      out += "\\b";
    } else if (code === 0x0c) {
      out += "\\f";
    } else if (code === 0x0a) {
      out += "\\n";
    } else if (code === 0x0d) {
      out += "\\r";
    } else if (code === 0x09) {
      out += "\\t";
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      out += value.slice(i, i + 2);
      i += 1;
    } else {
      out += value.charAt(i);
    }
  }
  out += '"';
  return out;
}

function isCanonicalArray(value: CanonicalValue): value is readonly CanonicalValue[] {
  return Array.isArray(value);
}

function emitValue(value: CanonicalValue): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return emitInteger(value);
    case "string":
      return emitString(value);
    case "object": {
      if (isCanonicalArray(value)) {
        return `[${value.map((item) => emitValue(item)).join(",")}]`;
      }
      const keys = Object.keys(value).sort(utf8Compare);
      const fields = keys.map((key) => {
        const field = value[key];
        if (field === undefined) {
          throw new CanonicalJsonError("undefined-field", `object key ${key} has no value`);
        }
        return `${emitString(key)}:${emitValue(field)}`;
      });
      return `{${fields.join(",")}}`;
    }
    default:
      throw new CanonicalJsonError("invalid-value", "unsupported canonical JSON value");
  }
}

export function canonicalizeToString(value: CanonicalValue): string {
  return emitValue(value);
}

export function canonicalize(value: CanonicalValue): Uint8Array {
  return utf8Encode(emitValue(value));
}

export function asCanonicalValue(input: unknown, path = "$"): CanonicalValue {
  if (input === null) {
    return null;
  }
  switch (typeof input) {
    case "boolean":
      return input;
    case "number":
      emitInteger(input);
      return input;
    case "string":
      rejectUnpairedSurrogates(input, path);
      return input;
    case "object": {
      if (Array.isArray(input)) {
        return input.map((item, index) => asCanonicalValue(item, `${path}[${String(index)}]`));
      }
      const record = input as Record<string, unknown>;
      const object: Record<string, CanonicalValue> = {};
      for (const key of Object.keys(record)) {
        rejectUnpairedSurrogates(key, `${path}.key`);
        const field = record[key];
        if (field === undefined) {
          throw new CanonicalJsonError("undefined-field", `${path}.${key} is undefined`);
        }
        object[key] = asCanonicalValue(field, `${path}.${key}`);
      }
      return object;
    }
    default:
      throw new CanonicalJsonError("invalid-value", `${path}: unsupported JSON value`);
  }
}
