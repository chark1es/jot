import type { AttrValue, Document, Mark, SchemaNode } from '@jot/schema';

export type MarkdownContext = {
  readonly hrefForAttachment: (id: string) => string | undefined;
  readonly originalNameForAttachment: (id: string) => string | undefined;
};

function integerAttr(
  attrs: Readonly<Record<string, AttrValue>>,
  key: string,
  fallback: number,
): number {
  const value = attrs[key];
  return typeof value === 'number' ? value : fallback;
}

function stringAttr(
  attrs: Readonly<Record<string, AttrValue>>,
  key: string,
  fallback = '',
): string {
  const value = attrs[key];
  return typeof value === 'string' ? value : fallback;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*[\]_<>])/g, '\\$1');
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function markdownDest(path: string): string {
  if (/[\s()<>]/.test(path)) {
    return `<${path.replace(/[<>]/g, '')}>`;
  }
  return path;
}

function wrapInlineCode(text: string): string {
  let n = 1;
  while (text.includes('`'.repeat(n))) {
    n += 1;
  }
  const fence = '`'.repeat(n);
  const pad =
    text.startsWith('`') || text.endsWith('`') || text.startsWith(' ') || text.endsWith(' ')
      ? ' '
      : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function hasMark(marks: readonly Mark[], type: Mark['type']): boolean {
  return marks.some((mark) => mark.type === type);
}

function findMark(marks: readonly Mark[], type: Mark['type']): Mark | undefined {
  return marks.find((mark) => mark.type === type);
}

function renderMarkedText(text: string, marks: readonly Mark[]): string {
  let out = hasMark(marks, 'inlineCode') ? wrapInlineCode(text) : escapeMarkdown(text);
  if (hasMark(marks, 'italic')) {
    out = `*${out}*`;
  }
  if (hasMark(marks, 'bold')) {
    out = `**${out}**`;
  }
  if (hasMark(marks, 'strikethrough')) {
    out = `~~${out}~~`;
  }
  if (hasMark(marks, 'underline')) {
    out = `<u>${out}</u>`;
  }
  const link = findMark(marks, 'link');
  if (link !== undefined) {
    const href = stringAttr(link.attrs, 'href');
    const title = stringAttr(link.attrs, 'title');
    out =
      title.length > 0 ? `[${out}](${href} "${title.replace(/"/g, '\\"')}")` : `[${out}](${href})`;
  }
  return out;
}

function renderInline(node: SchemaNode, ctx: MarkdownContext): string {
  switch (node.type) {
    case 'text':
      return renderMarkedText(node.text ?? '', node.marks);
    case 'hardBreak':
      return '\\\n';
    case 'mathInline': {
      const latex = stringAttr(node.attrs, 'latex');
      if (latex.length > 0) {
        return `$${latex}$`;
      }
      return escapeMarkdown(stringAttr(node.attrs, 'alt'));
    }
    default:
      return renderInlines(node.content, ctx);
  }
}

function renderInlines(nodes: readonly SchemaNode[], ctx: MarkdownContext): string {
  return nodes.map((node) => renderInline(node, ctx)).join('');
}

function fenceFor(text: string): string {
  let n = 3;
  while (text.includes('`'.repeat(n))) {
    n += 1;
  }
  return '`'.repeat(n);
}

function renderCodeBlock(node: SchemaNode): string {
  const languageId = stringAttr(node.attrs, 'languageId').replace(/[`\r\n]/g, '');
  const text = node.content.map((child) => child.text ?? '').join('');
  const fence = fenceFor(text);
  return `${fence}${languageId}\n${text}\n${fence}`;
}

function renderBlockquote(node: SchemaNode, ctx: MarkdownContext): string {
  const inner = renderBlocks(node.content, ctx);
  if (inner.length === 0) {
    return '>';
  }
  return inner
    .split('\n')
    .map((line) => (line.length === 0 ? '>' : `> ${line}`))
    .join('\n');
}

function renderListItem(item: SchemaNode, marker: string, ctx: MarkdownContext): string {
  const hang = ' '.repeat(marker.length);
  const blocks = item.content;
  if (blocks.length === 0) {
    return marker.trimEnd();
  }
  const lines: string[] = [];
  for (const [index, block] of blocks.entries()) {
    if (index === 0 && block.type === 'paragraph') {
      lines.push(`${marker}${renderInlines(block.content, ctx)}`);
      continue;
    }
    const inner = renderBlock(block, ctx);
    if (inner.length === 0) {
      continue;
    }
    if (index === 0) {
      lines.push(marker.trimEnd());
    }
    for (const line of inner.split('\n')) {
      lines.push(line.length === 0 ? hang.trimEnd() : `${hang}${line}`);
    }
  }
  return lines.join('\n');
}

function renderList(
  node: SchemaNode,
  ctx: MarkdownContext,
  kind: 'bullet' | 'ordered' | 'task',
): string {
  const start = integerAttr(node.attrs, 'start', 1);
  const items: string[] = [];
  let n = start;
  for (const item of node.content) {
    const marker =
      kind === 'ordered'
        ? `${String(n)}. `
        : kind === 'task'
          ? integerAttr(item.attrs, 'checked', 0) === 1
            ? '- [x] '
            : '- [ ] '
          : '- ';
    items.push(renderListItem(item, marker, ctx));
    n += 1;
  }
  return items.join('\n');
}

function rowWidth(row: SchemaNode): number {
  let width = 0;
  for (const cell of row.content) {
    width += integerAttr(cell.attrs, 'colspan', 1);
  }
  return width;
}

function cellText(cell: SchemaNode, ctx: MarkdownContext): string {
  const inner = renderBlocks(cell.content, ctx);
  return escapeTableCell(inner);
}

function renderTable(node: SchemaNode, ctx: MarkdownContext): string {
  const rows = node.content;
  const first = rows[0];
  if (first === undefined) {
    return '';
  }
  const columns = Math.max(...rows.map(rowWidth), 1);
  const headerIsHeader = first.content.some((cell) => integerAttr(cell.attrs, 'header', 0) === 1);
  const lines: string[] = [];

  const emitRow = (row: SchemaNode): string => {
    const cells: string[] = [];
    for (const cell of row.content) {
      const span = integerAttr(cell.attrs, 'colspan', 1);
      cells.push(cellText(cell, ctx));
      for (let extra = 1; extra < span; extra += 1) {
        cells.push('');
      }
    }
    while (cells.length < columns) {
      cells.push('');
    }
    return `| ${cells.slice(0, columns).join(' | ')} |`;
  };

  if (headerIsHeader) {
    lines.push(emitRow(first));
    lines.push(`| ${Array.from({ length: columns }, () => '---').join(' | ')} |`);
    for (const row of rows.slice(1)) {
      lines.push(emitRow(row));
    }
  } else {
    lines.push(`| ${Array.from({ length: columns }, () => '').join(' | ')} |`);
    lines.push(`| ${Array.from({ length: columns }, () => '---').join(' | ')} |`);
    for (const row of rows) {
      lines.push(emitRow(row));
    }
  }
  return lines.join('\n');
}

function attachmentHref(node: SchemaNode, ctx: MarkdownContext): string {
  const id = stringAttr(node.attrs, 'attachmentId');
  const href = ctx.hrefForAttachment(id);
  if (href !== undefined) {
    return href;
  }
  return `attachments/${id}`;
}

function renderImage(node: SchemaNode, ctx: MarkdownContext): string {
  const alt = stringAttr(node.attrs, 'alt');
  const href = attachmentHref(node, ctx);
  const image = `![${escapeMarkdown(alt)}](${markdownDest(href)})`;
  const caption = node.content.find((child) => child.type === 'caption');
  if (caption === undefined) {
    return image;
  }
  const captionText = renderInlines(caption.content, ctx);
  if (captionText.length === 0) {
    return image;
  }
  return `${image}\n\n*${captionText}*`;
}

function renderFileAttachment(node: SchemaNode, ctx: MarkdownContext): string {
  const id = stringAttr(node.attrs, 'attachmentId');
  const href = ctx.hrefForAttachment(id) ?? `attachments/${id}`;
  const name = ctx.originalNameForAttachment(id) ?? id;
  return `[${escapeMarkdown(name)}](${markdownDest(href)})`;
}

function renderMathBlock(node: SchemaNode): string {
  const latex = stringAttr(node.attrs, 'latex');
  if (latex.length > 0) {
    return `$$\n${latex}\n$$`;
  }
  const alt = stringAttr(node.attrs, 'alt');
  return escapeMarkdown(alt);
}

function renderBlock(node: SchemaNode, ctx: MarkdownContext): string {
  switch (node.type) {
    case 'doc':
      return renderBlocks(node.content, ctx);
    case 'paragraph':
      return renderInlines(node.content, ctx);
    case 'heading': {
      const level = Math.min(6, Math.max(1, integerAttr(node.attrs, 'level', 1)));
      return `${'#'.repeat(level)} ${renderInlines(node.content, ctx)}`;
    }
    case 'blockquote':
      return renderBlockquote(node, ctx);
    case 'codeBlock':
      return renderCodeBlock(node);
    case 'horizontalRule':
      return '---';
    case 'bulletList':
      return renderList(node, ctx, 'bullet');
    case 'orderedList':
      return renderList(node, ctx, 'ordered');
    case 'taskList':
      return renderList(node, ctx, 'task');
    case 'table':
      return renderTable(node, ctx);
    case 'image':
      return renderImage(node, ctx);
    case 'fileAttachment':
      return renderFileAttachment(node, ctx);
    case 'mathBlock':
      return renderMathBlock(node);
    case 'text':
    case 'hardBreak':
    case 'mathInline':
      return renderInline(node, ctx);
    case 'listItem':
    case 'taskItem':
    case 'tableRow':
    case 'tableCell':
    case 'caption':
      return renderBlocks(node.content, ctx);
  }
}

function renderBlocks(nodes: readonly SchemaNode[], ctx: MarkdownContext): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const rendered = renderBlock(node, ctx);
    if (rendered.length > 0) {
      parts.push(rendered);
    }
  }
  return parts.join('\n\n');
}

export function documentToMarkdown(document: Document, ctx: MarkdownContext): string {
  return renderBlocks(document.content, ctx);
}
