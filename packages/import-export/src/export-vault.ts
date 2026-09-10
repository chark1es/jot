import type { AttachmentId, ClockEvent, FolderId, NoteId } from '@jot/schema';
import { documentToMarkdown } from './markdown.js';
import type {
  ExportAttachment,
  ExportFile,
  ExportFolder,
  ExportNote,
  ManifestNote,
  PortableManifest,
  VaultExportInput,
  VaultExportResult,
} from './types.js';

export class ExportError extends Error {
  override readonly name = 'ExportError';
  readonly code: string;
  readonly missingAttachmentIds: readonly AttachmentId[];

  constructor(code: string, message: string, missingAttachmentIds: readonly AttachmentId[] = []) {
    super(message);
    this.code = code;
    this.missingAttachmentIds = missingAttachmentIds;
  }
}

const ILLEGAL_NAME = /[<>:"/\\|?*]/g;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const utf8 = new TextEncoder();

function stripControls(name: string): string {
  let out = '';
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    out += code < 32 ? '-' : name.charAt(i);
  }
  return out;
}

function encodeUtf8(text: string): Uint8Array {
  return utf8.encode(text);
}

function joinPath(...parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join('/');
}

function sanitizeFileName(name: string): string {
  const trimmed = stripControls(name.trim());
  const replaced = trimmed
    .replace(ILLEGAL_NAME, '-')
    .replace(/[\s.]+$/g, '')
    .replace(/^\.+/g, '');
  const collapsed = replaced.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  if (collapsed.length === 0 || collapsed === '.' || collapsed === '..') {
    return 'untitled';
  }
  const clipped = collapsed.length > 120 ? collapsed.slice(0, 120) : collapsed;
  if (RESERVED_NAME.test(clipped)) {
    return `${clipped}-file`;
  }
  return clipped;
}

function splitExt(name: string): { readonly stem: string; readonly ext: string } {
  const index = name.lastIndexOf('.');
  if (index <= 0 || index === name.length - 1) {
    return { stem: name, ext: '' };
  }
  return { stem: name.slice(0, index), ext: name.slice(index) };
}

function uniqueNames(
  items: readonly { readonly id: string; readonly name: string }[],
): Map<string, string> {
  const prepared = items.map((item) => ({
    id: item.id,
    base: sanitizeFileName(item.name),
  }));
  const counts = new Map<string, number>();
  for (const item of prepared) {
    counts.set(item.base, (counts.get(item.base) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const item of prepared) {
    const count = counts.get(item.base) ?? 1;
    out.set(item.id, count > 1 ? `${item.base}-${item.id}` : item.base);
  }
  return out;
}

function yamlString(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (
    /^[A-Za-z0-9_./-]+$/.test(value) &&
    !['true', 'false', 'null', 'yes', 'no', 'on', 'off'].includes(value.toLowerCase())
  ) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function isoFromClock(event: ClockEvent): string {
  return new Date(event.wallMs).toISOString();
}

function frontMatter(note: ExportNote): string {
  const lines = ['---', `id: ${note.id}`, `title: ${yamlString(note.title)}`];
  if (note.tags.length === 0) {
    lines.push('tags: []');
  } else {
    lines.push('tags:');
    for (const tag of note.tags) {
      lines.push(`  - ${yamlString(tag.name)}`);
    }
  }
  lines.push(`pin: ${note.pinned ? 'true' : 'false'}`);
  lines.push(`archive: ${note.archived ? 'true' : 'false'}`);
  lines.push(`created: ${isoFromClock(note.created)}`);
  lines.push(`modified: ${isoFromClock(note.modified)}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

function relativePath(fromFile: string, toFile: string): string {
  const fromDir = fromFile.split('/').slice(0, -1);
  const toParts = toFile.split('/');
  let i = 0;
  while (i < fromDir.length && i < toParts.length - 1 && fromDir[i] === toParts[i]) {
    i += 1;
  }
  const ups: string[] = [];
  for (let u = 0; u < fromDir.length - i; u += 1) {
    ups.push('..');
  }
  return [...ups, ...toParts.slice(i)].join('/');
}

function folderById(folders: readonly ExportFolder[]): Map<FolderId, ExportFolder> {
  const map = new Map<FolderId, ExportFolder>();
  for (const folder of folders) {
    map.set(folder.id, folder);
  }
  return map;
}

function parentOf(folder: ExportFolder, byId: Map<FolderId, ExportFolder>): FolderId | null {
  const parent = folder.parentPlacement;
  if (parent === null || !byId.has(parent)) {
    return null;
  }
  const seen = new Set<FolderId>();
  let current: FolderId | null = folder.id;
  while (current !== null) {
    if (seen.has(current)) {
      return current === folder.id ? null : parent;
    }
    seen.add(current);
    const node = byId.get(current);
    current = node === undefined ? null : node.parentPlacement;
  }
  return parent;
}

function folderDirPaths(folders: readonly ExportFolder[]): Map<FolderId, string> {
  const byId = folderById(folders);
  const children = new Map<FolderId | null, ExportFolder[]>();
  for (const folder of folders) {
    const parent = parentOf(folder, byId);
    const siblings = children.get(parent);
    if (siblings === undefined) {
      children.set(parent, [folder]);
    } else {
      siblings.push(folder);
    }
  }

  const dirName = new Map<FolderId, string>();
  const walk = (parent: FolderId | null, prefix: string): void => {
    const siblings = children.get(parent) ?? [];
    const names = uniqueNames(siblings.map((folder) => ({ id: folder.id, name: folder.name })));
    const ordered = [...siblings].sort((left, right) => {
      if (left.manualPosition !== right.manualPosition) {
        return left.manualPosition < right.manualPosition ? -1 : 1;
      }
      return left.id < right.id ? -1 : 1;
    });
    for (const folder of ordered) {
      const name = names.get(folder.id) ?? sanitizeFileName(folder.name);
      const path = joinPath(prefix, name);
      dirName.set(folder.id, path);
      walk(folder.id, path);
    }
  };
  walk(null, '');
  return dirName;
}

function resolveAttachmentBytes(
  attachment: ExportAttachment,
  readAttachmentPath: VaultExportInput['readAttachmentPath'],
): Uint8Array {
  if (attachment.bytes !== undefined) {
    return attachment.bytes;
  }
  if (attachment.path !== undefined && readAttachmentPath !== undefined) {
    return readAttachmentPath(attachment.path);
  }
  throw new ExportError(
    'attachment-unresolved',
    `attachment ${attachment.id} has no bytes; pass bytes or readAttachmentPath`,
    [attachment.id],
  );
}

function attachmentFileNames(attachments: readonly ExportAttachment[]): Map<AttachmentId, string> {
  const unique = uniqueNames(
    attachments.map((attachment) => ({
      id: attachment.id,
      name: sanitizeFileName(attachment.originalName),
    })),
  );
  const named = new Map<AttachmentId, string>();
  for (const attachment of attachments) {
    const assigned = unique.get(attachment.id);
    if (assigned === undefined) {
      named.set(attachment.id, `${sanitizeFileName(attachment.originalName)}-${attachment.id}`);
      continue;
    }
    if (assigned.endsWith(`-${attachment.id}`)) {
      const base = sanitizeFileName(attachment.originalName);
      const { stem, ext } = splitExt(base);
      named.set(attachment.id, `${stem}-${attachment.id}${ext}`);
      continue;
    }
    named.set(attachment.id, assigned);
  }
  return named;
}

function comparePath(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function exportVaultToFiles(input: VaultExportInput): VaultExportResult {
  const folderPaths = folderDirPaths(input.folders);
  const notesByFolder = new Map<FolderId | null, ExportNote[]>();
  for (const note of input.notes) {
    const folderId =
      note.folderPlacement !== null && folderPaths.has(note.folderPlacement)
        ? note.folderPlacement
        : null;
    const group = notesByFolder.get(folderId);
    if (group === undefined) {
      notesByFolder.set(folderId, [note]);
    } else {
      group.push(note);
    }
  }

  const noteSlugs = new Map<NoteId, string>();
  for (const notes of notesByFolder.values()) {
    const names = uniqueNames(notes.map((note) => ({ id: note.id, name: note.title })));
    for (const note of notes) {
      noteSlugs.set(note.id, names.get(note.id) ?? sanitizeFileName(note.title));
    }
  }

  const files: ExportFile[] = [];
  const manifestNotes: ManifestNote[] = [];
  const missing: AttachmentId[] = [];

  for (const note of input.notes) {
    const folderId =
      note.folderPlacement !== null && folderPaths.has(note.folderPlacement)
        ? note.folderPlacement
        : null;
    const folderPath = folderId === null ? '' : (folderPaths.get(folderId) ?? '');
    const slug = noteSlugs.get(note.id) ?? sanitizeFileName(note.title);
    const mdPath = joinPath(folderPath, `${slug}.md`);
    const attNames = attachmentFileNames(note.attachments);
    const hrefById = new Map<string, string>();
    const nameById = new Map<string, string>();
    const manifestAttachments: { readonly id: AttachmentId; readonly path: string }[] = [];

    for (const attachment of note.attachments) {
      const fileName = attNames.get(attachment.id) ?? sanitizeFileName(attachment.originalName);
      const attPath = joinPath(folderPath, `${slug}.attachments`, fileName);
      hrefById.set(attachment.id, relativePath(mdPath, attPath));
      nameById.set(attachment.id, attachment.originalName);
      try {
        const bytes = resolveAttachmentBytes(attachment, input.readAttachmentPath);
        files.push({ path: attPath, bytes });
        manifestAttachments.push({ id: attachment.id, path: attPath });
      } catch (error) {
        if (error instanceof ExportError) {
          missing.push(...error.missingAttachmentIds);
          continue;
        }
        throw error;
      }
    }

    const body = documentToMarkdown(note.document, {
      hrefForAttachment: (id) => hrefById.get(id),
      originalNameForAttachment: (id) => nameById.get(id),
    });
    const trimmed = body.replace(/\n+$/u, '');
    const markdown =
      trimmed.length === 0 ? frontMatter(note) : `${frontMatter(note)}\n${trimmed}\n`;
    files.push({ path: mdPath, bytes: encodeUtf8(markdown) });
    manifestNotes.push({
      id: note.id,
      path: mdPath,
      attachments: manifestAttachments,
    });
  }

  if (missing.length > 0) {
    throw new ExportError(
      'attachment-unresolved',
      `unresolved attachments: ${missing.join(', ')}`,
      missing,
    );
  }

  const manifest: PortableManifest = {
    format: 'jot-portable-export',
    version: 1,
    notes: [...manifestNotes].sort((left, right) => comparePath(left.id, right.id)),
  };
  const manifestBytes = encodeUtf8(`${JSON.stringify(manifest, null, 2)}\n`);
  files.push({ path: 'manifest.json', bytes: manifestBytes });
  files.sort((left, right) => comparePath(left.path, right.path));
  return { files, manifest };
}

export function exportVault(input: VaultExportInput): VaultExportResult {
  return exportVaultToFiles(input);
}

export function exportNotes(
  request: { readonly noteIds: readonly NoteId[] },
  input: VaultExportInput,
): VaultExportResult {
  if (request.noteIds.length === 0) {
    return exportVaultToFiles(input);
  }
  const wanted = new Set(request.noteIds);
  return exportVaultToFiles({
    ...input,
    notes: input.notes.filter((note) => wanted.has(note.id)),
  });
}
