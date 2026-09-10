import { IdError } from "./errors.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const ALPHABET_INDEX = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i += 1) {
  ALPHABET_INDEX.set(ALPHABET.charAt(i), i);
}
const ID_LENGTH = 26;
const ID_BYTE_LENGTH = 16;
const ID_PATTERN = /^[a-z2-7]{26}$/;

declare const noteIdBrand: unique symbol;
declare const folderIdBrand: unique symbol;
declare const tagIdBrand: unique symbol;
declare const nodeIdBrand: unique symbol;
declare const deviceIdBrand: unique symbol;
declare const vaultIdBrand: unique symbol;
declare const transactionIdBrand: unique symbol;
declare const attachmentIdBrand: unique symbol;

export type NoteId = string & { readonly [noteIdBrand]: "NoteId" };
export type FolderId = string & { readonly [folderIdBrand]: "FolderId" };
export type TagId = string & { readonly [tagIdBrand]: "TagId" };
export type NodeId = string & { readonly [nodeIdBrand]: "NodeId" };
export type DeviceId = string & { readonly [deviceIdBrand]: "DeviceId" };
export type VaultId = string & { readonly [vaultIdBrand]: "VaultId" };
export type TransactionId = string & { readonly [transactionIdBrand]: "TransactionId" };
export type AttachmentId = string & { readonly [attachmentIdBrand]: "AttachmentId" };

export type JotId =
  | NoteId
  | FolderId
  | TagId
  | NodeId
  | DeviceId
  | VaultId
  | TransactionId
  | AttachmentId;

function base32Char(index: number): string {
  const char = ALPHABET.charAt(index);
  if (char.length !== 1) {
    throw new IdError("invalid-alphabet", "base32 index out of range");
  }
  return char;
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += base32Char((acc >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += base32Char((acc << (5 - bits)) & 31);
  }
  return out;
}

export function decodeBase32(value: string): Uint8Array {
  let bits = 0;
  let acc = 0;
  const bytes: number[] = [];
  for (const char of value) {
    const index = ALPHABET_INDEX.get(char);
    if (index === undefined) {
      throw new IdError("invalid-alphabet", `invalid base32 character ${char}`);
    }
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes.slice(0, ID_BYTE_LENGTH));
}

export function isId(value: string): boolean {
  if (!ID_PATTERN.test(value)) {
    return false;
  }
  try {
    return encodeBase32(decodeBase32(value)) === value;
  } catch {
    return false;
  }
}

/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- branded ID constructors */
export function parseId<T extends JotId = NodeId>(value: string): T {
  if (value.length !== ID_LENGTH) {
    throw new IdError("invalid-length", `id must be ${String(ID_LENGTH)} characters`);
  }
  if (!ID_PATTERN.test(value)) {
    throw new IdError("invalid-alphabet", "id must be lowercase RFC 4648 base32 (a-z2-7)");
  }
  const encoded = encodeBase32(decodeBase32(value));
  if (encoded !== value) {
    throw new IdError("non-canonical", "id is not a canonical 128-bit base32 encoding");
  }
  return value as T;
}

export function createId<T extends JotId = NodeId>(): T {
  const bytes = new Uint8Array(ID_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return encodeBase32(bytes) as T;
}

function mix32(h: number, byte: number, mul: number): number {
  return Math.imul(h ^ byte, mul) >>> 0;
}

export function deriveId<T extends JotId = NodeId>(
  parentId: string,
  purpose: string,
  index: number,
): T {
  const seed = `${parentId}|${purpose}|${String(index)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0x243f6a88;
  let h4 = 0x85a308d3;
  for (let i = 0; i < seed.length; i += 1) {
    const byte = seed.charCodeAt(i) & 0xff;
    h1 = mix32(h1, byte, 0x01000193);
    h2 = mix32(h2, byte ^ (i & 0xff), 0x811c9dc5);
    h3 = mix32(h3, (byte + i) & 0xff, 0x1b873593);
    h4 = mix32(h4, byte, 0x9e3779b9);
  }
  const out = new Uint8Array(ID_BYTE_LENGTH);
  const write = (offset: number, value: number): void => {
    out[offset] = value & 0xff;
    out[offset + 1] = (value >>> 8) & 0xff;
    out[offset + 2] = (value >>> 16) & 0xff;
    out[offset + 3] = (value >>> 24) & 0xff;
  };
  write(0, h1);
  write(4, h2);
  write(8, h3);
  write(12, h4);
  return encodeBase32(out) as T;
}
