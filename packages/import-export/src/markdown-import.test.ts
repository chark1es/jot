import { createId, parseDocument } from '@jot/schema';
import type { SchemaNode } from '@jot/schema';
import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, markdownToBlocks, parseInlineMarkdown } from './markdown-import.js';

function asDocument(content: readonly SchemaNode[]) {
  return parseDocument({ type: 'doc', id: createId(), attrs: {}, content, marks: [] });
}

function inlineSummary(nodes: readonly SchemaNode[]): string[] {
  return nodes.map((node) => {
    const marks = node.marks.map((mark) => mark.type).sort();
    return marks.length === 0 ? (node.text ?? '') : `${node.text ?? ''}[${marks.join(',')}]`;
  });
}

describe('markdownToBlocks', () => {
  it('keeps each plain line as its own paragraph', () => {
    const blocks = markdownToBlocks('first line\nsecond line\n\nthird');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(blocks.map((block) => block.content[0]?.text)).toEqual(['first line', 'second line', 'third']);
    expect(() => asDocument(blocks)).not.toThrow();
  });

  it('parses headings, dividers, quotes, and code fences', () => {
    const blocks = markdownToBlocks(
      ['## Plan', '', '---', '> quoted **text**', '```ts', 'const a = 1;', '', 'return a;', '```'].join('\n'),
    );
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'horizontalRule', 'blockquote', 'codeBlock']);
    expect(blocks[0]?.attrs.level).toBe(2);
    expect(inlineSummary(blocks[2]?.content[0]?.content ?? [])).toEqual(['quoted ', 'text[bold]']);
    expect(blocks[3]?.content[0]?.text).toBe('const a = 1;\n\nreturn a;');
    expect(() => asDocument(blocks)).not.toThrow();
  });

  it('nests lists by indentation and reads task state and ordered starts', () => {
    const blocks = markdownToBlocks(
      ['- one', '  - nested', '- two', '', '3. three', '4. four', '- [ ] todo', '- [x] done'].join('\n'),
    );
    expect(blocks.map((block) => block.type)).toEqual(['bulletList', 'orderedList', 'taskList']);
    const bullet = blocks[0];
    expect(bullet?.content).toHaveLength(2);
    expect(bullet?.content[0]?.content.map((child) => child.type)).toEqual(['paragraph', 'bulletList']);
    expect(blocks[1]?.attrs.start).toBe(3);
    expect(blocks[2]?.content.map((item) => item.attrs.checked)).toEqual([0, 1]);
    expect(() => asDocument(blocks)).not.toThrow();
  });

  it('turns an unclosed fence into a code block instead of dropping text', () => {
    const blocks = markdownToBlocks('```\nhalf');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('codeBlock');
    expect(blocks[0]?.content[0]?.text).toBe('half');
  });
});

describe('parseInlineMarkdown', () => {
  it('applies emphasis, strike, code, and nested marks', () => {
    expect(inlineSummary(parseInlineMarkdown('a **b** *c* ~~d~~ `e*f*` ***g***'))).toEqual([
      'a ',
      'b[bold]',
      ' ',
      'c[italic]',
      ' ',
      'd[strikethrough]',
      ' ',
      'e*f*[inlineCode]',
      ' ',
      'g[bold,italic]',
    ]);
  });

  it('keeps snake_case, escapes, and lone delimiters as text', () => {
    expect(inlineSummary(parseInlineMarkdown('snake_case_name 2 * 3 \\*not\\*'))).toEqual([
      'snake_case_name 2 * 3 *not*',
    ]);
  });

  it('links only safe schemes', () => {
    const safe = parseInlineMarkdown('see [site](https://example.com "Example")');
    const link = safe[1]?.marks[0];
    expect(safe[1]?.text).toBe('site');
    expect(link).toEqual({ type: 'link', attrs: { href: 'https://example.com', title: 'Example' } });
    const unsafe = parseInlineMarkdown('[x](javascript:alert(1))');
    expect(unsafe.every((node) => node.marks.length === 0)).toBe(true);
  });
});

describe('looksLikeMarkdown', () => {
  it('flags Markdown syntax and ignores prose', () => {
    expect(looksLikeMarkdown('- item')).toBe(true);
    expect(looksLikeMarkdown('some **bold** text')).toBe(true);
    expect(looksLikeMarkdown('Meet at 5 - bring snacks')).toBe(false);
  });
});
