/**
 * Version gate for remote objects, Heads, Catalogs, Documents, and envelopes.
 * An older client that sees an unsupported minimum reader does not parse it.
 * An unsupported minimum writer keeps local edits and stops remote publication.
 *
 * Pass `@jolt/schema` SCHEMA_VERSION as localSchemaVersion.
 */
export type SchemaGate =
  | { readonly status: 'compatible' }
  | { readonly status: 'readerTooOld'; readonly minReaderVersion: number }
  | { readonly status: 'writerTooOld'; readonly minWriterVersion: number };

export function evaluateSchemaGate(input: {
  readonly localSchemaVersion: number;
  readonly minReaderVersion: number;
  readonly minWriterVersion: number;
}): SchemaGate {
  if (input.localSchemaVersion < input.minReaderVersion) {
    return { status: 'readerTooOld', minReaderVersion: input.minReaderVersion };
  }
  if (input.localSchemaVersion < input.minWriterVersion) {
    return { status: 'writerTooOld', minWriterVersion: input.minWriterVersion };
  }
  return { status: 'compatible' };
}

export function canReadRemote(minReaderVersion: number, localSchemaVersion: number): boolean {
  return localSchemaVersion >= minReaderVersion;
}

export function canWriteRemote(minWriterVersion: number, localSchemaVersion: number): boolean {
  return localSchemaVersion >= minWriterVersion;
}
