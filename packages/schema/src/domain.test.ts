import { describe, expect, it } from "vitest";
import { validateAttachment, validateFolder, validateNote, validateTag } from "./domain.js";
import { SchemaError } from "./errors.js";
import { IdError } from "./errors.js";

const deviceId = "daaaaaaaaaaaaaaaaaaaaaaaaa";
const clock = {
  logical: { counter: 1, deviceId },
  wallMs: 1_704_000_000_000,
};

const emptyDoc = {
  type: "doc",
  id: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
  content: [],
};

describe("domain validators", () => {
  it("accepts a note with an empty title", () => {
    const note = validateNote({
      id: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
      schemaVersion: 1,
      title: "",
      document: emptyDoc,
      folderPlacement: null,
      tags: [],
      pinned: false,
      archived: false,
      trashedAt: null,
      manualPosition: "a0",
      created: clock,
      modified: clock,
      attachments: [],
      versionRefs: [],
    });
    expect(note.title).toBe("");
  });

  it("rejects archived plus trashed notes", () => {
    expect(() =>
      validateNote({
        id: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        schemaVersion: 1,
        title: "x",
        document: emptyDoc,
        folderPlacement: null,
        tags: [],
        pinned: false,
        archived: true,
        trashedAt: clock,
        manualPosition: "a0",
        created: clock,
        modified: clock,
        attachments: [],
        versionRefs: [],
      }),
    ).toThrow(SchemaError);
  });

  it("requires trimmed non-empty folder names", () => {
    expect(() =>
      validateFolder({
        id: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        name: "  inbox",
        parentPlacement: null,
        manualPosition: "a0",
        created: clock,
        modified: clock,
        trashedAt: null,
      }),
    ).toThrow(SchemaError);
    const folder = validateFolder({
      id: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "inbox",
      parentPlacement: null,
      manualPosition: "a0",
      created: clock,
      modified: clock,
      trashedAt: null,
    });
    expect(folder.name).toBe("inbox");
  });

  it("rejects hex colorRole on tags", () => {
    expect(() =>
      validateTag({
        id: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
        name: "work",
        colorRole: "#ffaa00",
        created: clock,
        modified: clock,
        trashedAt: null,
      }),
    ).toThrow(SchemaError);
    const tag = validateTag({
      id: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "work",
      colorRole: "signalAmber",
      created: clock,
      modified: clock,
      trashedAt: null,
    });
    expect(tag.colorRole).toBe("signalAmber");
  });

  it("validates attachment bytes and sha256", () => {
    const attachment = validateAttachment({
      id: "aeaaaaaaaaaaaaaaaaaaaaaaaa",
      plaintextSha256: "ab".repeat(32),
      byteLength: 12,
      mimeType: "image/png",
      originalName: "photo.png",
      pixelSize: { width: 10, height: 8 },
      localState: "available",
      remoteRefs: [],
      created: clock,
    });
    expect(attachment.byteLength).toBe(12);
    expect(() =>
      validateAttachment({
        ...attachment,
        originalName: "../secret.png",
      }),
    ).toThrow(SchemaError);
  });

  it("rejects malformed ids", () => {
    expect(() =>
      validateFolder({
        id: "not-an-id",
        name: "inbox",
        parentPlacement: null,
        manualPosition: "a0",
        created: clock,
        modified: clock,
        trashedAt: null,
      }),
    ).toThrow(IdError);
  });
});
