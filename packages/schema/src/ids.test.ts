import { describe, expect, it } from "vitest";
import { createId, isId, parseId } from "./ids.js";
import type { NoteId } from "./ids.js";
import { IdError } from "./errors.js";

describe("ids", () => {
  it("creates 26-char lowercase base32 values", () => {
    const id = createId();
    expect(id).toMatch(/^[a-z2-7]{26}$/);
    expect(isId(id)).toBe(true);
    expect(parseId(id)).toBe(id);
  });

  it("brands createId without changing the encoding", () => {
    const id = createId<NoteId>();
    expect(parseId<NoteId>(id)).toBe(id);
    expect(parseId(id)).toBe(id);
  });

  it("rejects wrong length", () => {
    expect(() => parseId("aaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow(IdError);
    expect(() => parseId("aaaaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow(IdError);
  });

  it("rejects the wrong alphabet", () => {
    expect(() => parseId("aaaaaaaaaaaaaaaaaaaaaaaaa1")).toThrow(IdError);
    expect(() => parseId("aaaaaaaaaaaaaaaaaaaaaaaaa0")).toThrow(IdError);
    expect(() => parseId("AAAAAAAAAAAAAAAAAAAAAAAAAA")).toThrow(IdError);
  });

  it("rejects non-canonical padding bits", () => {
    const valid = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(parseId(valid)).toBe(valid);
    const last = valid.slice(0, 25) + "b";
    if (isId(last)) {
      expect(parseId(last)).toBe(last);
    } else {
      expect(() => parseId(last)).toThrow(IdError);
    }
  });
});
