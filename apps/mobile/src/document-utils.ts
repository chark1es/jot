import { createId, deriveId, parseDocument, SCHEMA_VERSION } from '@jot/schema';
import type { Document, NoteId, SchemaNode } from '@jot/schema';

export function emptyDocument(noteId?: NoteId): Document {
  const docId = noteId === undefined ? createId() : deriveId(noteId, 'doc', 0);
  const paraId = deriveId(docId, 'paragraph', 0);
  return parseDocument({
    type: 'doc',
    id: docId,
    content: [{ type: 'paragraph', id: paraId, content: [] }],
  });
}

/**
 * Notes saved by older builds can have an empty body. The editor needs a paragraph to hold a
 * caret, and TypeScript, Yjs, and both native editors must agree on its id.
 */
export function withEditableBody(document: Document): Document {
  if (document.content.length > 0) {
    return document;
  }
  return parseDocument({
    ...document,
    content: [{ type: 'paragraph', id: deriveId(document.id, 'paragraph', 0), content: [] }],
  });
}

/** True when a note has no text, images, or other blocks worth keeping. */
export function isBlankDocument(document: Document): boolean {
  return document.content.every((node) => node.type === 'paragraph' && node.content.length === 0);
}

export function plainTextFromNode(node: SchemaNode): string {
  if (node.type === 'text') {
    return node.text ?? '';
  }
  if (node.type === 'hardBreak' || node.type === 'horizontalRule') {
    return '\n';
  }
  const inner = node.content.map(plainTextFromNode).join('');
  if (
    node.type === 'paragraph' ||
    node.type === 'heading' ||
    node.type === 'codeBlock' ||
    node.type === 'blockquote'
  ) {
    return inner.length === 0 ? '\n' : `${inner}\n`;
  }
  return inner;
}

export function plainBodyFromDocument(document: Document): string {
  return document.content.map(plainTextFromNode).join('').trim();
}

export function titleFromDocument(document: Document, fallback = 'Untitled'): string {
  const body = plainBodyFromDocument(document);
  const line = body.split('\n').find((entry) => entry.trim() !== '');
  if (line === undefined) {
    return fallback;
  }
  const trimmed = line.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

export function snippetFromBody(plainBody: string, limit = 120): string {
  const compact = plainBody.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, limit).trimEnd()}…`;
}

export { SCHEMA_VERSION };
