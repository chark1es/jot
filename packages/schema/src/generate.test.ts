import { describe, expect, it } from "vitest";
import { generateAll, GENERATED_HEADER } from "./generate/emit.js";
import { INPUT_RULES } from "./input-rules.js";

describe("generate", () => {
  it("is deterministic", () => {
    expect(generateAll()).toEqual(generateAll());
  });

  it("prefixes every artifact with the required header", () => {
    for (const [name, content] of Object.entries(generateAll())) {
      expect(content.startsWith(GENERATED_HEADER), name).toBe(true);
    }
  });
});

describe("input rules", () => {
  it("covers the markdown triggers that fire after space or Enter", () => {
    const ids = INPUT_RULES.map((rule) => rule.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "heading-1",
        "bullet",
        "ordered",
        "task-unchecked",
        "task-checked",
        "code",
        "quote",
      ]),
    );
    expect(INPUT_RULES.some((rule) => rule.pattern === "^#$")).toBe(true);
    expect(INPUT_RULES.some((rule) => rule.pattern === "^-$")).toBe(true);
    expect(INPUT_RULES.some((rule) => rule.pattern === "^1\\.$")).toBe(true);
  });
});
