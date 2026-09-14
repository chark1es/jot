import { createId, isAllowedHref } from '@jot/schema';
import type { Mark, SchemaNode } from '@jot/schema';

type ListKind = 'bulletList' | 'orderedList' | 'taskList';

type ListLine = {
  readonly indent: number;
  readonly kind: ListKind;
  readonly text: string;
  readonly checked: 0 | 1;
  readonly start: number;
};

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*[\w+-]*\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const DIVIDER = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const LINK = /^\[([^\]\n]+)\]\(([^()\s]+)(?:\s+"([^"]*)")?\)/;
const ESCAPABLE = /[\\`*_~[\]()#>!+.-]/;
const WORD = /[\p{L}\p{N}]/u;
const INLINE_DELIMITERS = ['**', '__', '~~', '*', '_'] as const;

/**
 * Parses pasted Markdown into schema blocks for the editor's `insertBlocks` command.
 *
 * Outside lists, quotes, and code fences, every non-blank line becomes its own paragraph.
 * Text pasted into a note is line-oriented, so joining soft-wrapped lines the way CommonMark
 * does would lose the structure people expect to keep.
 */
export function markdownToBlocks(markdown: string): SchemaNode[] {
  return parseBlocks(markdown.replace(/\r\n?/g, '\n').split('\n'));
}

/** True when a single line uses Markdown syntax worth converting instead of pasting verbatim. */
export function looksLikeMarkdown(text: string): boolean {
  return /(\*\*|__|~~|`|\[[^\]]+\]\([^)]+\))/.test(text) || /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?)/m.test(text);
}

export function parseInlineMarkdown(source: string): SchemaNode[] {
  const out: SchemaNode[] = [];
  appendInline(source, [], out);
  return mergeText(out);
}

function parseBlocks(lines: readonly string[]): SchemaNode[] {
  const blocks: SchemaNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence?.[1] !== undefined) {
      const marker = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !closesFence(lines[i] ?? '', marker)) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      blocks.push(codeBlock(body.join('\n')));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      blocks.push(block('heading', { level: heading[1].length }, parseInlineMarkdown(heading[2] ?? '')));
      i += 1;
      continue;
    }
    if (DIVIDER.test(line)) {
      blocks.push(block('horizontalRule', {}, []));
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const quoted = QUOTE.exec(lines[i] ?? '');
        if (quoted === null) {
          break;
        }
        inner.push(quoted[1] ?? '');
        i += 1;
      }
      const content = parseBlocks(inner);
      blocks.push(block('blockquote', {}, content.length > 0 ? content : [paragraph('')]));
      continue;
    }
    if (listLine(line) !== undefined) {
      const parsed = parseList(lines, i);
      blocks.push(parsed.list);
      i = parsed.next;
      continue;
    }
    blocks.push(paragraph(line.trim()));
    i += 1;
  }
  return blocks;
}

function closesFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  const char = marker.charAt(0);
  return trimmed.length >= marker.length && trimmed === char.repeat(trimmed.length);
}

function listLine(line: string): ListLine | undefined {
  const task = TASK.exec(line);
  if (task !== null) {
    return {
      indent: indentWidth(task[1] ?? ''),
      kind: 'taskList',
      text: task[3] ?? '',
      checked: task[2] === ' ' ? 0 : 1,
      start: 1,
    };
  }
  if (DIVIDER.test(line)) {
    return undefined;
  }
  const bullet = BULLET.exec(line);
  if (bullet !== null) {
    return { indent: indentWidth(bullet[1] ?? ''), kind: 'bulletList', text: bullet[2] ?? '', checked: 0, start: 1 };
  }
  const ordered = ORDERED.exec(line);
  if (ordered !== null) {
    return {
      indent: indentWidth(ordered[1] ?? ''),
      kind: 'orderedList',
      text: ordered[3] ?? '',
      checked: 0,
      start: Math.max(1, Number(ordered[2])),
    };
  }
  return undefined;
}

function indentWidth(whitespace: string): number {
  return whitespace.replaceAll('\t', '    ').length;
}

function parseList(lines: readonly string[], start: number): { list: SchemaNode; next: number } {
  const first = listLine(lines[start] ?? '');
  if (first === undefined) {
    return { list: paragraph(lines[start] ?? ''), next: start + 1 };
  }
  const items: SchemaNode[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      // A blank line only continues the list when another item of it follows.
      const peek = listLine(lines[i + 1] ?? '');
      if (peek !== undefined && peek.indent >= first.indent && (peek.kind === first.kind || peek.indent > first.indent)) {
        i += 1;
        continue;
      }
      break;
    }
    const current = listLine(line);
    if (current?.indent !== first.indent || current.kind !== first.kind) {
      break;
    }
    i += 1;
    const children: SchemaNode[] = [paragraph(current.text)];
    while (i < lines.length) {
      const nested = listLine(lines[i] ?? '');
      if (nested === undefined || nested.indent <= first.indent) {
        break;
      }
      const parsed = parseList(lines, i);
      children.push(parsed.list);
      i = parsed.next;
    }
    items.push(
      first.kind === 'taskList'
        ? block('taskItem', { checked: current.checked }, children)
        : block('listItem', {}, children),
    );
  }
  const attrs = first.kind === 'orderedList' ? { start: first.start } : {};
  return { list: block(first.kind, attrs, items), next: i };
}

function block(type: SchemaNode['type'], attrs: SchemaNode['attrs'], content: readonly SchemaNode[]): SchemaNode {
  return { type, id: createId(), attrs, content, marks: [] };
}

function paragraph(inline: string): SchemaNode {
  return block('paragraph', {}, parseInlineMarkdown(inline));
}

function codeBlock(text: string): SchemaNode {
  return block('codeBlock', { languageId: '' }, text.length === 0 ? [] : [textNode(text, [])]);
}

function textNode(text: string, marks: readonly Mark[]): SchemaNode {
  return { type: 'text', id: createId(), attrs: {}, content: [], marks, text };
}

function mark(type: Mark['type'], attrs: Mark['attrs'] = {}): Mark {
  return { type, attrs };
}

function withMark(marks: readonly Mark[], next: Mark): Mark[] {
  return [...marks.filter((entry) => entry.type !== next.type), next];
}

function appendInline(source: string, marks: readonly Mark[], out: SchemaNode[]): void {
  let buffer = '';
  const flush = (): void => {
    if (buffer.length > 0) {
      out.push(textNode(buffer, marks));
      buffer = '';
    }
  };
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    const next = source.charAt(i + 1);
    if (char === '\\' && ESCAPABLE.test(next)) {
      buffer += next;
      i += 2;
      continue;
    }
    if (char === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        // Code spans have no other marks in the schema.
        out.push(textNode(source.slice(i + 1, end), [mark('inlineCode')]));
        i = end + 1;
        continue;
      }
    }
    if (char === '[') {
      const link = LINK.exec(source.slice(i));
      if (link?.[1] !== undefined && link[2] !== undefined && isAllowedHref(link[2])) {
        flush();
        appendInline(link[1], withMark(marks, mark('link', { href: link[2], title: link[3] ?? '' })), out);
        i += link[0].length;
        continue;
      }
    }
    const delimiter = INLINE_DELIMITERS.find((candidate) => source.startsWith(candidate, i));
    if (delimiter !== undefined) {
      const close = closingDelimiter(source, i, delimiter);
      if (close !== -1) {
        const type = delimiter === '~~' ? 'strikethrough' : delimiter.length === 2 ? 'bold' : 'italic';
        flush();
        appendInline(source.slice(i + delimiter.length, close), withMark(marks, mark(type)), out);
        i = close + delimiter.length;
        continue;
      }
    }
    buffer += char;
    i += 1;
  }
  flush();
}

function closingDelimiter(source: string, open: number, delimiter: string): number {
  const innerStart = open + delimiter.length;
  const firstInner = source.charAt(innerStart);
  if (firstInner === '' || /\s/.test(firstInner)) {
    return -1;
  }
  const underscore = delimiter.startsWith('_');
  if (underscore && open > 0 && WORD.test(source.charAt(open - 1))) {
    return -1;
  }
  let index = source.indexOf(delimiter, innerStart + 1);
  while (index !== -1) {
    if (delimiter.length === 2 && source.charAt(index + 2) === delimiter.charAt(0)) {
      // `***text***`: the bold closer is the last two of the three characters.
      index += 1;
    }
    const before = source.charAt(index - 1);
    const after = source.charAt(index + delimiter.length);
    const partOfDouble = delimiter.length === 1 && (after === delimiter || before === delimiter);
    const valid =
      before !== '' &&
      !/\s/.test(before) &&
      !partOfDouble &&
      !(underscore && after !== '' && WORD.test(after));
    if (valid) {
      return index;
    }
    index = source.indexOf(delimiter, index + 1);
  }
  return -1;
}

function marksKey(marks: readonly Mark[]): string {
  return JSON.stringify([...marks].sort((a, b) => a.type.localeCompare(b.type)));
}

function mergeText(nodes: readonly SchemaNode[]): SchemaNode[] {
  const merged: SchemaNode[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (previous?.type === 'text' && node.type === 'text' && marksKey(previous.marks) === marksKey(node.marks)) {
      merged[merged.length - 1] = { ...previous, text: `${previous.text ?? ''}${node.text ?? ''}` };
      continue;
    }
    merged.push(node);
  }
  return merged;
}
