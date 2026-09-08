import { SchemaError } from "./errors.js";
import { parseId } from "./ids.js";
import type {
  AttachmentId,
  DeviceId,
  FolderId,
  JoltId,
  NoteId,
  TagId,
} from "./ids.js";
import { isHexPalette } from "./schema-table.js";
import { parseDocument } from "./document.js";
import type { Document } from "./types.js";
import { rejectUnpairedSurrogates } from "./utf8.js";

export type LogicalTime = {
  readonly counter: number;
  readonly deviceId: DeviceId;
};

export type ClockEvent = {
  readonly logical: LogicalTime;
  readonly wallMs: number;
};

export type VersionRef = {
  readonly id: JoltId;
  readonly created: ClockEvent;
};

export type Note = {
  readonly id: NoteId;
  readonly schemaVersion: number;
  readonly title: string;
  readonly document: Document;
  readonly folderPlacement: FolderId | null;
  readonly tags: readonly TagId[];
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashedAt: ClockEvent | null;
  readonly manualPosition: string;
  readonly created: ClockEvent;
  readonly modified: ClockEvent;
  readonly attachments: readonly AttachmentId[];
  readonly versionRefs: readonly VersionRef[];
};

export type Folder = {
  readonly id: FolderId;
  readonly name: string;
  readonly parentPlacement: FolderId | null;
  readonly manualPosition: string;
  readonly created: ClockEvent;
  readonly modified: ClockEvent;
  readonly trashedAt: ClockEvent | null;
};

export type Tag = {
  readonly id: TagId;
  readonly name: string;
  readonly colorRole: string | null;
  readonly created: ClockEvent;
  readonly modified: ClockEvent;
  readonly trashedAt: ClockEvent | null;
};

export type PixelSize = {
  readonly width: number;
  readonly height: number;
};

export type AttachmentLocalState = "available" | "evicted" | "importing" | "corrupt" | "absent";

export type RemoteObjectRef = {
  readonly objectId: string;
  readonly encryptionSuite: string;
};

export type Attachment = {
  readonly id: AttachmentId;
  readonly plaintextSha256: string;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly originalName: string;
  readonly pixelSize: PixelSize | null;
  readonly localState: AttachmentLocalState;
  readonly remoteRefs: readonly RemoteObjectRef[];
  readonly created: ClockEvent;
};

const LOCAL_STATES = new Set<AttachmentLocalState>([
  "available",
  "evicted",
  "importing",
  "corrupt",
  "absent",
]);

function fail(code: string, message: string): never {
  throw new SchemaError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail("invalid-boolean", `${path}: expected boolean`);
  }
  return value;
}

function readInteger(value: unknown, path: string, min = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    fail("non-integer", `${path}: expected a safe integer`);
  }
  if (value < min) {
    fail("integer-range", `${path}: expected >= ${String(min)}`);
  }
  return value;
}

function readText(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail("invalid-string", `${path}: expected a string`);
  }
  rejectUnpairedSurrogates(value, path);
  return value;
}

function readLogicalTime(value: unknown, path: string): LogicalTime {
  if (!isRecord(value)) {
    fail("invalid-logical", `${path}: expected object`);
  }
  return {
    counter: readInteger(value.counter, `${path}.counter`),
    deviceId: parseId<DeviceId>(readText(value.deviceId, `${path}.deviceId`)),
  };
}

function readClockEvent(value: unknown, path: string): ClockEvent {
  if (!isRecord(value)) {
    fail("invalid-clock", `${path}: expected object`);
  }
  return {
    logical: readLogicalTime(value.logical, `${path}.logical`),
    wallMs: readInteger(value.wallMs, `${path}.wallMs`),
  };
}

function readOptionalClock(value: unknown, path: string): ClockEvent | null {
  if (value === null || value === undefined) {
    return null;
  }
  return readClockEvent(value, path);
}

function readVersionRef(value: unknown, path: string): VersionRef {
  if (!isRecord(value)) {
    fail("invalid-version-ref", `${path}: expected object`);
  }
  return {
    id: parseId(readText(value.id, `${path}.id`)),
    created: readClockEvent(value.created, `${path}.created`),
  };
}

export function validateNote(input: unknown): Note {
  if (!isRecord(input)) {
    fail("invalid-note", "note must be an object");
  }
  const pinned = readBoolean(input.pinned, "pinned");
  const archived = readBoolean(input.archived, "archived");
  const trashedAt = readOptionalClock(input.trashedAt, "trashedAt");
  if (archived && trashedAt !== null) {
    fail("note-state", "a note cannot be both archived and trashed");
  }
  const tagsInput = input.tags;
  if (!Array.isArray(tagsInput)) {
    fail("invalid-tags", "tags must be an array");
  }
  const attachmentsInput = input.attachments;
  if (!Array.isArray(attachmentsInput)) {
    fail("invalid-attachments", "attachments must be an array");
  }
  const versionRefsInput = input.versionRefs;
  if (!Array.isArray(versionRefsInput)) {
    fail("invalid-version-refs", "versionRefs must be an array");
  }
  return {
    id: parseId<NoteId>(readText(input.id, "id")),
    schemaVersion: readInteger(input.schemaVersion, "schemaVersion", 1),
    title: readText(input.title, "title"),
    document: parseDocument(input.document),
    folderPlacement:
      input.folderPlacement === null || input.folderPlacement === undefined
        ? null
        : parseId<FolderId>(readText(input.folderPlacement, "folderPlacement")),
    tags: tagsInput.map((tag, index) => parseId<TagId>(readText(tag, `tags[${String(index)}]`))),
    pinned,
    archived,
    trashedAt,
    manualPosition: readText(input.manualPosition, "manualPosition"),
    created: readClockEvent(input.created, "created"),
    modified: readClockEvent(input.modified, "modified"),
    attachments: attachmentsInput.map((id, index) =>
      parseId<AttachmentId>(readText(id, `attachments[${String(index)}]`)),
    ),
    versionRefs: versionRefsInput.map((ref, index) => readVersionRef(ref, `versionRefs[${String(index)}]`)),
  };
}

export function validateFolder(input: unknown): Folder {
  if (!isRecord(input)) {
    fail("invalid-folder", "folder must be an object");
  }
  const name = readText(input.name, "name");
  if (name.trim() !== name || name.length === 0) {
    fail("folder-name", "folder names must be non-empty and trimmed");
  }
  return {
    id: parseId<FolderId>(readText(input.id, "id")),
    name,
    parentPlacement:
      input.parentPlacement === null || input.parentPlacement === undefined
        ? null
        : parseId<FolderId>(readText(input.parentPlacement, "parentPlacement")),
    manualPosition: readText(input.manualPosition, "manualPosition"),
    created: readClockEvent(input.created, "created"),
    modified: readClockEvent(input.modified, "modified"),
    trashedAt: readOptionalClock(input.trashedAt, "trashedAt"),
  };
}

export function validateTag(input: unknown): Tag {
  if (!isRecord(input)) {
    fail("invalid-tag", "tag must be an object");
  }
  const name = readText(input.name, "name").normalize("NFC").trim();
  if (name.length === 0) {
    fail("tag-name", "tag names must be non-empty after normalization");
  }
  let colorRole: string | null = null;
  if (input.colorRole !== null && input.colorRole !== undefined) {
    colorRole = readText(input.colorRole, "colorRole");
    if (colorRole.length === 0 || isHexPalette(colorRole)) {
      fail("tag-color", "colorRole must be a palette id, not a hex color");
    }
  }
  return {
    id: parseId<TagId>(readText(input.id, "id")),
    name,
    colorRole,
    created: readClockEvent(input.created, "created"),
    modified: readClockEvent(input.modified, "modified"),
    trashedAt: readOptionalClock(input.trashedAt, "trashedAt"),
  };
}

function readPixelSize(value: unknown, path: string): PixelSize | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    fail("invalid-pixel-size", `${path}: expected object`);
  }
  return {
    width: readInteger(value.width, `${path}.width`, 1),
    height: readInteger(value.height, `${path}.height`, 1),
  };
}

function readRemoteRef(value: unknown, path: string): RemoteObjectRef {
  if (!isRecord(value)) {
    fail("invalid-remote-ref", `${path}: expected object`);
  }
  const objectId = readText(value.objectId, `${path}.objectId`);
  const encryptionSuite = readText(value.encryptionSuite, `${path}.encryptionSuite`);
  if (objectId.length === 0 || encryptionSuite.length === 0) {
    fail("invalid-remote-ref", `${path}: objectId and encryptionSuite must be non-empty`);
  }
  return { objectId, encryptionSuite };
}

export function validateAttachment(input: unknown): Attachment {
  if (!isRecord(input)) {
    fail("invalid-attachment", "attachment must be an object");
  }
  const plaintextSha256 = readText(input.plaintextSha256, "plaintextSha256");
  if (!/^[0-9a-f]{64}$/.test(plaintextSha256)) {
    fail("plaintext-sha256", "plaintextSha256 must be 64 lowercase hex characters");
  }
  const mimeType = readText(input.mimeType, "mimeType");
  if (mimeType !== "application/octet-stream" && !/^[A-Za-z0-9][\w!#$&^._+-]{0,126}\/[A-Za-z0-9][\w!#$&^._+-]{0,126}$/.test(mimeType)) {
    fail("mime-type", "mimeType is not a valid MIME string");
  }
  const originalName = readText(input.originalName, "originalName");
  if (originalName.length === 0 || /[/\0\\]/.test(originalName)) {
    fail("original-name", "originalName must be a non-empty display name without path separators");
  }
  const localState = readText(input.localState, "localState");
  if (!LOCAL_STATES.has(localState as AttachmentLocalState)) {
    fail("local-state", `unknown attachment localState ${localState}`);
  }
  const remoteRefsInput = input.remoteRefs;
  if (!Array.isArray(remoteRefsInput)) {
    fail("invalid-remote-refs", "remoteRefs must be an array");
  }
  return {
    id: parseId<AttachmentId>(readText(input.id, "id")),
    plaintextSha256,
    byteLength: readInteger(input.byteLength, "byteLength"),
    mimeType,
    originalName,
    pixelSize: readPixelSize(input.pixelSize, "pixelSize"),
    localState: localState as AttachmentLocalState,
    remoteRefs: remoteRefsInput.map((ref, index) => readRemoteRef(ref, `remoteRefs[${String(index)}]`)),
    created: readClockEvent(input.created, "created"),
  };
}
