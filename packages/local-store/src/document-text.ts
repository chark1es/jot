import type { Document, SchemaNode } from '@jot/schema';

export function plainBodyFromDocument(document: Document): string {
  return collectText(document, false).trim();
}

export function captionsFromDocument(document: Document): string {
  const captions: string[] = [];
  walk(document, (node) => {
    if (node.type === 'caption') {
      const text = collectText(node, false).trim();
      if (text.length > 0) {
        captions.push(text);
      }
    }
  });
  return captions.join(' ');
}

function collectText(node: SchemaNode, skipCaptions: boolean): string {
  if (node.type === 'text') {
    return node.text ?? '';
  }
  if (node.type === 'hardBreak') {
    return '\n';
  }
  if (skipCaptions && node.type === 'caption') {
    return '';
  }
  const parts: string[] = [];
  for (const child of node.content) {
    const text = collectText(child, skipCaptions);
    if (text.length > 0) {
      parts.push(text);
    }
  }
  const joined = parts.join(node.type === 'doc' ? '\n' : '');
  return joined;
}

function walk(node: SchemaNode, visit: (node: SchemaNode) => void): void {
  visit(node);
  for (const child of node.content) {
    walk(child, visit);
  }
}

export function escapeSnippet(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function ftsMatchQuery(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `"${token.replaceAll('"', '')}"`).join(' AND ');
}
