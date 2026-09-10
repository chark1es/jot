import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type AttachmentId,
  type ClockEvent,
  type DeviceId,
  type Document,
  type FolderId,
  type NoteId,
  type TagId,
  parseDocument,
  parseId,
} from '@jot/schema';
import {
  exportNotes,
  exportVault,
  exportVaultToFiles,
  ExportError,
  type ExportFile,
  type ExportNote,
  type VaultExportInput,
} from './index.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../schema/fixtures');
const deviceId = parseId<DeviceId>('daaaaaaaaaaaaaaaaaaaaaaaaa');

function clock(wallMs: number): ClockEvent {
  return { logical: { counter: 1, deviceId }, wallMs };
}

function loadDoc(name: string): Document {
  return parseDocument(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown);
}

function fileText(files: readonly ExportFile[], path: string): string {
  const file = files.find((entry) => entry.path === path);
  if (file === undefined) {
    throw new Error(`missing export file ${path}`);
  }
  return new TextDecoder().decode(file.bytes);
}

function fileAt(files: readonly ExportFile[], path: string): ExportFile {
  const file = files.find((entry) => entry.path === path);
  if (file === undefined) {
    throw new Error(`missing export file ${path}`);
  }
  return file;
}

function baseNote(
  overrides: Partial<ExportNote> & Pick<ExportNote, 'id' | 'document'>,
): ExportNote {
  return {
    title: 'Note',
    folderPlacement: null,
    tags: [],
    pinned: false,
    archived: false,
    created: clock(1_704_000_000_000),
    modified: clock(1_704_000_100_000),
    attachments: [],
    ...overrides,
  };
}

function vault(
  partial: Partial<VaultExportInput> & Pick<VaultExportInput, 'notes'>,
): VaultExportInput {
  return { folders: [], ...partial };
}

describe('@jot/import-export', () => {
  it('exportVault writes readable Markdown and a manifest without throwing', () => {
    const noteId = parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa');
    const result = exportVault(
      vault({
        notes: [baseNote({ id: noteId, title: 'Hello', document: loadDoc('paragraph-bold.json') })],
      }),
    );
    const markdown = fileText(result.files, 'Hello.md');
    expect(markdown).toContain('**Hello**');
    expect(markdown).toContain('id: naaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(fileText(result.files, 'manifest.json')).toContain(noteId);
  });

  it('exportNotes with empty ids exports the whole vault', () => {
    const noteId = parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa');
    const input = vault({
      notes: [baseNote({ id: noteId, title: 'Hello', document: loadDoc('empty-doc.json') })],
    });
    const viaNotes = exportNotes({ noteIds: [] }, input);
    const viaVault = exportVaultToFiles(input);
    expect(viaNotes.files.map((file) => file.path)).toEqual(
      viaVault.files.map((file) => file.path),
    );
  });

  it('exportNotes filters to requested note ids', () => {
    const keep = parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa');
    const drop = parseId<NoteId>('nbaaaaaaaaaaaaaaaaaaaaaaaa');
    const result = exportNotes(
      { noteIds: [keep] },
      vault({
        notes: [
          baseNote({ id: keep, title: 'Keep', document: loadDoc('empty-doc.json') }),
          baseNote({ id: drop, title: 'Drop', document: loadDoc('empty-doc.json') }),
        ],
      }),
    );
    expect(result.files.some((file) => file.path === 'Keep.md')).toBe(true);
    expect(result.files.some((file) => file.path === 'Drop.md')).toBe(false);
    expect(result.manifest.notes).toHaveLength(1);
    expect(result.manifest.notes[0]?.id).toBe(keep);
  });

  it('renders headings, lists, tasks, and nested bullets from real Documents', () => {
    const headings = fileText(
      exportVault(
        vault({
          notes: [
            baseNote({
              id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
              title: 'Heads',
              document: loadDoc('heading-levels.json'),
            }),
          ],
        }),
      ).files,
      'Heads.md',
    );
    expect(headings).toContain('# one');
    expect(headings).toContain('## two');
    expect(headings).toContain('###### six');

    const lists = fileText(
      exportVault(
        vault({
          notes: [
            baseNote({
              id: parseId<NoteId>('nbaaaaaaaaaaaaaaaaaaaaaaaa'),
              title: 'Lists',
              document: loadDoc('lists-and-tasks.json'),
            }),
          ],
        }),
      ).files,
      'Lists.md',
    );
    expect(lists).toContain('- one');
    expect(lists).toContain('- two');
    expect(lists).toContain('- nested');
    expect(lists).toContain('2. second');
    expect(lists).toContain('- [ ] todo');
    expect(lists).toContain('- [x] done');
  });

  it('renders underline as <u>, links, bold, italic, and skips color/highlight', () => {
    const markdown = fileText(
      exportVault(
        vault({
          notes: [
            baseNote({
              id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
              title: 'Marks',
              document: loadDoc('marks-link-color.json'),
            }),
          ],
        }),
      ).files,
      'Marks.md',
    );
    expect(markdown).toContain('[<u>***read more***</u>](https://example.com/path)');
    expect(markdown).not.toContain('signalAmber');
    expect(markdown).not.toContain('highlightWarm');
    expect(markdown).not.toContain('textColor');
  });

  it('renders GFM tables', () => {
    const markdown = fileText(
      exportVault(
        vault({
          notes: [
            baseNote({
              id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
              title: 'Table',
              document: loadDoc('table.json'),
            }),
          ],
        }),
      ).files,
      'Table.md',
    );
    expect(markdown).toContain('| H1 | H2 |');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown).toContain('| A |');
    expect(markdown).toContain('| B |');
  });

  it('renders images with relative paths, file links, and dollar math', () => {
    const imageId = parseId<AttachmentId>('aiaaaaaaaaaaaaaaaaaaaaaaaa');
    const fileId = parseId<AttachmentId>('ayaaaaaaaaaaaaaaaaaaaaaaaa');
    const photo = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const blob = new Uint8Array([1, 2, 3, 4]);
    const result = exportVault(
      vault({
        notes: [
          baseNote({
            id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
            title: 'Media',
            document: loadDoc('image-file-math.json'),
            attachments: [
              { id: imageId, originalName: 'photo.png', mimeType: 'image/png', bytes: photo },
              {
                id: fileId,
                originalName: 'notes.bin',
                mimeType: 'application/octet-stream',
                bytes: blob,
              },
            ],
          }),
        ],
      }),
    );
    const markdown = fileText(result.files, 'Media.md');
    expect(markdown).toContain('![photo](Media.attachments/photo.png)');
    expect(markdown).toContain('*A photo*');
    expect(markdown).toContain('[notes.bin](Media.attachments/notes.bin)');
    expect(markdown).toContain('$$\n');
    expect(markdown).toContain('e^{i\\pi}+1=0');
    expect(markdown).toContain('$x^2$');
    expect(fileAt(result.files, 'Media.attachments/photo.png').bytes).toEqual(photo);
    expect(fileAt(result.files, 'Media.attachments/notes.bin').bytes).toEqual(blob);
  });

  it('preserves unicode text', () => {
    const markdown = fileText(
      exportVault(
        vault({
          notes: [
            baseNote({
              id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
              title: 'Unicode',
              document: loadDoc('unicode-emoji-rtl.json'),
            }),
          ],
        }),
      ).files,
      'Unicode.md',
    );
    expect(markdown).toContain('😀');
    expect(markdown).toContain('שלום');
    expect(markdown).toContain('日本語');
  });

  it('writes YAML front matter for id, title, tags, pin, archive, and dates', () => {
    const noteId = parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa');
    const tagId = parseId<TagId>('taaaaaaaaaaaaaaaaaaaaaaaaa');
    const markdown = fileText(
      exportVault(
        vault({
          notes: [
            baseNote({
              id: noteId,
              title: 'Pinned: work',
              document: loadDoc('empty-doc.json'),
              tags: [{ id: tagId, name: 'urgent' }],
              pinned: true,
              archived: false,
              created: clock(1_704_000_000_000),
              modified: clock(1_704_000_100_000),
            }),
          ],
        }),
      ).files,
      'Pinned- work.md',
    );
    expect(markdown.startsWith('---\n')).toBe(true);
    expect(markdown).toContain(`id: ${noteId}`);
    expect(markdown).toContain('title: "Pinned: work"');
    expect(markdown).toContain('  - urgent');
    expect(markdown).toContain('pin: true');
    expect(markdown).toContain('archive: false');
    expect(markdown).toContain('created: 2023-12-31T05:20:00.000Z');
    expect(markdown).toContain('modified: 2023-12-31T05:21:40.000Z');
  });

  it('nests notes under folder directories and disambiguates duplicate sibling names', () => {
    const inbox = parseId<FolderId>('faaaaaaaaaaaaaaaaaaaaaaaaa');
    const workA = parseId<FolderId>('fbaaaaaaaaaaaaaaaaaaaaaaaa');
    const workB = parseId<FolderId>('fcaaaaaaaaaaaaaaaaaaaaaaaa');
    const nested = parseId<FolderId>('fdaaaaaaaaaaaaaaaaaaaaaaaa');
    const result = exportVault({
      folders: [
        { id: inbox, name: 'Inbox', parentPlacement: null, manualPosition: 'a' },
        { id: workA, name: 'Work', parentPlacement: inbox, manualPosition: 'a' },
        { id: workB, name: 'Work', parentPlacement: inbox, manualPosition: 'b' },
        { id: nested, name: 'Deep', parentPlacement: workA, manualPosition: 'a' },
      ],
      notes: [
        baseNote({
          id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
          title: 'Alpha',
          document: loadDoc('empty-doc.json'),
          folderPlacement: workA,
        }),
        baseNote({
          id: parseId<NoteId>('nbaaaaaaaaaaaaaaaaaaaaaaaa'),
          title: 'Beta',
          document: loadDoc('empty-doc.json'),
          folderPlacement: workB,
        }),
        baseNote({
          id: parseId<NoteId>('ncaaaaaaaaaaaaaaaaaaaaaaaa'),
          title: 'Gamma',
          document: loadDoc('empty-doc.json'),
          folderPlacement: nested,
        }),
      ],
    });
    const paths = result.files.map((file) => file.path);
    expect(paths).toContain(`Inbox/Work-${workA}/Alpha.md`);
    expect(paths).toContain(`Inbox/Work-${workB}/Beta.md`);
    expect(paths).toContain(`Inbox/Work-${workA}/Deep/Gamma.md`);
    const manifest = JSON.parse(fileText(result.files, 'manifest.json')) as {
      notes: { id: string; path: string }[];
    };
    expect(manifest.notes.some((entry) => entry.path === `Inbox/Work-${workA}/Deep/Gamma.md`)).toBe(
      true,
    );
  });

  it('disambiguates duplicate note titles in the same folder', () => {
    const result = exportVault(
      vault({
        notes: [
          baseNote({
            id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
            title: 'Same',
            document: loadDoc('empty-doc.json'),
          }),
          baseNote({
            id: parseId<NoteId>('nbaaaaaaaaaaaaaaaaaaaaaaaa'),
            title: 'Same',
            document: loadDoc('empty-doc.json'),
          }),
        ],
      }),
    );
    const paths = result.files.map((file) => file.path);
    expect(paths).toContain('Same-naaaaaaaaaaaaaaaaaaaaaaaaa.md');
    expect(paths).toContain('Same-nbaaaaaaaaaaaaaaaaaaaaaaaa.md');
  });

  it('renders blockquote, hr, code fences with languageId, and strikethrough', () => {
    const document = parseDocument({
      type: 'doc',
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
      content: [
        {
          type: 'blockquote',
          id: 'aeaaaaaaaaaaaaaaaaaaaaaaaa',
          content: [
            {
              type: 'paragraph',
              id: 'aiaaaaaaaaaaaaaaaaaaaaaaaa',
              content: [
                { type: 'text', id: 'amaaaaaaaaaaaaaaaaaaaaaaaa', text: 'quoted', marks: [] },
              ],
            },
          ],
        },
        { type: 'horizontalRule', id: 'aqaaaaaaaaaaaaaaaaaaaaaaaa' },
        {
          type: 'codeBlock',
          id: 'auaaaaaaaaaaaaaaaaaaaaaaaa',
          attrs: { languageId: 'ts' },
          content: [
            { type: 'text', id: 'ayaaaaaaaaaaaaaaaaaaaaaaaa', text: 'const x = 1;', marks: [] },
          ],
        },
        {
          type: 'paragraph',
          id: 'a4aaaaaaaaaaaaaaaaaaaaaaaa',
          content: [
            {
              type: 'text',
              id: 'baaaaaaaaaaaaaaaaaaaaaaaaa',
              text: 'gone',
              marks: [{ type: 'strikethrough' }],
            },
            { type: 'text', id: 'beaaaaaaaaaaaaaaaaaaaaaaaa', text: ' ', marks: [] },
            {
              type: 'text',
              id: 'biaaaaaaaaaaaaaaaaaaaaaaaa',
              text: 'code',
              marks: [{ type: 'inlineCode' }],
            },
          ],
        },
      ],
    });
    const markdown = fileText(
      exportVault(
        vault({
          notes: [
            baseNote({
              id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
              title: 'Blocks',
              document,
            }),
          ],
        }),
      ).files,
      'Blocks.md',
    );
    expect(markdown).toContain('> quoted');
    expect(markdown).toContain('---');
    expect(markdown).toContain('```ts\nconst x = 1;\n```');
    expect(markdown).toContain('~~gone~~');
    expect(markdown).toContain('`code`');
  });

  it('loads path-only attachments through readAttachmentPath', () => {
    const attachmentId = parseId<AttachmentId>('aiaaaaaaaaaaaaaaaaaaaaaaaa');
    const bytes = new Uint8Array([9, 8, 7]);
    const result = exportVault(
      vault({
        notes: [
          baseNote({
            id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
            title: 'Path',
            document: loadDoc('empty-doc.json'),
            attachments: [
              {
                id: attachmentId,
                originalName: 'clip.bin',
                mimeType: 'application/octet-stream',
                path: '/vault/clip.bin',
              },
            ],
          }),
        ],
        readAttachmentPath: (path) => {
          expect(path).toBe('/vault/clip.bin');
          return bytes;
        },
      }),
    );
    expect(fileAt(result.files, 'Path.attachments/clip.bin').bytes).toEqual(bytes);
  });

  it('throws when a listed attachment has neither bytes nor a reader', () => {
    const attachmentId = parseId<AttachmentId>('aiaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(() =>
      exportVault(
        vault({
          notes: [
            baseNote({
              id: parseId<NoteId>('naaaaaaaaaaaaaaaaaaaaaaaaa'),
              title: 'Missing',
              document: loadDoc('empty-doc.json'),
              attachments: [
                {
                  id: attachmentId,
                  originalName: 'gone.bin',
                  mimeType: 'application/octet-stream',
                  path: '/nowhere.bin',
                },
              ],
            }),
          ],
        }),
      ),
    ).toThrow(ExportError);
  });
});
