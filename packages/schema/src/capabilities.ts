import { MARK_TYPES, NODE_TYPES, SCHEMA_VERSION } from "./schema-table.js";

export const CAPABILITY_MANIFEST = {
  schemaVersion: SCHEMA_VERSION,
  nodes: NODE_TYPES,
  marks: MARK_TYPES,
} as const;
