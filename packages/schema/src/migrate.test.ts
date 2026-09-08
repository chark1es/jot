import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrate.js";
import { parseDocument } from "./document.js";
import { SchemaVersionError } from "./errors.js";
import { SCHEMA_VERSION } from "./schema-table.js";

const emptyDoc = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/empty-doc.json"), "utf8"),
) as unknown;

describe("migrate", () => {
  it("is identity for version 1", () => {
    expect(migrate(emptyDoc, 1)).toEqual(parseDocument(emptyDoc));
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("throws SchemaVersionError for future versions with minReader/minWriter", () => {
    expect(() => migrate(emptyDoc, 2)).toThrow(SchemaVersionError);
    try {
      migrate(emptyDoc, 2);
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaVersionError);
      const versionError = error as SchemaVersionError;
      expect(versionError.schemaVersion).toBe(2);
      expect(versionError.minReader).toBe(2);
      expect(versionError.minWriter).toBe(2);
    }
  });

  it("throws for versions below 1", () => {
    expect(() => migrate(emptyDoc, 0)).toThrow(SchemaVersionError);
  });
});
