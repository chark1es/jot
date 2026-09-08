import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  collectOsSemanticValues,
  parseTokens,
  REQUIRED_FAMILIES,
  SYNC_STATUS_ROLES,
} from './parse.js';
import { OS_SEMANTIC_VALUE_NAMES } from './no-raw-design-values.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('tokens.json', () => {
  const jsonText = readFileSync(join(packageRoot, 'src', 'tokens.json'), 'utf8');
  const tokens = parseTokens(jsonText);

  it('parses and contains every required family', () => {
    for (const family of REQUIRED_FAMILIES) {
      expect(tokens[family]).toBeTypeOf('object');
    }
  });

  it('uses the specified UI faces and editor body metrics', () => {
    expect(tokens.type.ui.fontFamily.apple).toBe('SF Pro');
    expect(tokens.type.ui.fontFamily.android).toBe('Roboto');
    expect(tokens.type.ui.fontFamily.windows).toBe('Segoe UI');
    expect(tokens.type.editor.body.size).toBe(17);
    expect(tokens.type.editor.body.desktopLineHeight).toBe(1.6);
    expect(tokens.type.editor.body.desktopMeasure).toBe('72ch');
  });

  it('keeps light and dark palettes as separate objects', () => {
    expect(tokens.color.light.canvas).not.toBe(tokens.color.dark.canvas);
    expect(tokens.color.light.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(tokens.color.dark.accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('names every sync status role', () => {
    for (const role of SYNC_STATUS_ROLES) {
      expect(tokens.syncStatus[role].colorRole).toBeTypeOf('string');
    }
  });

  it('maps OS semantic values onto the allowlist', () => {
    for (const name of collectOsSemanticValues(tokens)) {
      expect(OS_SEMANTIC_VALUE_NAMES.has(name)).toBe(true);
    }
  });

  it('rejects missing families', () => {
    expect(() => parseTokens('{"type":{}}')).toThrow(/missing/);
  });
});
