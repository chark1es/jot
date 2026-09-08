import { SchemaVersionError } from "./errors.js";
import { parseDocument } from "./document.js";
import { SCHEMA_VERSION } from "./schema-table.js";
import type { Document } from "./types.js";

export function migrate(doc: unknown, fromVersion: number): Document {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new SchemaVersionError({
      schemaVersion: fromVersion,
      minReader: SCHEMA_VERSION,
      minWriter: SCHEMA_VERSION,
      message: `Invalid schema version ${String(fromVersion)}`,
    });
  }
  if (fromVersion > SCHEMA_VERSION) {
    throw new SchemaVersionError({
      schemaVersion: fromVersion,
      minReader: fromVersion,
      minWriter: fromVersion,
    });
  }
  if (fromVersion === SCHEMA_VERSION) {
    return parseDocument(doc);
  }
  throw new SchemaVersionError({
    schemaVersion: fromVersion,
    minReader: SCHEMA_VERSION,
    minWriter: SCHEMA_VERSION,
    message: `No migration path from schema version ${String(fromVersion)}`,
  });
}
