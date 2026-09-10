import { describe, expect, it } from 'vitest';
import { JOT_EDITOR_VIEW_NAME, NATIVE_EDITOR_IMPLEMENTATIONS } from './index.js';
import type { EditorHost } from './index.js';

describe('@jot/editor-native', () => {
  it('documents native implementations', () => {
    expect(NATIVE_EDITOR_IMPLEMENTATIONS).toEqual(['Swift UITextView', 'Kotlin EditText']);
  });

  it('exports the Expo view manager name', () => {
    expect(JOT_EDITOR_VIEW_NAME).toBe('JotEditor');
  });

  it('EditorHost is a type-only contract', () => {
    const unused: EditorHost | null = null;
    expect(unused).toBeNull();
  });
});
