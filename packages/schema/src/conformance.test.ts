import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalizeDocument, parseDocument } from "./document.js";
import { generateAll } from "./generate/emit.js";
import { utf8Decode } from "./utf8.js";
import { CAPABILITY_MANIFEST } from "./capabilities.js";
import { MARK_TYPES, NODE_TYPES } from "./schema-table.js";
import { SchemaError } from "./errors.js";
import { CanonicalJsonError } from "./errors.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const generatedDir = join(dirname(fileURLToPath(import.meta.url)), "../generated");

function inputFixtures(): string[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".canonical.json"))
    .sort();
}

describe("conformance fixtures", () => {
  it("has the required corpus files", () => {
    const names = new Set(inputFixtures());
    for (const name of [
      "empty-doc.json",
      "paragraph-bold.json",
      "heading-levels.json",
      "lists-and-tasks.json",
      "table.json",
      "image-file-math.json",
      "unicode-emoji-rtl.json",
      "marks-link-color.json",
      "unknown-attr-stripped.json",
      "illegal-nesting.json",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("matches committed canonical JSON byte for byte", () => {
    for (const name of inputFixtures()) {
      const input = JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as unknown;
      const expected = new Uint8Array(
        readFileSync(join(fixturesDir, name.replace(/\.json$/, ".canonical.json"))),
      );
      expect(canonicalizeDocument(input), name).toEqual(expected);
    }
  });

  it("round-trips parse then canonicalize stably", () => {
    for (const name of inputFixtures()) {
      const input = JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as unknown;
      const once = canonicalizeDocument(input);
      const twice = canonicalizeDocument(JSON.parse(utf8Decode(once)) as unknown);
      expect(twice, name).toEqual(once);
      expect(canonicalizeDocument(parseDocument(input)), name).toEqual(once);
    }
  });

  it("strips unknown attributes without dropping text", () => {
    const canonical = utf8Decode(
      canonicalizeDocument(
        JSON.parse(readFileSync(join(fixturesDir, "unknown-attr-stripped.json"), "utf8")) as unknown,
      ),
    );
    expect(canonical.includes("extra")).toBe(false);
    expect(canonical.includes("drop-me")).toBe(false);
    expect(canonical.includes("Kept")).toBe(true);
  });

  it("wraps illegal doc text in a paragraph", () => {
    const parsed = parseDocument(
      JSON.parse(readFileSync(join(fixturesDir, "illegal-nesting.json"), "utf8")) as unknown,
    );
    expect(parsed.content).toHaveLength(1);
    const paragraph = parsed.content[0];
    expect(paragraph?.type).toBe("paragraph");
    expect(paragraph?.content[0]?.type).toBe("text");
    expect(paragraph?.content[0]?.text).toBe("wrapped");
  });
});

describe("validation", () => {
  it("rejects unknown node types", () => {
    expect(() =>
      parseDocument({
        type: "wizardBlock",
        id: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        content: [],
      }),
    ).toThrow(SchemaError);
    try {
      parseDocument({
        type: "wizardBlock",
        id: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        content: [],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaError);
      expect((error as SchemaError).code).toBe("unknown-node-type");
    }
  });

  it("rejects unpaired surrogates in text", () => {
    expect(() =>
      parseDocument({
        type: "doc",
        id: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        content: [
          {
            type: "paragraph",
            id: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
            content: [
              {
                type: "text",
                id: "aiaaaaaaaaaaaaaaaaaaaaaaaa",
                text: "ok\uD800",
                marks: [],
              },
            ],
          },
        ],
      }),
    ).toThrow(CanonicalJsonError);
  });

  it("rejects float attributes", () => {
    expect(() =>
      parseDocument({
        type: "doc",
        id: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
        content: [
          {
            type: "heading",
            id: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
            attrs: { level: 1.5 },
            content: [],
          },
        ],
      }),
    ).toThrow(SchemaError);
  });
});

describe("capability manifest", () => {
  it("lists every node and mark from the schema table", () => {
    expect([...CAPABILITY_MANIFEST.nodes]).toEqual([...NODE_TYPES]);
    expect([...CAPABILITY_MANIFEST.marks]).toEqual([...MARK_TYPES]);
    expect(CAPABILITY_MANIFEST.nodes).toEqual(
      expect.arrayContaining([
        "doc",
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "bulletList",
        "orderedList",
        "listItem",
        "taskList",
        "taskItem",
        "table",
        "tableRow",
        "tableCell",
        "image",
        "caption",
        "fileAttachment",
        "mathBlock",
        "text",
        "hardBreak",
        "mathInline",
      ]),
    );
    expect(CAPABILITY_MANIFEST.marks).toEqual(
      expect.arrayContaining([
        "bold",
        "italic",
        "underline",
        "strikethrough",
        "inlineCode",
        "link",
        "textColor",
        "highlight",
      ]),
    );
  });
});

describe("generate drift", () => {
  it("matches files in generated/", () => {
    mkdirSync(generatedDir, { recursive: true });
    const files = generateAll();
    for (const [name, content] of Object.entries(files)) {
      const expected = content.endsWith("\n") ? content : `${content}\n`;
      const onDisk = readFileSync(join(generatedDir, name), "utf8");
      expect(onDisk, name).toBe(expected);
    }
    expect(Object.keys(files).sort()).toEqual(
      ["CanonicalJson.kt", "CanonicalJson.swift", "JoltSchema.kt", "JoltSchema.swift", "prosemirror.ts"].sort(),
    );
  });
});

