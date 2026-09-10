import { createId, deriveId, parseDocument, SCHEMA_VERSION } from '@jot/schema';
import type { Document, SchemaNode } from '@jot/schema';

export function emptyDocument(): Document {
  const docId = createId();
  const paraId = deriveId(docId, 'paragraph', 0);
  return parseDocument({
    type: 'doc',
    id: docId,
    content: [{ type: 'paragraph', id: paraId, content: [] }],
  });
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
