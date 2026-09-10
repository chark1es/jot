import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeDocumentToString, createId, parseDocument, parseId } from '@jot/schema';
import type { Document, SchemaNode } from '@jot/schema';
import { describe, expect, it } from 'vitest';
import { documentToLinear, HARD_BREAK_TEXT, linearToDocument, OBJECT_REPLACEMENT } from './linear.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../schema/fixtures');

const PHASE_NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'text',
  'blockquote',
  'horizontalRule',
  'image',
  'caption',
  'hardBreak',
  'fileAttachment',
  'mathBlock',
  'mathInline',
  'table',
  'tableRow',
  'tableCell',
]);

const PHASE_MARKS = new Set(['bold', 'italic', 'underline', 'strikethrough', 'inlineCode', 'link']);

function walkSupported(node: SchemaNode): boolean {
  if (!PHASE_NODES.has(node.type)) {
    return false;
  }
  if (node.marks.some((mark) => !PHASE_MARKS.has(mark.type))) {
    return false;
  }
  return node.content.every(walkSupported);
}

function inputFixtures(): string[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.canonical.json'))
    .sort();
}

function loadFixture(name: string): Document {
  const input = JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown;
  return parseDocument(input);
}

describe('linear round-trip', () => {
  it('round-trips Phase 1 schema fixtures to identical canonical JSON', () => {
    const names = inputFixtures().filter((name) => walkSupported(loadFixture(name)));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const parsed = loadFixture(name);
      const roundTrip = linearToDocument(documentToLinear(parsed));
      expect(canonicalizeDocumentToString(roundTrip), name).toBe(
        canonicalizeDocumentToString(parsed),
      );
    }
  });

  it('round-trips nested lists, empty paragraphs, headings, codeBlock languageId, and task checked', () => {
    const doc = parseDocument({
      type: 'doc',
      id: parseId('aaaaaaaaaaaaaaaaaaaaaaaaaa'),
      content: [
        { type: 'paragraph', id: parseId('aeaaaaaaaaaaaaaaaaaaaaaaaa'), content: [] },
        {
          type: 'heading',
          id: parseId('aiaaaaaaaaaaaaaaaaaaaaaaaa'),
          attrs: { level: 6 },
          content: [
            {
              type: 'text',
              id: parseId('amaaaaaaaaaaaaaaaaaaaaaaaa'),
              text: 'h',
              marks: [],
            },
          ],
        },
        {
          type: 'codeBlock',
          id: parseId('aqaaaaaaaaaaaaaaaaaaaaaaaa'),
          attrs: { languageId: 'ts' },
          content: [
            {
              type: 'text',
              id: parseId('auaaaaaaaaaaaaaaaaaaaaaaaa'),
              text: 'const n = 1;',
              marks: [],
            },
          ],
        },
        {
          type: 'taskList',
          id: parseId('ayaaaaaaaaaaaaaaaaaaaaaaaa'),
          content: [
            {
              type: 'taskItem',
              id: parseId('a4aaaaaaaaaaaaaaaaaaaaaaaa'),
              attrs: { checked: 1 },
              content: [
                {
                  type: 'paragraph',
                  id: parseId('baaaaaaaaaaaaaaaaaaaaaaaaa'),
                  content: [
                    {
                      type: 'text',
                      id: parseId('beaaaaaaaaaaaaaaaaaaaaaaaa'),
                      text: 'done',
                      marks: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const roundTrip = linearToDocument(documentToLinear(doc));
    expect(canonicalizeDocumentToString(roundTrip)).toBe(canonicalizeDocumentToString(doc));
  });

  it('preserves generated node ids through a fresh document', () => {
    const paragraphId = createId();
    const textId = createId();
    const doc = parseDocument({
      type: 'doc',
      id: createId(),
      content: [
        {
          type: 'paragraph',
          id: paragraphId,
          content: [{ type: 'text', id: textId, text: 'x', marks: [{ type: 'italic' }] }],
        },
      ],
    });
    expect(canonicalizeDocumentToString(linearToDocument(documentToLinear(doc)))).toBe(
      canonicalizeDocumentToString(doc),
    );
  });

  it('round-trips blockquote, horizontalRule, image, and hardBreak', () => {
    const doc = parseDocument({
      type: 'doc',
      id: parseId('aaaaaaaaaaaaaaaaaaaaaaaaaa'),
      content: [
        {
          type: 'blockquote',
          id: parseId('aeaaaaaaaaaaaaaaaaaaaaaaaa'),
          content: [
            {
              type: 'paragraph',
              id: parseId('aiaaaaaaaaaaaaaaaaaaaaaaaa'),
              content: [
                { type: 'text', id: parseId('amaaaaaaaaaaaaaaaaaaaaaaaa'), text: 'quoted', marks: [] },
                { type: 'hardBreak', id: parseId('aqaaaaaaaaaaaaaaaaaaaaaaaa') },
                { type: 'text', id: parseId('auaaaaaaaaaaaaaaaaaaaaaaaa'), text: 'line', marks: [] },
              ],
            },
          ],
        },
        { type: 'horizontalRule', id: parseId('ayaaaaaaaaaaaaaaaaaaaaaaaa') },
        {
          type: 'image',
          id: parseId('a4aaaaaaaaaaaaaaaaaaaaaaaa'),
          attrs: {
            attachmentId: parseId('baaaaaaaaaaaaaaaaaaaaaaaaa'),
            widthBasisPoints: 5000,
            alt: 'photo',
          },
          content: [
            {
              type: 'caption',
              id: parseId('beaaaaaaaaaaaaaaaaaaaaaaaa'),
              content: [
                { type: 'text', id: parseId('biaaaaaaaaaaaaaaaaaaaaaaaa'), text: 'A photo', marks: [] },
              ],
            },
          ],
        },
        {
          type: 'image',
          id: parseId('bmaaaaaaaaaaaaaaaaaaaaaaaa'),
          attrs: {
            attachmentId: parseId('bqaaaaaaaaaaaaaaaaaaaaaaaa'),
            alt: '',
          },
        },
        {
          type: 'paragraph',
          id: parseId('buaaaaaaaaaaaaaaaaaaaaaaaa'),
          content: [
            {
              type: 'text',
              id: parseId('byaaaaaaaaaaaaaaaaaaaaaaaa'),
              text: 'linked',
              marks: [
                { type: 'underline' },
                { type: 'link', attrs: { href: 'https://example.com/path', title: '' } },
              ],
            },
          ],
        },
      ],
    });
    const linear = documentToLinear(doc);
    expect(linear.blocks[0]?.kind).toBe('blockquote');
    expect(linear.blocks[1]?.kind).toBe('paragraph');
    expect(linear.blocks[1]?.indent).toBe(1);
    expect(linear.blocks[1]?.runs.some((run) => run.atom === 'hardBreak')).toBe(true);
    expect(linear.blocks[1]?.runs.some((run) => run.text === HARD_BREAK_TEXT)).toBe(true);
    expect(linear.blocks[2]?.kind).toBe('horizontalRule');
    expect(linear.blocks[2]?.runs[0]?.text).toBe(OBJECT_REPLACEMENT);
    expect(linear.blocks[3]?.kind).toBe('image');
    expect(linear.blocks[3]?.attachmentId).toBe('baaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(linear.blocks[3]?.widthBasisPoints).toBe(5000);
    expect(linear.blocks[3]?.alt).toBe('photo');
    expect(linear.blocks[3]?.caption?.[0]?.text).toBe('A photo');
    expect(linear.blocks[4]?.kind).toBe('image');
    expect(linear.blocks[4]?.caption).toBeUndefined();
    expect(canonicalizeDocumentToString(linearToDocument(linear))).toBe(
      canonicalizeDocumentToString(doc),
    );
  });

  it('keeps fileAttachment and mathBlock as placeholder atomics', () => {
    const doc = loadFixture('image-file-math.json');
    const linear = documentToLinear(doc);
    expect(linear.blocks.some((block) => block.kind === 'image')).toBe(true);
    expect(linear.blocks.some((block) => block.kind === 'placeholder')).toBe(true);
    expect(linear.blocks.filter((block) => block.kind === 'placeholder').every((block) => block.runs[0]?.text === OBJECT_REPLACEMENT)).toBe(true);
    expect(canonicalizeDocumentToString(linearToDocument(linear))).toBe(
      canonicalizeDocumentToString(doc),
    );
  });
});
