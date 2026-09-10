import { SchemaError } from '@jot/schema';

export function assertScalarString(value: string, path: string): void {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new SchemaError('unpaired-surrogate', `${path}: unpaired high surrogate`);
      }
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new SchemaError('unpaired-surrogate', `${path}: unpaired low surrogate`);
    }
  }
}

export function assertUtf16Offset(text: string, offset: number, path: string): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    throw new SchemaError('utf16-offset', `${path}: offset ${String(offset)} is out of range`);
  }
  if (offset > 0 && offset < text.length) {
    const prev = text.charCodeAt(offset - 1);
    if (prev >= 0xd800 && prev <= 0xdbff) {
      throw new SchemaError('utf16-offset', `${path}: offset splits a surrogate pair`);
    }
  }
}
