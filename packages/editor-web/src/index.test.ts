import { describe, expect, it } from 'vitest';
import { WEB_EDITOR_STACK } from './index.js';
import type { EditorHost } from './index.js';

describe('@jot/editor-web', () => {
  it('names the desktop editor stack without bundling it', () => {
    expect(WEB_EDITOR_STACK).toEqual(['TipTap', 'ProseMirror']);
  });

  it('EditorHost is a type-only contract', () => {
    const unused: EditorHost | null = null;
    expect(unused).toBeNull();
  });
});
