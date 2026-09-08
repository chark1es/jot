import type { DeviceId, FolderId, NoteId, TagId } from '@jolt/schema';
import { nextBase32Id, type SeededPrng } from './prng.js';

export function nextNoteId(prng: SeededPrng): NoteId {
  return nextBase32Id(prng) as NoteId;
}

export function nextFolderId(prng: SeededPrng): FolderId {
  return nextBase32Id(prng) as FolderId;
}

export function nextTagId(prng: SeededPrng): TagId {
  return nextBase32Id(prng) as TagId;
}

export function nextDeviceId(prng: SeededPrng): DeviceId {
  return nextBase32Id(prng) as DeviceId;
}
