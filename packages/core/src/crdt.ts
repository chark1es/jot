import type { Document } from '@jolt/schema';

/**
 * Narrow CRDT seam. Yjs types must not escape this interface.
 */
export interface CrdtDocument {
  applyUpdate(bytes: Uint8Array): void;
  encodeUpdate(since?: Uint8Array): Uint8Array;
  getCanonicalDocument(): Document;
  getTitle(): string;
  getStateVector(): Uint8Array;
}

export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
}

/** Phase 0 stub. Production Yjs lives behind this later. */
export class UnsupportedCrdtDocument implements CrdtDocument {
  applyUpdate(_bytes: Uint8Array): void {
    throw new NotImplementedError('CrdtDocument.applyUpdate is not implemented');
  }

  encodeUpdate(_since?: Uint8Array): Uint8Array {
    throw new NotImplementedError('CrdtDocument.encodeUpdate is not implemented');
  }

  getCanonicalDocument(): Document {
    throw new NotImplementedError('CrdtDocument.getCanonicalDocument is not implemented');
  }

  getTitle(): string {
    throw new NotImplementedError('CrdtDocument.getTitle is not implemented');
  }

  getStateVector(): Uint8Array {
    throw new NotImplementedError('CrdtDocument.getStateVector is not implemented');
  }
}
